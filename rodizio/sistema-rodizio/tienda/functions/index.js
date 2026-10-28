/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   Cloud Function — avisa al cliente cuando cambia el estado
   de su pedido (recibido → enviado → en_camino → entregado).
   =========================================================
   Se dispara sola cada vez que cambia el valor en
   orders/{orderId}/status dentro de Realtime Database — ya sea
   a mano desde la consola, o (lo normal) porque alguien presionó
   un botón de estado en el panel de administración (admin.js).

   No se ejecuta en el navegador del cliente: corre en los
   servidores de Firebase. Por eso necesita desplegarse aparte
   (ver instrucciones al final de este archivo).
   ========================================================= */

const { onValueUpdated, onValueWritten } = require('firebase-functions/v2/database');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

const STATUS_LABELS = {
  recibido: 'Recibimos tu pedido',
  enviado: 'Confirmamos tu pedido',
  preparacion: 'Tu pedido está en cocina',
  listo: 'Tu pedido está listo',
  en_camino: 'Tu pedido va en camino',
  llegado: 'El domiciliario está llegando',
  entregado: '¡Tu pedido fue entregado!',
  no_entregado: 'Tuvimos un problema para entregar tu pedido — te contactaremos',
  cancelado: 'Tu pedido fue cancelado',
};

exports.notifyOrderStatusChange = onValueUpdated(
  { ref: '/orders/{orderId}/status', region: 'us-central1', maxInstances: 5 },
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (before === after || !after) return;

    const { orderId } = event.params;
    const db = getDatabase();

    const orderSnap = await db.ref(`orders/${orderId}`).get();
    const order = orderSnap.val();
    if (!order || !order.uid) return;

    const tokensSnap = await db.ref(`users/${order.uid}/fcmTokens`).get();
    if (!tokensSnap.exists()) return;
    const tokens = Object.keys(tokensSnap.val());
    if (tokens.length === 0) return;

    const messaging = getMessaging();
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: 'Rodízio Cúcuta',
        body: STATUS_LABELS[after] || `Tu pedido cambió a: ${after}`,
      },
      webpush: {
        fcmOptions: { link: '/' },
      },
    });

    // Limpieza: si un token ya no es válido (el usuario desinstaló
    // la app, borró datos del navegador, etc.), lo quitamos.
    const invalidTokens = tokens.filter((_, i) => !response.responses[i].success);
    await Promise.all(
      invalidTokens.map((token) => db.ref(`users/${order.uid}/fcmTokens/${token}`).remove())
    );
  }
);

/* =========================================================
   Cloud Function — avisa a UN domiciliario (y solo a ese) cuando
   el panel le asigna un pedido para recoger.
   =========================================================
   Se dispara cuando cambia orders/{orderId}/driverId — que es
   justo lo que escribe admin.js al elegir un domiciliario en la
   tarjeta de un pedido. Nunca manda la notificación a todos los
   domiciliarios registrados: solo lee los tokens guardados bajo
   drivers/{ese uid}/fcmTokens, exactamente el domiciliario que el
   panel eligió. */
exports.notifyDriverAssigned = onValueWritten(
  { ref: '/orders/{orderId}/driverId', region: 'us-central1', maxInstances: 5 },
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (!after || before === after) return; // se quitó la asignación o no cambió

    const { orderId } = event.params;
    const db = getDatabase();

    const [orderSnap, tokensSnap] = await Promise.all([
      db.ref(`orders/${orderId}`).get(),
      db.ref(`drivers/${after}/fcmTokens`).get(),
    ]);
    if (!tokensSnap.exists()) return;

    const order = orderSnap.val() || {};
    const tokens = Object.keys(tokensSnap.val());
    if (tokens.length === 0) return;

    // El pedido ya viene validado por las reglas de RTDB (dueño/trabajador
    // activo), pero igual acotamos texto libre antes de meterlo en una
    // notificación — barato y evita que un valor raro (saltos de línea,
    // texto larguísimo) rompa cómo se ve el aviso en el celular del domiciliario.
    const sanitize = (value, maxLength) =>
      String(value || '').replace(/[\r\n]+/g, ' ').slice(0, maxLength).trim();

    const itemsCount = (order.items || []).reduce((sum, i) => sum + (i.qty || 0), 0);
    const messaging = getMessaging();
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: 'Nuevo pedido para recoger',
        body: `${sanitize(order.customerName, 60) || 'Cliente'} · ${itemsCount} producto${itemsCount === 1 ? '' : 's'} · ${sanitize(order.address, 120) || 'domicilio'}`,
      },
      webpush: {
        fcmOptions: { link: '/driver.html' },
      },
    });

    const invalidTokens = tokens.filter((_, i) => !response.responses[i].success);
    await Promise.all(
      invalidTokens.map((token) => db.ref(`drivers/${after}/fcmTokens/${token}`).remove())
    );
  }
);


