/* Pruebas de construirPedido() — la lógica que decide cuánto se cobra.
   Corren sin emuladores ni red: `node --test test/unit/` */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirPedido, esProductoVendible, getScheduleStatus, nowInColombia } from '../../lib/reglas-pedido.mjs';

// Lunes 5 oct 2026, 13:00 en Colombia (18:00 UTC).
const AHORA = Date.parse('2026-10-05T18:00:00Z');

const PRODUCTS = {
  'PAR-01': { name: 'Picanha', price: 50000, image: 'icons/menu/pa1.webp', categoryId: 'burger-angus' },
  'BEB-01': { name: 'Limonada', price: 15000, categoryId: 'rodizio-casero' },
  'OCU-01': { name: 'Oculto', price: 1000, hidden: true, categoryId: 'burger-angus' },
  'BEB-13': { name: 'Cerveza de prueba', price: 6000, categoryId: 'rodizio-casero', subGroup: 'cervezas' },
  'BEB-05': { name: 'Coca-Cola', price: 5000, categoryId: 'rodizio-casero', subGroup: 'gaseosas' },
  'COC-01': { name: 'Mojito', price: 25000, categoryId: 'cocteles' },
  'MUE-01': { name: 'Asado de muestra', price: 30000, categoryId: 'de-la-parrilla' },
};
const SETTINGS = {
  isOpen: true,
  defaultShippingFee: 5000,
  minOrderDomicilio: 20000,
  coverageZones: [{ name: 'Caobos', fee: 7000, keywords: ['caobos', 'teatro las cascadas'] }],
};

function pedir(datos, extra = {}) {
  return construirPedido({
    datos: { deliveryMode: 'domicilio', phone: '3001234567', address: 'Calle 1 # 2-3', ...datos },
    products: PRODUCTS,
    outOfStock: {},
    settings: SETTINGS,
    ahora: AHORA,
    ...extra,
  });
}

test('usa el precio y nombre reales, ignora los que manda el navegador', () => {
  const r = pedir({
    address: 'Barrio Caobos',
    items: [{ id: 'PAR-01', qty: 2, price: 1, name: 'GRATIS', image: 'x.png', notes: ' término medio ' }],
  });
  assert.deepEqual(r.problemas, []);
  assert.deepEqual(r.items, [
    { id: 'PAR-01', name: 'Picanha', price: 50000, qty: 2, notes: 'término medio', image: 'icons/menu/pa1.webp' },
  ]);
  assert.equal(r.subtotal, 100000);
  assert.equal(r.shipping, 7000);
  assert.equal(r.total, 107000);
});

test('solo se venden Burger Angus y Rodizio Casero; las demás categorías son muestra', () => {
  assert.equal(esProductoVendible(PRODUCTS['PAR-01']), true);
  assert.equal(esProductoVendible(PRODUCTS['BEB-01']), true);
  assert.equal(esProductoVendible(PRODUCTS['MUE-01']), false);
  assert.equal(esProductoVendible({ id: 'SIN-CATEGORIA' }), false);
  const r = pedir({ items: [{ id: 'MUE-01', qty: 1 }] });
  assert.ok(r.problemas.some((p) => p.includes('solo está disponible en el restaurante')));
  assert.equal(r.items.length, 0);
});

test('envío: zona por palabra clave (sin importar tildes), por defecto, y recoger = 0', () => {
  const items = [{ id: 'PAR-01', qty: 1 }];
  assert.equal(pedir({ items, address: 'Frente al Teatro Las Cáscadas' }).shipping, 7000);
  assert.equal(pedir({ items, address: 'Barrio Lleras' }).shipping, 5000);
  const recoger = pedir({ items, deliveryMode: 'recoger', address: 'Barrio Caobos' });
  assert.equal(recoger.shipping, 0);
  assert.equal(recoger.campos.address, null);
  assert.equal(recoger.total, 50000);
});

test('rechaza cantidades inválidas (negativas, cero, decimales, texto, exceso)', () => {
  for (const qty of [-3, 0, 1.5, '2', 100, null]) {
    const r = pedir({ items: [{ id: 'PAR-01', qty }] });
    assert.ok(r.problemas.some((p) => p.includes('Cantidad inválida')), `qty=${qty} debió rechazarse`);
    assert.equal(r.items.length, 0);
  }
});

