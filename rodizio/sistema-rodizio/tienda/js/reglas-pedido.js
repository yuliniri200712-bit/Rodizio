/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   Reglas de negocio del pedido — UNA sola fuente para el navegador
   y para la Cloud Function `crearPedido`.

   Este archivo NO importa nada (ni Firebase ni otros módulos) a
   propósito: así lo pueden cargar tal cual el navegador (vía
   settings.js) y Node (functions/lib/reglas-pedido.mjs es una COPIA
   EXACTA, generada por scripts/sync-reglas-pedido.mjs — no editar la
   copia a mano, el test de functions falla si difieren).

   Por qué existe: antes el total lo calculaba el navegador y se
   guardaba tal cual (cualquiera con DevTools podía pedir al precio
   que quisiera). Ahora el servidor arma el pedido con
   `construirPedido()` leyendo los precios reales de `products`; si
   la zona, el horario o el mínimo se calcularan distinto en cada
   lado, el cliente vería un total y se le cobraría otro — por eso
   la lógica vive en un solo lugar.
   ========================================================= */

// Valor por defecto mientras carga, o si "settings" todavía no
// existe en la base de datos — la app nunca debe romperse por
// falta de configuración.
export const DEFAULT_SETTINGS = {
  isOpen: true,
  closedMessage: 'Estamos cerrados en este momento. Vuelve a intentarlo más tarde.',
  restaurantPhone: '',
  minOrderDomicilio: 0,
  restrictToZones: false,
  defaultShippingFee: 5000,
  coverageZones: [],
  // Hora de cierre del día (formato "HH:MM", 24h) — opcional, solo se usa
  // cuando "useSchedule" está apagado (horario manual, ver abajo).
  closingTime: '',
  // Horario automático: si "useSchedule" está prendido, "isOpen"/"closingTime"
  // de arriba dejan de leerse — el estado abierto/cerrado y el mensaje se
  // calculan solos a partir de "weeklyHours" (ver getScheduleStatus más abajo).
  useSchedule: false,
  // '' = seguir el horario automáticamente; 'open'/'closed' = el dueño lo
  // forzó a mano por encima del horario (ej. cerrar temprano un día especial).
  manualOverride: '',
  weeklyHours: {
    dom: { closed: false, open: '11:00', close: '22:00' },
    lun: { closed: false, open: '11:00', close: '22:00' },
    mar: { closed: false, open: '11:00', close: '22:00' },
    mie: { closed: false, open: '11:00', close: '22:00' },
    jue: { closed: false, open: '11:00', close: '22:00' },
    vie: { closed: false, open: '11:00', close: '22:00' },
    sab: { closed: false, open: '11:00', close: '22:00' },
  },
  // Botón "Pago en línea" del checkout — apagado hasta que la pasarela
  // esté verificada del lado del servidor (docs-fusion/PLAN-MAESTRO.md,
  // Fase 3). Se prende desde la consola: settings/pagoEnLinea = true.
  pagoEnLinea: false,
  // Pausa solo de domicilios (sin domiciliarios, cocina llena…): la tienda
  // sigue abierta para "recoger en tienda". La pueden prender el cajero
  // (panel-caja, pestaña Domicilios) y el dueño (admin → Horario).
  domiciliosPausados: false,
};

export const MENSAJE_DOMICILIOS_PAUSADOS =
  'Los domicilios están pausados en este momento. Puedes pedir para recoger en tienda.';

export const DAY_KEYS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
export const DAY_LABELS = { dom: 'domingo', lun: 'lunes', mar: 'martes', mie: 'miércoles', jue: 'jueves', vie: 'viernes', sab: 'sábado' };

/* Devuelve un Date cuyo getHours/getMinutes/getDay reflejan la hora
   en Colombia (America/Bogota, UTC-5), sin importar el huso del
   navegador ni del servidor (las Cloud Functions corren en UTC).
   Se usa en todo lo que decide si el negocio está abierto o cerrado. */
export function nowInColombia(base = new Date()) {
  // Construir un string en zona Colombia y parsearlo de vuelta para que
  // getHours/getMinutes/getDay devuelvan valores de Colombia.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(base);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '0';
  return new Date(+get('year'), +get('month') - 1, +get('day'), +get('hour'), +get('minute'), +get('second'));
}

function timeToMinutes(str) {
  const [h, m] = (str || '0:0').split(':').map(Number);
  return h * 60 + m;
}