/* =========================================================
   crearPedido — el ÚNICO camino para que la tienda cree un pedido
   =========================================================
   Antes `placeOrder()` (js/auth.js) escribía el pedido directo en
   RTDB con el subtotal/envío/total que calculaba el navegador:
   cualquiera con las herramientas de desarrollador podía pedir al
   precio que quisiera y a caja le llegaba como pedido legítimo.

   Ahora el navegador solo manda QUÉ quiere (ids, cantidades, notas,
   dirección…) y esta función arma el pedido con los precios reales de
   `products`, el envío de `settings` y las mismas validaciones del
   checkout (horario, zona, mínimo, agotados, cliente bloqueado) — todas
   en lib/reglas-pedido.mjs, copia exacta de js/reglas-pedido.js.
   database.rules.json ya NO deja que un cliente cree pedidos: solo esta
   función (Admin SDK) y el personal de mesa.

   `totalEsperado` (opcional): el total que el cliente vio en pantalla.
   Si no coincide con el real (cambió un precio mientras tenía el
   carrito guardado), se rechaza con "aborted" en vez de cobrarle algo
   que no vio — el checkout refresca los precios y le pide confirmar.
   ========================================================= */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { ServerValue } = require('firebase-admin/database');

// reglas-pedido.mjs es ESM (el mismo archivo que carga el navegador);
// desde CommonJS se carga con import() dinámico, una sola vez.
let reglasPedido;
const cargarReglas = () => (reglasPedido ||= import('./lib/reglas-pedido.mjs'));

/* Límite de intentos por cliente (2026-10-13): crearPedido y
   crearPagoEnLinea suman juntos en limitePedidos/{uid} (lista de marcas
   de tiempo; las reglas no dejan a ningún cliente leerla ni escribirla).
   Cuenta cada intento, también los rechazados, para frenar a un script
   que dispare pedidos o pagos falsos en ráfaga. Un cliente real no llega:
   aun reintentando un pago o con un precio que cambió, son 2 o 3. */
const LIMITE_INTENTOS = 10;
const LIMITE_VENTANA_MS = 10 * 60 * 1000;

async function respetarLimite(db, uid) {
  const ahora = Date.now();
  let excedido = false;
  await db.ref(`limitePedidos/${uid}`).transaction((actual) => {
    const recientes = Object.values(actual || {}).filter((t) => typeof t === 'number' && ahora - t < LIMITE_VENTANA_MS);
    excedido = recientes.length >= LIMITE_INTENTOS;
    if (excedido) return; // aborta: no se anota el intento
    return [...recientes, ahora];
  });
  if (excedido) {
    throw new HttpsError('resource-exhausted', 'Hiciste muchos intentos de pedido seguidos. Espera unos minutos e inténtalo de nuevo.');
  }
}

// Valida y arma el pedido con los datos reales (lo comparten crearPedido
// y crearPagoEnLinea). Lanza HttpsError si algo no cuadra.
async function prepararPedido(auth, data) {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para confirmar el pedido.');
  }

  const { construirPedido } = await cargarReglas();
  const db = getDatabase();
  await respetarLimite(db, auth.uid);
  const [products, outOfStock, settings, flag] = (
    await Promise.all([
      db.ref('products').get(),
      db.ref('outOfStock').get(),
      db.ref('settings').get(),
      db.ref(`customerFlags/${auth.uid}`).get(),
    ])
  ).map((snap) => snap.val());

  const pedido = construirPedido({
    datos: data,
    products: products || {},
    outOfStock: outOfStock || {},
    settings: settings || {},
    bloqueado: Boolean(flag && flag.blocked),
  });

  if (pedido.problemas.length > 0) {
    throw new HttpsError('failed-precondition', pedido.problemas[0], { problemas: pedido.problemas });
  }

  const { subtotal, shipping, total, items, campos } = pedido;
  if (data && data.totalEsperado !== undefined && data.totalEsperado !== total) {
    throw new HttpsError(
      'aborted',
      'Los precios de tu carrito cambiaron. Revisa el total antes de confirmar.',
      { subtotal, shipping, total, items: items.map(({ id, price }) => ({ id, price })) }
    );
  }

  return {
    uid: auth.uid,
    customerName: auth.token.name || null,
    customerEmail: auth.token.email || null,
    campos,
    items,
    subtotal,
    shipping,
    total,
  };
}