test('rechaza productos inexistentes u ocultos', () => {
  assert.ok(pedir({ items: [{ id: 'NO-EXISTE', qty: 1 }] }).problemas[0].includes('ya no existe'));
  assert.ok(pedir({ items: [{ id: 'OCU-01', qty: 1 }] }).problemas.some((p) => p.includes('ya no está disponible')));
  assert.ok(pedir({ items: [{ id: '__proto__', qty: 1 }] }).problemas[0].includes('ya no existe'));
});

test('agotados: true/0 bloquean; un conteo numérico se compara contra la suma de líneas', () => {
  const items = [{ id: 'PAR-01', qty: 1 }];
  assert.ok(pedir({ items }, { outOfStock: { 'PAR-01': true } }).problemas.some((p) => p.includes('agotado')));
  assert.ok(pedir({ items }, { outOfStock: { 'PAR-01': 0 } }).problemas.some((p) => p.includes('agotado')));
  const dosLineas = [{ id: 'PAR-01', qty: 2, notes: 'a' }, { id: 'PAR-01', qty: 2, notes: 'b' }];
  assert.ok(pedir({ items: dosLineas }, { outOfStock: { 'PAR-01': 3 } }).problemas.some((p) => p.includes('Solo quedan 3')));
  const alcanza = [{ id: 'PAR-01', qty: 2, notes: 'a' }, { id: 'PAR-01', qty: 1, notes: 'b' }];
  assert.deepEqual(pedir({ items: alcanza }, { outOfStock: { 'PAR-01': 3 } }).problemas, []);
});

test('pedido mínimo solo aplica a domicilio', () => {
  const items = [{ id: 'BEB-01', qty: 1 }]; // 15.000 < 20.000
  assert.ok(pedir({ items }).problemas.some((p) => p.includes('pedido mínimo')));
  assert.deepEqual(pedir({ items, deliveryMode: 'recoger' }).problemas, []);
});

test('restrictToZones rechaza direcciones fuera de cobertura', () => {
  const settings = { ...SETTINGS, restrictToZones: true };
  const items = [{ id: 'PAR-01', qty: 1 }];
  assert.ok(pedir({ items, address: 'Barrio Lleras' }, { settings }).problemas.some((p) => p.includes('fuera de nuestra zona')));
  assert.deepEqual(pedir({ items, address: 'Caobos' }, { settings }).problemas, []);
});

test('negocio cerrado: manual, override y horario automático en hora de Colombia', () => {
  const items = [{ id: 'PAR-01', qty: 1 }];
  const cerrado = pedir({ items }, { settings: { ...SETTINGS, isOpen: false, closedMessage: 'Cerrado por hoy' } });
  assert.equal(cerrado.problemas[0], 'Cerrado por hoy');
  assert.deepEqual(pedir({ items }, { settings: { ...SETTINGS, isOpen: false, manualOverride: 'open' } }).problemas, []);

  const auto = { ...SETTINGS, useSchedule: true }; // horario por defecto: 11:00–22:00 todos los días
  assert.deepEqual(pedir({ items }, { settings: auto }).problemas, []); // 13:00
  const noche = Date.parse('2026-10-06T04:30:00Z'); // lunes 23:30 en Colombia
  const r = pedir({ items }, { settings: auto, ahora: noche });
  assert.equal(r.problemas[0], 'Estamos cerrados ahora. Abrimos mañana a las 11:00.');
  assert.equal(getScheduleStatus(auto, nowInColombia(new Date(noche))).isOpen, false);
});

test('domicilios pausados: rechaza domicilio, deja recoger en tienda', () => {
  const items = [{ id: 'PAR-01', qty: 1 }];
  const settings = { ...SETTINGS, domiciliosPausados: true };
  assert.ok(pedir({ items }, { settings }).problemas.some((p) => p.includes('domicilios están pausados')));
  assert.deepEqual(pedir({ items, deliveryMode: 'recoger' }, { settings }).problemas, []);
  // Solo `true` pausa: un valor raro no debe cerrar los domicilios.
  assert.deepEqual(pedir({ items }, { settings: { ...SETTINGS, domiciliosPausados: 'si' } }).problemas, []);
});