function todayHours(settings, date) {
  return (settings.weeklyHours || {})[DAY_KEYS[date.getDay()]] || null;
}

// Nota: si el horario de un día cruza medianoche (close <= open, ej. abre
// 18:00 y cierra 02:00), isWithinHours lo detecta bien, pero el cálculo de
// "minutos para cerrar" en getScheduleStatus no compensa ese cruce — para
// un restaurante que no opera pasada la medianoche (el caso de hoy) no hace
// falta más; si algún día se necesita, revisar esa cuenta ahí.
function isWithinHours(nowMin, hours) {
  if (!hours || hours.closed || !hours.open || !hours.close) return false;
  const openMin = timeToMinutes(hours.open);
  const closeMin = timeToMinutes(hours.close);
  if (closeMin <= openMin) return nowMin >= openMin || nowMin < closeMin;
  return nowMin >= openMin && nowMin < closeMin;
}

function findNextOpen(settings, from) {
  for (let i = 0; i <= 7; i++) {
    const date = new Date(from.getTime() + i * 86400000);
    const hours = todayHours(settings, date);
    if (!hours || hours.closed || !hours.open) continue;
    if (i === 0) {
      const nowMin = from.getHours() * 60 + from.getMinutes();
      if (timeToMinutes(hours.open) <= nowMin) continue; // ya pasó la apertura de hoy
      return { label: 'hoy', time: hours.open };
    }
    return { label: i === 1 ? 'mañana' : DAY_LABELS[DAY_KEYS[date.getDay()]], time: hours.open };
  }
  return null;
}

/* Calcula si el negocio está abierto AHORA MISMO y el mensaje/minutos
   restantes que debe ver el cliente — centraliza esta cuenta para que
   app.js, ui.js, admin.js y la Cloud Function no la dupliquen.
   Prioridad: override manual del dueño > horario automático > horario
   manual clásico (isOpen/closingTime, para instalaciones que no activaron
   el horario automático). */
export function getScheduleStatus(settings, now = nowInColombia()) {
  if (settings.manualOverride === 'open') {
    return { isOpen: true, closedMessage: '', minutesUntilClose: null };
  }
  if (settings.manualOverride === 'closed') {
    return {
      isOpen: false,
      closedMessage: settings.closedMessage || DEFAULT_SETTINGS.closedMessage,
      minutesUntilClose: null,
    };
  }
  if (!settings.useSchedule) {
    const isOpen = settings.isOpen !== false;
    const closingTime = (settings.closingTime || '').trim();
    let minutesUntilClose = null;
    if (isOpen && /^\d{1,2}:\d{2}$/.test(closingTime)) {
      minutesUntilClose = timeToMinutes(closingTime) - (now.getHours() * 60 + now.getMinutes());
    }
    return { isOpen, closedMessage: settings.closedMessage || DEFAULT_SETTINGS.closedMessage, minutesUntilClose };
  }
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const hours = todayHours(settings, now);
  if (isWithinHours(nowMin, hours)) {
    return { isOpen: true, closedMessage: '', minutesUntilClose: timeToMinutes(hours.close) - nowMin };
  }
  const next = findNextOpen(settings, now);
  const closedMessage = next
    ? `Estamos cerrados ahora. Abrimos ${next.label} a las ${next.time}.`
    : settings.closedMessage || DEFAULT_SETTINGS.closedMessage;
  return { isOpen: false, closedMessage, minutesUntilClose: null };
}

/* Compara la dirección escrita por el cliente contra las palabras
   clave de cada zona (barrio, sector) — coincidencia simple de
   texto, no geolocalización real. Devuelve la primera zona que
   coincida, o null si ninguna coincide. */
export function matchZone(address, coverageZones) {
  if (!address) return null;
  const normalized = address
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    (coverageZones || []).find((zone) =>
      (zone.keywords || []).some((kw) => {
        const k = kw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        return k && normalized.includes(k);
      })
    ) || null
  );
}

/* Costo del domicilio: la zona que coincida con la dirección, o el
   valor por defecto. "recoger" siempre es 0. */
export function shippingFee(deliveryMode, address, settings) {
  if (deliveryMode === 'recoger') return 0;
  const zone = matchZone(address, settings.coverageZones);
  if (zone && Number.isFinite(zone.fee)) return zone.fee;
  return settings.defaultShippingFee ?? DEFAULT_SETTINGS.defaultShippingFee;
}