// Escribe el pedido en `orders` y descuenta inventario. `extra` = campos
// adicionales (los del pago en línea). Devuelve la llave del pedido.
async function guardarPedido(db, { uid, customerName, customerEmail, campos, items, subtotal, shipping, total }, extra = {}, orderRef = db.ref('orders').push()) {
  await orderRef.set({
    uid,
    customerName,
    customerEmail,
    // `orders` es compartida con los pedidos de mesa (fusión) — `origen`
    // distingue el tipo. Ver docs-fusion/ESQUEMA-UNIFICADO.md.
    origen: campos.deliveryMode,
    ...campos,
    items,
    // `lineas` = mismo array que `items`, con el nombre que espera
    // panel-cocina del sistema de mesas (agruparPorRonda).
    lineas: items,
    rondaActual: 1,
    subtotal,
    shipping,
    total,
    status: 'recibido',
    createdAt: ServerValue.TIMESTAMP,
    ...extra,
  });

  // Descuento de inventario: solo para productos con conteo numérico
  // (pestaña Inventario del panel). Best-effort, igual que antes: el
  // pedido ya quedó creado; si esto falla, el conteo se corrige a mano.
  const pedidasPorId = {};
  for (const { id, qty } of items) pedidasPorId[id] = (pedidasPorId[id] || 0) + qty;
  await Promise.allSettled(
    Object.entries(pedidasPorId).map(([id, qty]) =>
      db.ref(`outOfStock/${id}`).transaction((actual) =>
        typeof actual === 'number' ? Math.max(0, actual - qty) : actual
      )
    )
  );

  return orderRef.key;
}

exports.crearPedido = onCall({ region: 'us-central1', maxInstances: 5 }, async (request) => {
  const pedido = await prepararPedido(request.auth, request.data);
  const orderId = await guardarPedido(getDatabase(), pedido);
  const { subtotal, shipping, total } = pedido;
  return { orderId, subtotal, shipping, total };
});

/* =========================================================
   Pago en línea (AAvance / Coopcentral) — ver
   docs-fusion/PLAN-PASARELA-PAGO.md
   =========================================================
   1. crearPagoEnLinea: arma el pedido igual que crearPedido, pero lo
      deja en pagosPendientes/{orderNumber} (NO en `orders`: caja y
      cocina no lo ven hasta que esté pagado) y devuelve los campos del
      <form> de AAvance con el total calculado aquí.
   2. webhookAAvance (AAvance avisa) y verificarPagoEnLinea (el cliente
      vuelve de pagar) llaman a confirmarPagoPendiente: consulta la
      transacción en la API de AAvance con la ApiKey y exige aprobada
      (idstatus 34) Y el monto exacto. Solo entonces el pedido pasa a
      `orders` con pagado: true. Lo que llegue en el cuerpo del webhook
      no se cree: solo se usa el número de orden para consultar.
   La ApiKey vive en Secret Manager (PASARELA_API_KEY); el resto de
   PASARELA_* (no secretos) en functions/.env.
   ========================================================= */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const { verificarPago } = require('./lib/confirmarPago');

const PASARELA_API_KEY = defineSecret('PASARELA_API_KEY');
const ORDEN_VALIDA = /^RC\d{13,20}$/;
const PAGO_PLAZO_MS = 30 * 60 * 1000;

const recortar = (valor, max) => String(valor || '').replace(/[\r\n<>]+/g, ' ').trim().slice(0, max);

