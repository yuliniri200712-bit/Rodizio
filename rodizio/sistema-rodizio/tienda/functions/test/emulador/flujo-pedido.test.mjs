/* Prueba de punta a punta contra los EMULADORES (auth + database +
   functions), con las reglas reales de ../database.rules.json y la
   función crearPedido real. Proyecto "demo-rodizio": los emuladores
   nunca tocan recursos reales con un id demo-*.

   Correr desde tienda/functions:  npm test
   (levanta los emuladores, corre esto y los apaga). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { initializeApp as initAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getDatabase as getAdminDb } from 'firebase-admin/database';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getDatabase, connectDatabaseEmulator, ref, push, set, update, get, query, orderByChild, equalTo, serverTimestamp,
} from 'firebase/database';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

const PROJECT = 'demo-rodizio';
// El emulador de functions (CLI 13) arma databaseURL con ns=<projectId>, no
// <projectId>-default-rtdb: la prueba usa ese mismo namespace para ver lo
// que escribe crearPedido. En producción getDatabase() usa la instancia real.
const DB_URL = `https://${PROJECT}.firebaseio.com`;
const CLAVE = 'secreto123';
const DENEGADO = /permission[_ ]denied/i;

const adminApp = initAdmin({ projectId: PROJECT, databaseURL: DB_URL }, 'admin-pruebas');
const adminDb = getAdminDb(adminApp);
const clientes = [];

async function conectarComo(uid) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key', databaseURL: DB_URL }, `app-${uid || 'anonimo'}`);
  clientes.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getDatabase(app);
  connectDatabaseEmulator(db, '127.0.0.1', 9000);
  const fns = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(fns, '127.0.0.1', 5001);
  if (uid) await signInWithEmailAndPassword(auth, `${uid}@test.local`, CLAVE);
  return {
    db,
    crearPedido: httpsCallable(fns, 'crearPedido'),
    crearPagoEnLinea: httpsCallable(fns, 'crearPagoEnLinea'),
    verificarPagoEnLinea: httpsCallable(fns, 'verificarPagoEnLinea'),
  };
}

const CHECKOUT = { deliveryMode: 'domicilio', phone: '3001234567', address: 'Barrio Caobos', reference: 'Casa azul' };

let cliente, cliente2, bloqueado, anonimo, domi, domiSinAcceso, mesero, adminTienda, adminMesa, apurado;

before(async () => {
  const adminAuth = getAdminAuth(adminApp);
  const usuarios = ['cliente1', 'cliente2', 'bloqueado1', 'driver1', 'driver2', 'trabajador1', 'admintienda', 'adminmesa', 'apurado1'];
  for (const uid of usuarios) {
    await adminAuth.createUser({ uid, email: `${uid}@test.local`, password: CLAVE, displayName: `Usuario ${uid}` });
  }
  await adminDb.ref().set({
    products: {
      'PAR-01': { name: 'Picanha', price: 50000, image: 'icons/menu/pa1.webp', categoryId: 'burger-angus' },
      'BEB-01': { name: 'Limonada', price: 15000, image: '', categoryId: 'rodizio-casero' },
      'MUE-01': { name: 'Asado de muestra', price: 30000, image: '', categoryId: 'de-la-parrilla' },
    },
    settings: {
      manualOverride: 'open',
      defaultShippingFee: 5000,
      minOrderDomicilio: 0,
      coverageZones: [{ name: 'Caobos', fee: 7000, keywords: ['caobos'] }],
    },
    outOfStock: { 'BEB-01': 5 },
    customerFlags: { bloqueado1: { blocked: true } },
    trabajadores: {
      trabajador1: { estado: 'activo', usuario: 'mesero' },
      adminmesa: { estado: 'activo', usuario: 'jefe', rolesPermitidos: { admin: true } },
    },
    productsMesa: { 'ENT-01': { nombre: 'Empanadas', precio: 12000, cat: 'ENT' } },
    admins: { admintienda: true },
    drivers: { driver1: { access: true, name: 'Domi Uno' }, driver2: { access: false, name: 'Domi Dos' } },
  });

  [cliente, cliente2, bloqueado, anonimo, domi, domiSinAcceso, mesero, adminTienda, adminMesa, apurado] = await Promise.all([
    conectarComo('cliente1'), conectarComo('cliente2'), conectarComo('bloqueado1'), conectarComo(null),
    conectarComo('driver1'), conectarComo('driver2'), conectarComo('trabajador1'), conectarComo('admintienda'),
    conectarComo('adminmesa'), conectarComo('apurado1'),
  ]);

  // Calentamiento: en este PC el primer arranque de una función tarda ~10 s
  // y a veces el emulador lo corta ("Failed to load function"), dejando la
  // llamada colgada hasta el timeout de 70 s. Se reintenta una llamada
  // inofensiva hasta recibir la respuesta esperada (invalid-argument).
  // clientes[0] = cliente1, ya con sesión y conectado al emulador.
  const calentar = httpsCallable(getFunctions(clientes[0], 'us-central1'), 'verificarPagoEnLinea', { timeout: 20000 });
  for (let intento = 0; intento < 4; intento++) {
    try { await calentar({ orderNumber: 'x' }); break; } catch (e) { if (e.code === 'functions/invalid-argument') break; }
  }
});

after(async () => {
  await Promise.all(clientes.map((app) => deleteApp(app)));
  await deleteAdmin(adminApp);
});

/* ---------- crearPedido ---------- */

