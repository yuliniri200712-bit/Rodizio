/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
// Prueba de la capa de reportes de shared/util.js (fase R1).
const fs = require("fs");
const path = require("path").join(__dirname, "..", "shared", "util.js");
let src = fs.readFileSync(path, "utf8");
// util.js usa window al final (bfcache) — stub mínimo.
global.window = { addEventListener() {} };
const nombres = [
  "rangoReporte", "filtrarPedidos", "variacionPct", "resumenVentas", "serieDiaria",
  "bucketsPorHora", "bucketsPorDiaSemana", "tiemposDePedido", "tiemposOperacion",
  "tasasIncidencia", "resumenCanales", "resumenPersonas", "ventasPorCategoria",
  "ventasPorPlato", "codigoPedido", "statusDe", "origenDe",
  "relojCO", "inicioDiaCO", "isoDiaCO", "esHoyCO",
];
const fn = new Function(src + "\nreturn {" + nombres.join(",") + "};");
const U = fn();

let fallos = 0;
function ok(cond, msg) {
  if (cond) console.log("  ok  " + msg);
  else { console.log("  FAIL " + msg); fallos++; }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }

const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
const H = hoy0.getTime();
const dia = 86400000;
const min = 60000;

// --- Datos de prueba ---
const entries = [
  // mesa, pagado hoy, efectivo, con tiempos completos
  ["a", {
    origen: "mesa", mesa: "Mesa 5", mesero: "Maria", cajero: "rodizio",
    status: "entregado", pagado: true, metodoPago: "efectivo",
    total: 50000, ts: H + 12 * 3600000, tipAmount: 2000,
    lineas: [{ id: "PAR-01", nombre: "Picanha", precio: 25000, qty: 2, cat: "De la Parrilla" }],
    statusHistory: {
      a1: { status: "enviado", at: H + 12 * 3600000 },
      a2: { status: "listo", at: H + 12 * 3600000 + 20 * min },
      a3: { status: "entregado", at: H + 12 * 3600000 + 25 * min },
    },
    etaMinutes: 30, etaSetAt: H + 12 * 3600000,
  }],
  // domicilio, pagado hoy, transferencia
  ["b", {
    origen: "domicilio", customerName: "Ana", cajero: "rodizio", driverName: "Julian",
    status: "entregado", pagado: true, metodoPago: "transferencia",
    total: 43000, shipping: 5000, createdAt: H + 19 * 3600000,
    lineas: [{ id: "ENT-01", name: "Sopa", price: 38000, qty: 1, cat: "Entradas" }],
    statusHistory: {
      b1: { status: "enviado", at: H + 19 * 3600000 + 5 * min },
      b2: { status: "listo", at: H + 19 * 3600000 + 25 * min },
      b3: { status: "en_camino", at: H + 19 * 3600000 + 30 * min },
      b4: { status: "entregado", at: H + 19 * 3600000 + 60 * min },
    },
    tsConfirmado: H + 19 * 3600000 + 5 * min,
    etaMinutes: 30, etaSetAt: H + 19 * 3600000,   // entregó a los 60 -> tarde
  }],
  // mesa, SIN pagar (no debe contar en plata)
  ["c", { origen: "mesa", mesa: "Mesa 2", mesero: "Maria", status: "entregado", pagado: false, total: 99999, createdAt: H + 13 * 3600000, lineas: [] }],
  // cancelado hoy
  ["d", { origen: "domicilio", status: "cancelado", total: 20000, createdAt: H + 14 * 3600000, motivoCancelacion: "Cliente se arrepintió", lineas: [] }],
  // no entregado hoy
  ["e", { origen: "domicilio", status: "no_entregado", total: 30000, createdAt: H + 15 * 3600000, deliveryFailureReason: "Cliente no contesta", lineas: [] }],
  // pagado AYER (fuera del rango "hoy", dentro del "anterior")
  ["f", { origen: "mesa", mesa: "Mesa 1", mesero: "Juan", status: "entregado", pagado: true, metodoPago: "tarjeta", total: 30000, createdAt: H - dia + 12 * 3600000, lineas: [{ id: "PAR-01", nombre: "Picanha", precio: 30000, qty: 1, cat: "De la Parrilla" }] }],
  // recoger, pagado hoy
  ["g", { origen: "recoger", customerName: "Luis", status: "entregado", pagado: true, metodoPago: "efectivo", total: 15000, createdAt: H + 20 * 3600000, lineas: [{ id: "BEB-01", name: "Jugo", price: 15000, qty: 1, cat: "Bebidas" }] }],
];