exports.crearPagoEnLinea = onCall({ region: 'us-central1', maxInstances: 5 }, async (request) => {
  const pedido = await prepararPedido(request.auth, request.data);
  const db = getDatabase();

  const enLinea = (await db.ref('settings/pagoEnLinea').get()).val();
  if (enLinea !== true) {
    throw new HttpsError('failed-precondition', 'El pago en línea no está disponible en este momento.');
  }
  const orderNumber = 'RC' + Date.now() + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  await db.ref(`pagosPendientes/${orderNumber}`).set({
    ...pedido,
    estado: 'pendiente',
    createdAt: ServerValue.TIMESTAMP,
  });

  const nombre = recortar(pedido.customerName, 60) || 'Cliente';
  const [firstname, ...resto] = nombre.split(/\s+/);
  return {
    action: process.env.PASARELA_URL_REDIRECT,
    campos: {
      merchant_id: process.env.PASARELA_MERCHANT_ID,
      form_id: process.env.PASARELA_FORM_ID,
      terminal_id: process.env.PASARELA_TERMINAL_ID,
      order_number: orderNumber,
      amount: String(pedido.total),
      currency: 'COP',
      order_description: 'Pedido Rodizio Cucuta ' + orderNumber,
      client_email: pedido.customerEmail || '',
      client_phone: recortar(pedido.campos.phone, 20),
      client_firstname: firstname,
      client_lastname: resto.join(' ') || firstname,
    },
    orderNumber,
    total: pedido.total,
  };
});

// Idempotente: si ya se confirmó (webhook y cliente a la vez), devuelve
// el mismo pedido sin duplicarlo.
async function confirmarPagoPendiente(orderNumber) {
  const db = getDatabase();
  const pendienteRef = db.ref(`pagosPendientes/${orderNumber}`);
  const pendiente = (await pendienteRef.get()).val();
  if (!pendiente) return { estado: 'no_existe' };
  if (pendiente.orderId) return { estado: 'pagado', orderId: pendiente.orderId };

  const resultado = await verificarPago(orderNumber, pendiente.total);
  // Sin transacción en AAvance pasado el plazo: el cliente nunca llegó a
  // pagar (cerró la página o AAvance no la creó). Se da por expirado para
  // que la tienda deje de verificarlo en cada visita.
  if (!resultado.transaccion && Date.now() - (pendiente.createdAt || 0) > PAGO_PLAZO_MS) {
    await pendienteRef.update({ estado: 'expirado', revisadoEn: ServerValue.TIMESTAMP });
    return { estado: 'expirado' };
  }
  if (!resultado.pagoValido) {
    // 34 con otro monto: no se crea el pedido, queda para revisión.
    // 36 = Fallida. Cualquier otro estado (p. ej. PSE en proceso) sigue pendiente.
    const estado = resultado.idstatus === 34 ? 'monto_no_coincide' : resultado.idstatus === 36 ? 'rechazado' : 'pendiente';
    if (estado === 'monto_no_coincide') {
      logger.error('Pago con monto distinto', { orderNumber, esperado: pendiente.total, cobrado: resultado.montoCobrado });
    }
    await pendienteRef.update({
      estado,
      ultimoEstadoAAvance: resultado.idstatusNombre || null,
      revisadoEn: ServerValue.TIMESTAMP,
    });
    return { estado };
  }

  // Reserva la llave del pedido con una transacción: solo un llamador lo crea.
  const nuevaRef = db.ref('orders').push();
  const { committed, snapshot } = await pendienteRef.child('orderId').transaction((actual) =>
    actual ? undefined : nuevaRef.key
  );
  if (!committed) return { estado: 'pagado', orderId: snapshot.val() };

  try {
    await guardarPedido(db, pendiente, {
    pagado: true,
    metodoPago: 'en_linea',
    tsPago: Date.now(),
    pagoEnLinea: {
      orderNumber,
      transaccionId: resultado.transaccion?.id ?? null,
      metodo: recortar(resultado.transaccion?.paymentmethod?.nombre || resultado.transaccion?.paymentmethod, 40) || null,
    },
    }, nuevaRef);
  } catch (error) {
    // Libera la reserva para que el próximo aviso lo vuelva a intentar.
    await pendienteRef.child('orderId').remove();
    throw error;
  }
  await pendienteRef.update({ estado: 'pagado', revisadoEn: ServerValue.TIMESTAMP });
  return { estado: 'pagado', orderId: nuevaRef.key };
}

exports.verificarPagoEnLinea = onCall(
  { region: 'us-central1', maxInstances: 5, secrets: [PASARELA_API_KEY] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    const orderNumber = String(request.data?.orderNumber || '');
    if (!ORDEN_VALIDA.test(orderNumber)) throw new HttpsError('invalid-argument', 'Número de orden inválido.');

    const uid = (await getDatabase().ref(`pagosPendientes/${orderNumber}/uid`).get()).val();
    if (uid !== request.auth.uid) throw new HttpsError('not-found', 'No encontramos ese pago.');
    return confirmarPagoPendiente(orderNumber);
  }
);