let pedidoId;

test('crearPedido usa los precios reales aunque el navegador mande otros', async () => {
  const { data } = await cliente.crearPedido({
    ...CHECKOUT,
    items: [{ id: 'PAR-01', qty: 2, price: 1, name: 'GRATIS', notes: 'bien asada' }],
    total: 1,
    pagado: true,
    totalEsperado: 107000,
  });
  assert.deepEqual({ subtotal: data.subtotal, shipping: data.shipping, total: data.total }, { subtotal: 100000, shipping: 7000, total: 107000 });
  pedidoId = data.orderId;

  const pedido = (await adminDb.ref(`orders/${pedidoId}`).get()).val();
  assert.equal(pedido.uid, 'cliente1');
  assert.equal(pedido.customerName, 'Usuario cliente1');
  assert.equal(pedido.origen, 'domicilio');
  assert.equal(pedido.status, 'recibido');
  assert.equal(pedido.rondaActual, 1);
  assert.equal(pedido.total, 107000);
  assert.equal(pedido.pagado, undefined, 'pagado no debe venir del navegador');
  assert.equal(typeof pedido.createdAt, 'number');
  assert.deepEqual(pedido.items, [{ id: 'PAR-01', name: 'Picanha', price: 50000, qty: 2, notes: 'bien asada', image: 'icons/menu/pa1.webp' }]);
  assert.deepEqual(pedido.lineas, pedido.items);
});

test('el servidor rechaza muestras tanto en pedido normal como en pago en línea', async () => {
  const muestra = { ...CHECKOUT, deliveryMode: 'recoger', items: [{ id: 'MUE-01', qty: 1 }] };
  const noVendible = (err) => err.code === 'functions/failed-precondition' && /solo está disponible en el restaurante/.test(err.message);
  await assert.rejects(cliente.crearPedido(muestra), noVendible);
  await assert.rejects(cliente.crearPagoEnLinea(muestra), noVendible);
});

test('si el total que vio el cliente no coincide, rechaza con los precios vigentes', async () => {
  await assert.rejects(
    cliente.crearPedido({ ...CHECKOUT, items: [{ id: 'PAR-01', qty: 1 }], totalEsperado: 40000 }),
    (err) => {
      assert.equal(err.code, 'functions/aborted');
      assert.deepEqual(err.details.items, [{ id: 'PAR-01', price: 50000 }]);
      assert.equal(err.details.total, 57000);
      return true;
    }
  );
});

test('cantidad negativa, sin sesión y cliente bloqueado se rechazan', async () => {
  await assert.rejects(
    cliente.crearPedido({ ...CHECKOUT, items: [{ id: 'PAR-01', qty: -3 }] }),
    (err) => err.code === 'functions/failed-precondition' && /Cantidad inválida/.test(err.message)
  );
  await assert.rejects(
    anonimo.crearPedido({ ...CHECKOUT, items: [{ id: 'PAR-01', qty: 1 }] }),
    (err) => err.code === 'functions/unauthenticated'
  );
  await assert.rejects(
    bloqueado.crearPedido({ ...CHECKOUT, items: [{ id: 'PAR-01', qty: 1 }] }),
    (err) => err.code === 'functions/failed-precondition' && /No podemos procesar/.test(err.message)
  );
});