/* Un producto está agotado si outOfStock/{id} es `true` o `0`; un
   número mayor a 0 son unidades restantes (sigue disponible). */
export function unidadesDisponibles(outOfStock, id) {
  const v = (outOfStock || {})[id];
  if (v === true || v === 0) return 0;
  if (typeof v === 'number') return v;
  return Infinity;
}

export const LIMITES_PEDIDO = {
  maxLineas: 60,
  maxCantidad: 99,
  maxNota: 200,
  maxTelefono: 30,
  maxDireccion: 300,
  maxReferencia: 300,
};

/* Solo estas categorías se venden desde el Marketplace. Cualquier
   categoría nueva queda como muestra hasta que se agregue aquí. Se usan
   IDs estables, no los nombres visibles que se pueden editar en el panel. */
const CATEGORIAS_VENDIBLES = new Set(['burger-angus', 'rodizio-casero']);

export function esProductoVendible(producto) {
  return Boolean(producto && CATEGORIAS_VENDIBLES.has(producto.categoryId));
}

/* Bebidas con alcohol (2026-10-13): las categorías de licor y, dentro de
   "bebidas", el subgrupo "cervezas". Si el carrito trae alguna, el
   cliente debe confirmar que es mayor de 18 años (casilla del checkout) y
   el servidor rechaza el pedido sin esa confirmación. Un producto nuevo
   con alcohol debe ir en una de estas categorías o con ese subgrupo, o
   no se le pedirá la confirmación. */
const CATEGORIAS_ALCOHOL = ['cervezas-3-cordilleras', 'cocteles'];

export function esAlcohol(producto) {
  return Boolean(producto) && (CATEGORIAS_ALCOHOL.includes(producto.categoryId) || producto.subGroup === 'cervezas');
}

function textoCorto(valor, max) {
  return typeof valor === 'string' ? valor.trim().slice(0, max) : '';
}

/* Arma el pedido con los precios REALES — nunca con los que mande el
   navegador. De cada línea del carrito solo se usan `id`, `qty` y
   `notes`; nombre, precio e imagen salen de `products`.

   datos: lo que manda el checkout ({ items, deliveryMode, address,
     reference, phone, customerLocation, scheduledFor, mayorDeEdad }).
   Devuelve { problemas, items, subtotal, shipping, total, campos }.
   Si `problemas` trae algo, el pedido NO se debe crear — el primer
   problema es el mensaje que ve el cliente. */