// URL a registrar en el panel de AAvance (terminal → Webhook, con
// "Activar notificaciones" en Sí). Según su documentación: responder
// 200 si la transacción quedó aprobada, 201 en cualquier otro caso.
exports.webhookAAvance = onRequest(
  { region: 'us-central1', maxInstances: 5, secrets: [PASARELA_API_KEY] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Método no permitido');
      return;
    }
    const cuerpo = req.body || {};
    const orderNumber = String(cuerpo.externalorder || cuerpo.external_order || cuerpo.order_number || '');
    if (!ORDEN_VALIDA.test(orderNumber)) {
      res.status(201).send('Orden desconocida');
      return;
    }
    try {
      const { estado } = await confirmarPagoPendiente(orderNumber);
      res.status(estado === 'pagado' ? 200 : 201).send(estado);
    } catch (error) {
      logger.error('webhookAAvance falló', { orderNumber, error: error.message });
      res.status(500).send('Error');
    }
  }
);

/* reporteCsp — los navegadores avisan aquí cuando algo de la tienda
   choca con la Content-Security-Policy, que va en modo "solo reportar"
   (Content-Security-Policy-Report-Only en tienda/firebase.json): no
   bloquea nada todavía. Cada aviso queda en los logs de Cloud Functions
   (filtrar por "CSP") para ajustar la política antes de aplicarla. No
   guarda nada en la base; las URLs se anotan sin ?query (pueden llevar
   el número de pago). */
exports.reporteCsp = onRequest({ region: 'us-central1', maxInstances: 2, memory: '128MiB' }, (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }
  try {
    const crudo = req.rawBody ? req.rawBody.toString('utf8') : '';
    if (crudo.length <= 10000) {
      const cuerpo = JSON.parse(crudo || '{}');
      const r = cuerpo['csp-report'] || cuerpo;
      const sinQuery = (valor) => recortar(String(valor || '').split(/[?#]/)[0], 200);
      logger.warn('CSP', {
        pagina: sinQuery(r['document-uri']),
        directiva: recortar(r['effective-directive'] || r['violated-directive'], 80),
        bloqueado: sinQuery(r['blocked-uri']),
        archivo: sinQuery(r['source-file']),
        linea: Number(r['line-number']) || null,
      });
    }
  } catch {
    // Un cuerpo que no es JSON se ignora: el navegador no espera respuesta útil.
  }
  res.status(204).end();
});

/* =========================================================
   Cómo desplegar
   =========================================================
   Requiere plan Blaze (activo desde 2026-10). Desde tienda/:

     cd functions && npm install && cd ..
     firebase deploy --only functions --project rodiziomarketplace

   El predeploy de tienda/firebase.json regenera
   lib/reglas-pedido.mjs desde js/reglas-pedido.js antes de subir.

   Probar en local (emuladores de auth + database + functions, con
   las reglas reales de ../database.rules.json):
     cd functions && npm test
   ========================================================= */

/* fotoMenuSubida — cada foto que llega a Storage en menu/ (lista) o
   menu/hd/ (detalle) queda con caché pública. Sin esto Storage las sirve
   con "private, max-age=0" y el celular las vuelve a pedir en cada visita.
   Un día de caché: si el dueño reemplaza una foto con el mismo nombre, se
   ve la nueva a más tardar al día siguiente. */
const { onObjectFinalized } = require('firebase-functions/v2/storage');
const { getStorage } = require('firebase-admin/storage');
const CACHE_FOTOS = 'public, max-age=86400';

exports.fotoMenuSubida = onObjectFinalized(
  { bucket: 'rodiziomarketplace.firebasestorage.app', region: 'us-east1', maxInstances: 5 },
  async (event) => {
    const { name, contentType, cacheControl } = event.data;
    if (!name || !name.startsWith('menu/') || !(contentType || '').startsWith('image/')) return;
    if (cacheControl === CACHE_FOTOS) return; // ya quedó (setMetadata no vuelve a disparar finalize)
    await getStorage().bucket(event.data.bucket).file(name).setMetadata({ cacheControl: CACHE_FOTOS });
  }
);