test('descuenta el inventario numérico en el servidor', async () => {
  await cliente2.crearPedido({ ...CHECKOUT, deliveryMode: 'recoger', items: [{ id: 'BEB-01', qty: 2 }] });
  assert.equal((await adminDb.ref('outOfStock/BEB-01').get()).val(), 3);
});

/* ---------- reglas: cliente ---------- */

test('el cliente NO puede crear un pedido escribiendo directo en orders', async () => {
  await assert.rejects(
    push(ref(cliente.db, 'orders'), { uid: 'cliente1', total: 1, status: 'recibido', items: [] }),
    DENEGADO
  );
});

test('el cliente no puede marcarse pagado, cambiar el total ni el estado de su pedido', async () => {
  await assert.rejects(update(ref(cliente.db, `orders/${pedidoId}`), { pagado: true }), DENEGADO);
  await assert.rejects(set(ref(cliente.db, `orders/${pedidoId}/total`), 1), DENEGADO);
  await assert.rejects(set(ref(cliente.db, `orders/${pedidoId}/status`), 'entregado'), DENEGADO);
});

test('el cliente lee sus pedidos por query (lo que usa "Mis pedidos")', async () => {
  const snap = await get(query(ref(cliente.db, 'orders'), orderByChild('uid'), equalTo('cliente1')));
  assert.ok(snap.child(pedidoId).exists());
});

test('otro cliente no puede cancelar un pedido ajeno', async () => {
  await assert.rejects(set(ref(cliente2.db, `orders/${pedidoId}/status`), 'cancelado'), DENEGADO);
});

test('el cliente cancela su pedido "recibido", pero no lo puede revivir', async () => {
  const { data } = await cliente.crearPedido({ ...CHECKOUT, items: [{ id: 'PAR-01', qty: 1 }] });
  await set(ref(cliente.db, `orders/${data.orderId}/status`), 'cancelado');
  assert.equal((await adminDb.ref(`orders/${data.orderId}/status`).get()).val(), 'cancelado');
  await assert.rejects(set(ref(cliente.db, `orders/${data.orderId}/status`), 'recibido'), DENEGADO);
});

test('el cliente ya no puede tocar outOfStock ni contadores', async () => {
  await assert.rejects(set(ref(cliente.db, 'outOfStock/BEB-01'), 1), DENEGADO);
  await assert.rejects(set(ref(cliente.db, 'contadores/2026-10-05'), 999), DENEGADO);
});

/* ---------- reglas: domiciliario ---------- */

test('domiciliario asignado: logística sí, dinero y estados de caja no', async () => {
  await adminDb.ref(`orders/${pedidoId}`).update({ driverId: 'driver1', driverName: 'Domi Uno', status: 'listo' });
  const pedidoRef = ref(domi.db, `orders/${pedidoId}`);

  await update(pedidoRef, { status: 'en_camino', rondaEstados: { 1: 'en_camino' }, tsCambio: Date.now() });
  await update(pedidoRef, { driverLocation: { lat: 7.9, lng: -72.5, updatedAt: Date.now() }, driverTrail: [{ lat: 7.9, lng: -72.5, at: 1 }] });
  await push(ref(domi.db, `orders/${pedidoId}/statusHistory`), { status: 'en_camino', byEmail: 'driver1@test.local', at: Date.now() });
  await update(pedidoRef, { status: 'entregado', driverLocation: null, driverTrail: null, tipAmount: 2000 });
  await update(ref(domi.db), { [`orders/${pedidoId}/cashSettled`]: true, [`orders/${pedidoId}/driverName`]: 'Domi Uno Editado' });

  await assert.rejects(update(pedidoRef, { pagado: true }), DENEGADO);
  await assert.rejects(update(pedidoRef, { total: 1 }), DENEGADO);
  await assert.rejects(update(pedidoRef, { status: 'recibido' }), DENEGADO);
  await assert.rejects(set(ref(domi.db, `orders/${pedidoId}/items`), []), DENEGADO);
  await assert.rejects(update(pedidoRef, { driverId: 'driver2' }), DENEGADO);

  const pedido = (await adminDb.ref(`orders/${pedidoId}`).get()).val();
  assert.equal(pedido.status, 'entregado');
  assert.equal(pedido.tipAmount, 2000);
  assert.equal(pedido.total, 107000);
});