test('cliente bloqueado no puede pedir', () => {
  const r = pedir({ items: [{ id: 'PAR-01', qty: 1 }] }, { bloqueado: true });
  assert.ok(r.problemas[0].includes('No podemos procesar tu pedido'));
});

test('hora programada: null ok, cercana ok, basura o lejana se rechaza', () => {
  const items = [{ id: 'PAR-01', qty: 1 }];
  assert.equal(pedir({ items, scheduledFor: null }).campos.scheduledFor, null);
  assert.equal(pedir({ items, scheduledFor: AHORA + 3600000 }).campos.scheduledFor, AHORA + 3600000);
  for (const scheduledFor of ['mañana', AHORA + 3 * 86400000, {}]) {
    assert.ok(pedir({ items, scheduledFor }).problemas.some((p) => p.includes('hora programada')));
  }
});

test('campos extra del navegador (total, pagado, uid, status) no se cuelan al pedido', () => {
  const r = pedir({ items: [{ id: 'PAR-01', qty: 1 }], total: 1, pagado: true, uid: 'otro', status: 'entregado' });
  assert.deepEqual(Object.keys(r.campos).sort(), ['address', 'customerLocation', 'deliveryMode', 'mayorDeEdad', 'phone', 'reference', 'scheduledFor']);
  assert.equal(r.total, 55000);
});

test('bebidas con alcohol: sin confirmar la mayoría de edad no hay pedido', () => {
  const recoger = { deliveryMode: 'recoger' };
  const sinConfirmar = pedir({ ...recoger, items: [{ id: 'BEB-13', qty: 2 }] });
  assert.match(sinConfirmar.problemas[0], /mayor de 18/);
  assert.match(pedir({ ...recoger, items: [{ id: 'BEB-13', qty: 1 }], mayorDeEdad: 'true' }).problemas[0], /mayor de 18/);

  const confirmado = pedir({ ...recoger, items: [{ id: 'BEB-13', qty: 1 }, { id: 'BEB-05', qty: 1 }], mayorDeEdad: true });
  assert.deepEqual(confirmado.problemas, []);
  assert.equal(confirmado.campos.mayorDeEdad, true);

  const coctelMuestra = pedir({ ...recoger, items: [{ id: 'COC-01', qty: 1 }], mayorDeEdad: true });
  assert.ok(coctelMuestra.problemas.some((p) => p.includes('solo está disponible en el restaurante')));

  // Sin alcohol (gaseosa del mismo grupo "bebidas") no se pide nada.
  const sinAlcohol = pedir({ ...recoger, items: [{ id: 'BEB-05', qty: 1 }] });
  assert.deepEqual(sinAlcohol.problemas, []);
  assert.equal(sinAlcohol.campos.mayorDeEdad, null);
});

test('datos de contacto: obligatorios, recortados, ubicación validada', () => {
  const items = [{ id: 'PAR-01', qty: 1 }];
  assert.ok(pedir({ items, phone: '   ' }).problemas.includes('Ingresa un teléfono de contacto'));
  assert.ok(pedir({ items, address: '' }).problemas.includes('Ingresa la dirección de entrega'));
  assert.equal(pedir({ items, phone: '9'.repeat(50) }).campos.phone.length, 30);
  assert.deepEqual(pedir({ items, customerLocation: { lat: 7.9, lng: -72.5 } }).campos.customerLocation, { lat: 7.9, lng: -72.5 });
  assert.equal(pedir({ items, customerLocation: { lat: 'x', lng: 1 } }).campos.customerLocation, null);
  assert.equal(pedir({ items, deliveryMode: 'recoger', customerLocation: { lat: 7.9, lng: -72.5 } }).campos.customerLocation, null);
  assert.ok(pedir({ items, deliveryMode: 'mesa' }).problemas.some((p) => p.includes('domicilio o para recoger')));
});

test('carrito vacío o sin items', () => {
  assert.ok(pedir({ items: [] }).problemas.includes('El carrito está vacío.'));
  assert.ok(pedir({}).problemas.includes('El carrito está vacío.'));
});