export function construirPedido({ datos, products, outOfStock, settings: settingsRaw, bloqueado = false, ahora = Date.now() }) {
  const settings = { ...DEFAULT_SETTINGS, ...(settingsRaw || {}) };
  const problemas = [];
  const d = datos || {};

  if (bloqueado) {
    problemas.push('No podemos procesar tu pedido en este momento. Llámanos para más información.');
  }

  const estado = getScheduleStatus(settings, nowInColombia(new Date(ahora)));
  if (!estado.isOpen) {
    problemas.push(estado.closedMessage || DEFAULT_SETTINGS.closedMessage);
  }

  const deliveryMode = d.deliveryMode === 'recoger' ? 'recoger' : d.deliveryMode === 'domicilio' ? 'domicilio' : null;
  if (!deliveryMode) problemas.push('Elige si lo quieres a domicilio o para recoger.');
  if (deliveryMode === 'domicilio' && settings.domiciliosPausados === true) {
    problemas.push(MENSAJE_DOMICILIOS_PAUSADOS);
  }

  const phone = textoCorto(d.phone, LIMITES_PEDIDO.maxTelefono);
  if (!phone) problemas.push('Ingresa un teléfono de contacto');

  const address = deliveryMode === 'domicilio' ? textoCorto(d.address, LIMITES_PEDIDO.maxDireccion) : '';
  if (deliveryMode === 'domicilio' && !address) problemas.push('Ingresa la dirección de entrega');

  const reference = textoCorto(d.reference, LIMITES_PEDIDO.maxReferencia);

  let customerLocation = null;
  const loc = d.customerLocation;
  if (
    deliveryMode === 'domicilio' && loc && typeof loc === 'object' &&
    Number.isFinite(loc.lat) && Number.isFinite(loc.lng) &&
    Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180
  ) {
    customerLocation = { lat: loc.lat, lng: loc.lng };
  }

  // La hora programada la arma el navegador (resolveScheduledFor en
  // app.js) — acá solo se descarta basura: debe ser un número dentro
  // de un día alrededor de ahora.
  let scheduledFor = null;
  if (d.scheduledFor !== null && d.scheduledFor !== undefined) {
    if (Number.isFinite(d.scheduledFor) && Math.abs(d.scheduledFor - ahora) <= 86400000) {
      scheduledFor = d.scheduledFor;
    } else {
      problemas.push('La hora programada no es válida. Elígela de nuevo.');
    }
  }

  const lineas = Array.isArray(d.items) ? d.items : [];
  if (lineas.length === 0) problemas.push('El carrito está vacío.');
  if (lineas.length > LIMITES_PEDIDO.maxLineas) problemas.push('El pedido tiene demasiados productos.');

  const items = [];
  const pedidasPorId = {};
  for (const linea of lineas.slice(0, LIMITES_PEDIDO.maxLineas)) {
    const id = linea && typeof linea.id === 'string' ? linea.id : '';
    // hasOwnProperty: un id como "__proto__" o "constructor" no debe
    // encontrar las propiedades heredadas del objeto.
    const producto = id && products && Object.prototype.hasOwnProperty.call(products, id) ? products[id] : null;
    if (!producto) {
      problemas.push('Uno de los productos de tu carrito ya no existe. Quítalo e intenta de nuevo.');
      continue;
    }
    const nombre = producto.name || id;
    if (producto.hidden) {
      problemas.push(`"${nombre}" ya no está disponible.`);
      continue;
    }
    if (!esProductoVendible(producto)) {
      problemas.push(`"${nombre}" solo está disponible en el restaurante y no se puede pedir por el Marketplace.`);
      continue;
    }
    const qty = linea.qty;
    if (!Number.isInteger(qty) || qty < 1 || qty > LIMITES_PEDIDO.maxCantidad) {
      problemas.push(`Cantidad inválida para "${nombre}".`);
      continue;
    }
    if (!Number.isFinite(producto.price) || producto.price < 0) {
      problemas.push(`"${nombre}" no tiene un precio válido. Llámanos para pedirlo.`);
      continue;
    }
    pedidasPorId[id] = (pedidasPorId[id] || 0) + qty;
    items.push({
      id,
      name: nombre,
      price: producto.price,
      qty,
      notes: textoCorto(linea.notes, LIMITES_PEDIDO.maxNota),
      image: producto.image || '',
    });
  }

  for (const [id, pedidas] of Object.entries(pedidasPorId)) {
    const disponibles = unidadesDisponibles(outOfStock, id);
    const nombre = products[id].name || id;
    if (disponibles === 0) problemas.push(`"${nombre}" está agotado.`);
    else if (pedidas > disponibles) problemas.push(`Solo quedan ${disponibles} de "${nombre}".`);
  }

  const llevaAlcohol = items.some((i) => esAlcohol(products[i.id]));
  if (llevaAlcohol && d.mayorDeEdad !== true) {
    problemas.push('Confirma que eres mayor de 18 años para pedir bebidas con alcohol.');
  }

  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);

  if (
    deliveryMode === 'domicilio' &&
    settings.restrictToZones &&
    (settings.coverageZones || []).length > 0 &&
    !matchZone(address, settings.coverageZones)
  ) {
    problemas.push('Esa dirección está fuera de nuestra zona de cobertura — revísala o llámanos');
  }

  const minOrder = deliveryMode === 'domicilio' ? settings.minOrderDomicilio || 0 : 0;
  if (minOrder > 0 && subtotal < minOrder) {
    problemas.push(`El pedido mínimo a domicilio es $${minOrder.toLocaleString('es-CO')}`);
  }

  const shipping = deliveryMode ? shippingFee(deliveryMode, address, settings) : 0;
  const total = Math.max(0, subtotal + shipping);

  return {
    problemas,
    items,
    subtotal,
    shipping,
    total,
    campos: {
      deliveryMode,
      address: deliveryMode === 'domicilio' ? address : null,
      customerLocation,
      reference,
      phone,
      scheduledFor,
      // Queda en el pedido como constancia de que el cliente lo confirmó.
      mayorDeEdad: llevaAlcohol ? true : null,
    },
  };
}