test('domiciliario puede devolver la asignación', async () => {
  const { data } = await cliente2.crearPedido({ ...CHECKOUT, items: [{ id: 'PAR-01', qty: 1 }] });
  await adminDb.ref(`orders/${data.orderId}`).update({ driverId: 'driver1', driverName: 'Domi Uno', driverPhone: '300' });
  await update(ref(domi.db, `orders/${data.orderId}`), { driverId: null, driverName: null, driverPhone: null });
  assert.equal((await adminDb.ref(`orders/${data.orderId}/driverId`).get()).val(), null);
});

test('domiciliario sin access:true no puede cambiar el estado aunque esté asignado', async () => {
  const { data } = await cliente2.crearPedido({ ...CHECKOUT, items: [{ id: 'PAR-01', qty: 1 }] });
  await adminDb.ref(`orders/${data.orderId}`).update({ driverId: 'driver2', status: 'listo' });
  await assert.rejects(update(ref(domiSinAcceso.db, `orders/${data.orderId}`), { status: 'en_camino' }), DENEGADO);
});

/* ---------- reglas: personal ---------- */

test('el personal de mesa sigue creando y editando pedidos directo (incluido cobrar)', async () => {
  const nuevo = await push(ref(mesero.db, 'orders'), { origen: 'mesa', mesa: 'Mesa 5', status: 'enviado', total: 30000, lineas: [] });
  await update(ref(mesero.db, `orders/${nuevo.key}`), { pagado: true, metodoPago: 'efectivo' });
  await update(ref(mesero.db, `orders/${pedidoId}`), { pagado: true });
  await set(ref(mesero.db, 'contadores/2026-10-05'), 7);
  assert.equal((await adminDb.ref(`orders/${nuevo.key}/pagado`).get()).val(), true);
});

test('el admin de la tienda edita pedidos pero no los crea', async () => {
  await update(ref(adminTienda.db, `orders/${pedidoId}`), { etaMinutes: 30 });
  await set(ref(adminTienda.db, 'outOfStock/PAR-01'), true);
  await assert.rejects(push(ref(adminTienda.db, 'orders'), { status: 'recibido', total: 1 }), DENEGADO);
});

/* ---------- reglas + servidor: pausar domicilios ---------- */

test('el personal pausa SOLO los domicilios; recoger sigue funcionando', async () => {
  const pausa = ref(mesero.db, 'settings/domiciliosPausados');
  await set(pausa, true);
  await assert.rejects(set(ref(mesero.db, 'settings/isOpen'), false), DENEGADO);
  await assert.rejects(set(pausa, 'si'), DENEGADO);
  await assert.rejects(set(ref(cliente.db, 'settings/domiciliosPausados'), false), DENEGADO);
  await assert.rejects(set(ref(anonimo.db, 'settings/domiciliosPausados'), false), DENEGADO);

  await assert.rejects(
    cliente.crearPedido({ ...CHECKOUT, items: [{ id: 'BEB-01', qty: 1 }] }),
    (err) => err.code === 'functions/failed-precondition' && /domicilios están pausados/.test(err.message)
  );
  const { data } = await cliente.crearPedido({ ...CHECKOUT, deliveryMode: 'recoger', items: [{ id: 'BEB-01', qty: 1 }] });
  assert.ok(data.orderId);

  await set(ref(adminTienda.db, 'settings/domiciliosPausados'), false);
  assert.equal((await adminDb.ref('settings/domiciliosPausados').get()).val(), false);
});

/* ---------- pago en línea ---------- */