console.log("\n== hora de Colombia (UTC-5 fijo) ==");
// 2026-09-07 03:30 UTC  ==  2026-09-06 22:30 en Colombia.
const utcNoche = Date.UTC(2026, 8, 7, 3, 30);
eq(U.relojCO(utcNoche).getUTCDate(), 6, "relojCO: sigue siendo día 6 en Colombia a las 03:30 UTC");
eq(U.relojCO(utcNoche).getUTCHours(), 22, "relojCO: 22h en Colombia");
eq(U.isoDiaCO(utcNoche), "2026-09-06", "isoDiaCO: 2026-09-06 (no 07)");
eq(U.inicioDiaCO(utcNoche), Date.UTC(2026, 8, 6, 5, 0), "inicioDiaCO: medianoche CO = 05:00 UTC del día 6");
// un pedido a las 22:30 CO cuenta en la hora 22, no en la 3
const bh0 = U.bucketsPorHora([["x", { ts: utcNoche, total: 1 }]]);
eq(bh0[22].pedidos, 1, "bucketsPorHora: pedido de las 22:30 CO -> hora 22");
eq(bh0[3].pedidos, 0, "bucketsPorHora: NO en la hora 3 (UTC)");
// rango "dia" del 6 debe incluir ese pedido de las 22:30 CO
const rDia6 = U.rangoReporte("dia", { dia: "2026-09-06" });
ok(utcNoche >= rDia6.desde && utcNoche <= rDia6.hasta, "rango 'dia' 2026-09-06 incluye las 22:30 CO de ese día");
// 2026-09-07 05:30 UTC == 2026-09-07 00:30 en Colombia -> ya es el día 7
ok(Date.UTC(2026, 8, 7, 5, 30) > rDia6.hasta, "rango 'dia' 2026-09-06 NO incluye las 00:30 CO del día 7");

console.log("\n== rangoReporte ==");
const r = U.rangoReporte("hoy");
eq(r.desde, H, "hoy.desde == medianoche");
ok(r.hasta === H + dia - 1, "hoy.hasta == fin del día");
ok(r.desdeAnterior === H - dia, "hoy anterior == ayer");
const r7 = U.rangoReporte("7d");
ok(r7.hasta - r7.desde + 1 === 7 * dia, "7d dura 7 días exactos");
ok(r7.desdeAnterior === r7.desde - 7 * dia, "7d anterior es del mismo largo");

console.log("\n== filtrarPedidos ==");
const hoyPagados = U.filtrarPedidos(entries, { desde: r.desde, hasta: r.hasta, soloPagados: true });
eq(hoyPagados.map(([id]) => id), ["a", "b", "g"], "hoy+pagados = a,b,g (excluye sin pagar, cancelado, ayer)");
const ayerPagados = U.filtrarPedidos(entries, { desde: r.desdeAnterior, hasta: r.hastaAnterior, soloPagados: true });
eq(ayerPagados.map(([id]) => id), ["f"], "ayer+pagados = f");
eq(U.filtrarPedidos(entries, { desde: r.desde, hasta: r.hasta, soloPagados: true, origen: "domicilio" }).map(([id]) => id), ["b"], "filtro por canal domicilio");
eq(U.filtrarPedidos(entries, { desde: r.desde, hasta: r.hasta, soloPagados: true, persona: "Maria" }).map(([id]) => id), ["a"], "filtro por persona (mesero)");
eq(U.filtrarPedidos(entries, { desde: r.desde, hasta: r.hasta, soloPagados: true, persona: "Julian" }).map(([id]) => id), ["b"], "filtro por persona (domiciliario)");
const todosHoy = U.filtrarPedidos(entries, { desde: r.desde, hasta: r.hasta, incluirCancelados: true });
eq(todosHoy.length, 6, "hoy con cancelados = 6");

console.log("\n== resumenVentas ==");
const rv = U.resumenVentas(hoyPagados);
eq(rv.total, 108000, "total 50000+43000+15000");
eq(rv.pedidos, 3, "3 pedidos");
eq(rv.unidades, 4, "4 unidades (2+1+1)");
eq(rv.envios, 5000, "envios");
eq(rv.propinas, 2000, "propinas");
eq(rv.ticketPromedio, 36000, "ticket promedio");
eq(rv.porMetodo, { efectivo: 65000, tarjeta: 0, transferencia: 43000, otro: 0 }, "desglose por método (incluye transferencia)");

console.log("\n== variacionPct ==");
eq(U.variacionPct(108000, 30000), 260, "+260%");
eq(U.variacionPct(100, 0), null, "sin base -> null (no Infinity)");
eq(U.variacionPct(50, 100), -50, "-50%");