test('pago en línea: apagado por defecto; prendido, el pedido espera aparte con el total del servidor', async () => {
  await adminDb.ref('products/PAG-01').set({ name: 'Plato pago', price: 50000, image: '', categoryId: 'rodizio-casero' });
  const pedidoPago = {
    ...CHECKOUT,
    deliveryMode: 'recoger',
    items: [{ id: 'PAG-01', qty: 1, price: 1 }],
  };
  await assert.rejects(
    cliente.crearPagoEnLinea(pedidoPago),
    (err) => err.code === 'functions/failed-precondition' && /pago en línea no está disponible/.test(err.message)
  );

  await adminDb.ref('settings/pagoEnLinea').set(true);
  const pedidosAntes = Object.keys((await adminDb.ref('orders').get()).val() || {}).length;
  const { data } = await cliente.crearPagoEnLinea(pedidoPago);
  assert.match(data.orderNumber, /^RC\d{16}$/);
  assert.equal(data.campos.amount, '50000');
  assert.equal(data.campos.order_number, data.orderNumber);

  // No entra a orders (caja/cocina) hasta que AAvance confirme el pago.
  assert.equal(Object.keys((await adminDb.ref('orders').get()).val() || {}).length, pedidosAntes);
  const pendiente = (await get(ref(cliente.db, `pagosPendientes/${data.orderNumber}`))).val();
  assert.equal(pendiente.uid, 'cliente1');
  assert.equal(pendiente.total, 50000);
  assert.equal(pendiente.estado, 'pendiente');

  await assert.rejects(get(ref(cliente2.db, `pagosPendientes/${data.orderNumber}`)), DENEGADO);
  await assert.rejects(set(ref(cliente.db, `pagosPendientes/${data.orderNumber}/estado`), 'pagado'), DENEGADO);
  await assert.rejects(set(ref(cliente.db, `pagosPendientes/RC0000000000000001`), { uid: 'cliente1', total: 1 }), DENEGADO);

  await assert.rejects(
    cliente2.verificarPagoEnLinea({ orderNumber: data.orderNumber }),
    (err) => err.code === 'functions/not-found'
  );
  await assert.rejects(
    cliente.verificarPagoEnLinea({ orderNumber: '../orders' }),
    (err) => err.code === 'functions/invalid-argument'
  );
  await adminDb.ref('settings/pagoEnLinea').remove();
});

test('el cliente no puede cancelar un pedido ya pagado en línea', async () => {
  const pagado = adminDb.ref('orders').push();
  await pagado.set({ uid: 'cliente1', origen: 'recoger', status: 'recibido', total: 50000, pagado: true, metodoPago: 'en_linea', createdAt: Date.now() });
  await assert.rejects(set(ref(cliente.db, `orders/${pagado.key}/status`), 'cancelado'), DENEGADO);
});

/* ---------- reglas: errorLogs ---------- */

test('errorLogs: cualquiera agrega, nadie borra ni pisa', async () => {
  const log = await push(ref(anonimo.db, 'errorLogs'), { message: 'algo falló', context: 'prueba' });
  await assert.rejects(set(ref(anonimo.db, 'errorLogs'), null), DENEGADO);
  await assert.rejects(set(ref(anonimo.db, `errorLogs/${log.key}`), { message: 'pisado', context: 'x' }), DENEGADO);
  await assert.rejects(set(ref(anonimo.db, `errorLogs/${log.key}`), null), DENEGADO);
});

/* ---------- reglas: auditoría 2026-10-13 ---------- */

test('errorLogs: solo los campos de errors.js y con tope de tamaño', async () => {
  await push(ref(anonimo.db, 'errorLogs'), {
    context: 'c', message: 'm', stack: 's', url: 'https://x/', userAgent: 'ua', at: serverTimestamp(),
  });
  await assert.rejects(push(ref(anonimo.db, 'errorLogs'), { context: 'c', message: 'm', basura: 'x' }), DENEGADO);
  await assert.rejects(push(ref(anonimo.db, 'errorLogs'), { context: 'c', message: 'm', stack: 'x'.repeat(601) }), DENEGADO);
});

test('trabajadores: un cliente no ve al personal; cada uno lee su perfil y el admin la lista', async () => {
  await assert.rejects(get(ref(cliente.db, 'trabajadores')), DENEGADO);
  await assert.rejects(get(ref(cliente.db, 'trabajadores/trabajador1')), DENEGADO);
  await assert.rejects(get(ref(mesero.db, 'trabajadores')), DENEGADO);
  assert.equal((await get(ref(mesero.db, 'trabajadores/trabajador1'))).val().usuario, 'mesero');
  assert.ok((await get(ref(adminMesa.db, 'trabajadores'))).exists());
});

test('contadores: solo el personal los lee', async () => {
  await assert.rejects(get(ref(cliente.db, 'contadores')), DENEGADO);
  await get(ref(mesero.db, 'contadores'));
});

test('solicitudes: cada mesa es pública, la lista completa solo para el personal', async () => {
  const linea = { id: 'ENT-01', nombre: 'Empanadas', cat: 'ENT', qty: 2, precio: 12000, nota: 'sin ají' };
  await set(ref(anonimo.db, 'solicitudes/mesa-3'), { lineas: [linea], mesa: 'Mesa 3', cliente: 'Ana', actualizado: Date.now() });
  assert.equal((await get(ref(anonimo.db, 'solicitudes/mesa-3'))).val().cliente, 'Ana');
  await assert.rejects(get(ref(anonimo.db, 'solicitudes')), DENEGADO);
  await assert.rejects(get(ref(cliente.db, 'solicitudes')), DENEGADO);
  assert.ok((await get(ref(mesero.db, 'solicitudes'))).exists());
  await set(ref(anonimo.db, 'solicitudes/mesa-3'), null);
});

test('solicitudes: rechaza productos inventados, cantidades raras, campos extra y textos enormes', async () => {
  const base = { mesa: 'Mesa 4', actualizado: Date.now() };
  const linea = { id: 'ENT-01', qty: 1 };
  const malos = [
    { ...base, lineas: [{ id: 'NO-EXISTE', qty: 1 }] },
    { ...base, lineas: [{ ...linea, qty: 0 }] },
    { ...base, lineas: [{ ...linea, qty: 1000 }] },
    { ...base, lineas: [{ ...linea, precio: 'gratis' }] },
    { ...base, lineas: [{ ...linea, extra: 'x' }] },
    { ...base, lineas: [{ ...linea, nota: 'x'.repeat(501) }] },
    { ...base, lineas: 'no es lista' },
    { ...base, lineas: [linea], cliente: 'x'.repeat(81) },
    { ...base, lineas: [linea], basura: 'x'.repeat(10000) },
    { ...base, lineas: [linea], mesa: 'x'.repeat(61) },
  ];
  for (const datos of malos) {
    await assert.rejects(set(ref(anonimo.db, 'solicitudes/mesa-4'), datos), DENEGADO, JSON.stringify(datos).slice(0, 90));
  }
  await assert.rejects(set(ref(anonimo.db, 'solicitudes/mesa@rara'), { ...base, lineas: [linea] }), DENEGADO);
  await set(ref(anonimo.db, 'solicitudes/mesa-4'), { ...base, lineas: [linea] });
  await set(ref(anonimo.db, 'solicitudes/mesa-4'), null);
});

test('cashSettlements: solo un domiciliario con acceso crea su cierre de turno', async () => {
  const cierre = (driverId) => ({ driverId, expectedCash: 0, actualCash: 0, ordersCount: 0 });
  await assert.rejects(push(ref(cliente.db, 'cashSettlements'), cierre('cliente1')), DENEGADO);
  await assert.rejects(push(ref(domiSinAcceso.db, 'cashSettlements'), cierre('driver2')), DENEGADO);
  await push(ref(domi.db, 'cashSettlements'), cierre('driver1'));
});

/* ---------- límite de intentos por cliente ---------- */

test('límite: el intento 11 en 10 minutos se rechaza, cuenten o no los anteriores', async () => {
  // Intentos inválidos (carrito vacío) también cuentan: así se frena un script.
  for (let i = 0; i < 10; i++) {
    await assert.rejects(apurado.crearPedido({ ...CHECKOUT, items: [] }), (e) => e.code !== 'functions/resource-exhausted');
  }
  await assert.rejects(
    apurado.crearPedido({ ...CHECKOUT, items: [{ id: 'PAR-01', qty: 1 }] }),
    (e) => e.code === 'functions/resource-exhausted',
  );
  await assert.rejects(apurado.crearPagoEnLinea({ ...CHECKOUT, items: [{ id: 'PAR-01', qty: 1 }] }), (e) => e.code === 'functions/resource-exhausted');
  await assert.rejects(get(ref(apurado.db, 'limitePedidos/apurado1')), DENEGADO);
});