console.log("\n== serieDiaria ==");
const serie = U.serieDiaria(U.filtrarPedidos(entries, { desde: H - 2 * dia, hasta: r.hasta, soloPagados: true }), H - 2 * dia, r.hasta);
eq(serie.length, 3, "3 puntos para 3 días");
eq(serie.map((p) => p.total), [0, 30000, 108000], "incluye el día sin ventas como 0");

console.log("\n== buckets ==");
const bh = U.bucketsPorHora(todosHoy);
eq(bh.length, 24, "24 horas");
eq(bh[12].pedidos, 1, "1 pedido a las 12");
eq(bh[19].pedidos, 1, "1 pedido a las 19");
eq(bh[3].pedidos, 0, "0 a las 3am");
eq(U.bucketsPorDiaSemana(todosHoy).reduce((s, d) => s + d.pedidos, 0), 6, "suma dias == total");

console.log("\n== tiempos ==");
const ta = U.tiemposDePedido(entries[0][1]);
eq(ta.cocina, 20, "mesa: cocina 20 min");
eq(ta.total, 25, "mesa: total 25 min");
eq(ta.entrega, null, "mesa: sin entrega (no hay en_camino)");
const tb = U.tiemposDePedido(entries[1][1]);
eq(tb.confirmacion, 5, "domicilio: caja tardó 5 min en confirmar");
eq(tb.cocina, 20, "domicilio: cocina 20 min");
eq(tb.entrega, 30, "domicilio: entrega 30 min");
eq(tb.total, 60, "domicilio: total 60 min");
const to = U.tiemposOperacion(hoyPagados);
eq(to.cocina, 20, "promedio cocina 20");
eq(to.entrega, 30, "promedio entrega 30");
eq(to.muestras.cocina, 2, "2 muestras de cocina (g no tiene historial)");
eq(to.pctATiempo, 50, "1 de 2 a tiempo");
eq(U.tiemposOperacion([["z", { total: 1 }]]).cocina, null, "pedido sin statusHistory -> null, no 0");

console.log("\n== tasas ==");
const ti = U.tasasIncidencia(todosHoy);
eq(ti.cancelados, 1, "1 cancelado");
eq(ti.noEntregados, 1, "1 no entregado");
eq(ti.motivosCancelacion, [{ motivo: "Cliente se arrepintió", n: 1 }], "motivo de cancelación agrupado");
eq(ti.motivosNoEntrega, [{ motivo: "Cliente no contesta", n: 1 }], "motivo de no entrega agrupado");

console.log("\n== canales ==");
const rc = U.resumenCanales(hoyPagados);
eq(rc.mesa.total, 50000, "canal mesa");
eq(rc.domicilio.total, 43000, "canal domicilio");
eq(rc.recoger.total, 15000, "canal recoger");
eq(rc.mesa.total + rc.domicilio.total + rc.recoger.total, rv.total, "canales suman el total");

console.log("\n== personas ==");
eq(U.resumenPersonas(hoyPagados, "mesero"), [{ nombre: "Maria", total: 50000, pedidos: 1, unidades: 2, propinas: 2000, ticketPromedio: 50000 }], "mesero Maria");
eq(U.resumenPersonas(hoyPagados, "cajero").length, 1, "1 cajero");
eq(U.resumenPersonas(hoyPagados, "driverName")[0].nombre, "Julian", "domiciliario Julian");

console.log("\n== categorias / platos ==");
const vc = U.ventasPorCategoria(hoyPagados);
eq(vc.length, 3, "3 categorías");
eq(vc[0].cat, "De la Parrilla", "parrilla primero por total");
eq(vc.reduce((s, c) => s + c.total, 0), 103000, "categorias suman (sin envío)");
const vp = U.ventasPorPlato(hoyPagados);
eq(vp.find((f) => f.codigo === "PAR-01").cantidad, 2, "ventasPorPlato lee nombre/precio de mesa");
eq(vp.find((f) => f.codigo === "ENT-01").nombre, "Sopa", "ventasPorPlato lee name/price de tienda");

console.log("\n== codigoPedido ==");
eq(U.codigoPedido({ codigo: "D-001" }, "-P0tXYZ"), "D-001", "usa codigo si existe");
eq(U.codigoPedido({}, "-P0tPTEG8YmBF76FwXsZ"), "#FWXSZ", "corto legible si no hay codigo");

console.log(fallos === 0 ? "\nTODO OK\n" : "\n" + fallos + " FALLOS\n");
process.exit(fallos ? 1 : 0);
