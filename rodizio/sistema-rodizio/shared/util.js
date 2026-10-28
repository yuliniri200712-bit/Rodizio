/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* Rodizio — utilidades compartidas por todas las apps.
   Sin build, sin módulos ES — funciones globales simples que cada
   index.html carga con <script src="../shared/util.js"></script>
   antes de su propio script. */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// shared/firebase.js ahora es un módulo ES (SDK de Firebase), así que
// sus funciones (dbGet/escucharSSE/…) pueden no estar en `window`
// todavía cuando un script clásico corre. Cualquier código que use la
// base antes de un guard de sesión debe hacer `await esperarFirebase()`.
function esperarFirebase() {
  return new Promise((resolve) => {
    (function chequear() {
      if (window.dbGet && window.escucharSSE && window.siguienteCodigo) resolve();
      else setTimeout(chequear, 20);
    })();
  });
}

// Formato de moneda colombiana: fmtCop(12000) → "$12.000"
function fmtCop(n) {
  return "$" + Number(n || 0).toLocaleString("es-CO");
}

// id de mesa a partir del nombre visible — MISMA función en las 3 apps
// (mesero-app al "Abrir otra", panel-admin al generar el QR, panel-cliente
// al validar el `?mesa=` del QR) para que las tres converjan en el mismo
// id: "Mesa 7" → "mesa-7", "Terraza" → "terraza", "VIP 2" → "vip-2".
// Se usa tal cual como segmento de ruta de Firebase (/solicitudes/{id}),
// así que solo deja [a-z0-9-]. Devuelve "" si no queda nada usable.
function slugMesa(nombre) {
  return String(nombre || "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Crea una función beep() independiente, cada una con su propio
// AudioContext — así cada app puede tener su propio tono (par de
// frecuencias) para distinguir el tipo de aviso, por ejemplo
// "pedido nuevo" en cocina/caja vs. "pedido listo" en la app de meseros.
// El interruptor de silencio (sonidoOn) lo controla cada app en su
// propio sitio de llamada, no aquí.
function crearBeep(frecuencias) {
  let audioCtx;
  const freqs = frecuencias || [880, 1180];
  return function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;
      freqs.forEach((freq, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "sine"; o.frequency.value = freq;
        g.gain.setValueAtTime(0, t0 + i * 0.16);
        g.gain.linearRampToValueAtTime(0.18, t0 + i * 0.16 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.16 + 0.22);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0 + i * 0.16); o.stop(t0 + i * 0.16 + 0.24);
      });
    } catch (e) { }
  };
}

// Agrupa las líneas de un pedido por ronda (1 = pedido original, 2+ = se
// agregó después durante la misma sentada — ver agregarRonda() en
// mesero-app/app.js) para que mesero-app y panel-cocina puedan mostrar en
// qué momento se tomó cada parte de la comanda. Los pedidos de antes de que
// existiera este campo no traen "ronda" en sus líneas: caen todos en el
// grupo 1, sin romper nada.
function agruparPorRonda(lineas, rondas) {
  const grupos = {};
  (lineas || []).forEach((l) => {
    const r = l.ronda || 1;
    (grupos[r] = grupos[r] || []).push(l);
  });
  return Object.keys(grupos)
    .map(Number)
    .sort((a, b) => a - b)
    .map((r) => ({
      ronda: r,
      lineas: grupos[r],
      ts: rondas && rondas[r] ? rondas[r] : null,
    }));
}

// ── Pedido unificado (fusión mesas + domicilios) ──
// Una sola colección `orders`. `origen` distingue el tipo. El campo de
// estado unificado es `status`; los pedidos de mesa de antes de la
// fusión traían `estado` — se lee con fallback para no migrar nada.
// Las líneas de mesa traían nombre/precio/nota; las de domicilio
// name/price/notes — se leen con helper.
function origenDe(p) { return (p && p.origen) || "mesa"; }
// Código legible de un pedido. Los de mesa traen `codigo` (P-001) desde
// mesero-app; los de domicilio lo reciben (D-001) cuando CAJA los confirma
// (ver confirmarDomicilio en panel-caja). Antes de eso, o para datos
// viejos sin código, se muestra un corto derivado del pushId en vez del
// pushId crudo de Firebase (`-P0tPTEG8YmBF76FwXsZ`).
function codigoCorto(id) {
  return "#" + String(id || "").replace(/[^A-Za-z0-9]/g, "").slice(-5).toUpperCase();
}
function codigoPedido(p, id) {
  return (p && p.codigo) || codigoCorto(id || (p && p.id));
}
function statusDe(p) { return (p && (p.status || p.estado)) || "enviado"; }
function tsDe(p) { return (p && (p.createdAt || p.ts)) || 0; }
function nombreLinea(l) { return l && l.name != null ? l.name : (l && l.nombre) || ""; }
function precioLinea(l) { return l && l.price != null ? l.price : (l && l.precio) || 0; }
function notaLinea(l) { return l && l.notes != null ? l.notes : (l && l.nota) || ""; }

// ── Estado por ronda ──
// Cada ronda de un pedido (ver agruparPorRonda arriba) avanza por cocina y
// se sirve de forma independiente — pedir algo más en una mesa que ya tiene
// parte lista/servida no debe "resetear" esa parte a medio hacer. El estado
// de cada ronda vive en pedido.rondaEstados; pedido.status (el resumen) se
// recalcula en cada cambio para que panel-caja y las Cloud Functions no
// necesiten saber de rondas. Un pedido de domicilio tiene 1 ronda.
// `llegado` (domicilio): el GPS del domiciliario entró en el radio del
// destino — automático, ver geofence en tienda/js/driver.js. Va entre
// en_camino y entregado. Solo aplica a domicilio; en mesa nunca aparece.
const ORDEN_ESTADO_RONDA = { recibido: 0, enviado: 1, preparacion: 2, listo: 3, en_camino: 4, llegado: 5, entregado: 6 };

// Estado de una ronda puntual. Los pedidos sin rondaEstados heredan el
// estado global (status/estado) que tenían en ese momento.
function estadoDeRonda(p, ronda) {
  return (p.rondaEstados && p.rondaEstados[ronda]) || statusDe(p);
}

// rondaEstados completo, con la misma compatibilidad hacia atrás de
// estadoDeRonda — para usar como base al construir el patch la primera vez
// que un pedido sin rondaEstados recibe un cambio de estado.
function rondaEstadosCon(p) {
  if (p.rondaEstados) return Object.assign({}, p.rondaEstados);
  const obj = {};
  agruparPorRonda(p.lineas, p.rondas).forEach((g) => {
    obj[g.ronda] = statusDe(p);
  });
  return obj;
}

// Estado "visible" de un ticket que puede tener rondas en distintos
// estados: la ronda pendiente menos avanzada (o "entregado" si ya se
// sirvieron todas). Decide en qué columna del tablero de panel-cocina
// aparece el ticket, y cuándo panel-caja puede considerarlo cobrable.
function estadoEfectivoTicket(p) {
  const estados = agruparPorRonda(p.lineas, p.rondas).map((g) => estadoDeRonda(p, g.ronda));
  const pendientes = estados.filter((e) => e !== "entregado");
  if (!pendientes.length) return "entregado";
  return pendientes.reduce(
    (min, e) => ((ORDEN_ESTADO_RONDA[e] ?? 99) < (ORDEN_ESTADO_RONDA[min] ?? 99) ? e : min),
    pendientes[0]
  );
}

// Suma, por plato, cuántas unidades y cuánto dinero se vendieron dentro de
// un conjunto de pedidos ya filtrado (p. ej. cobrados de un mes). Recibe el
// mismo shape que Object.entries(pedidos): [[id, pedido], ...]. La usan
// tanto el Excel de panel-caja como el dashboard de panel-admin para no
// mantener el mismo cálculo duplicado en dos archivos.
function ventasPorPlato(pedidosFiltrados) {
  const porPlato = {};
  (pedidosFiltrados || []).forEach(([, p]) => {
    (p.lineas || []).forEach(l => {
      const acc = porPlato[l.id] || { codigo: l.id, nombre: nombreLinea(l), cat: l.cat, cantidad: 0, total: 0 };
      acc.cantidad += l.qty || 0;
      acc.total += precioLinea(l) * (l.qty || 0);
      porPlato[l.id] = acc;
    });
  });
  return Object.values(porPlato).sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/* ═══════════════════════════════════════════════════════════════
   CAPA DE REPORTES (fase R1 — ver docs-fusion/PLAN-REPORTES.md)
   ═══════════════════════════════════════════════════════════════
   UNA sola implementación de cada cálculo, para que el Excel de
   panel-caja, el dashboard de panel-admin y los reportes de la tienda
   den SIEMPRE el mismo número. Nada de esto toca Firebase: recibe
   `Object.entries(pedidos)` ya cargado y devuelve objetos planos.

   Convención: todas reciben `entries` = [[id, pedido], ...].
   Regla de oro del dinero: solo cuenta lo que caja marcó `pagado`.
   Los conteos y tiempos operativos usan todos los pedidos NO cancelados.
   ═══════════════════════════════════════════════════════════════ */

// ── Hora de Colombia (SIEMPRE, para todo) ──
// El sistema opera en Cúcuta. Todos los cortes de fecha — "hoy", los
// rangos de reportes, la curva por hora, el día de la semana, el
// correlativo diario — tienen que ser respecto a la hora de Colombia,
// NO a la del dispositivo que abre la app (podría estar en otra zona, o
// el dueño puede consultar desde afuera). Colombia es UTC-5 fijo, nunca
// tuvo horario de verano, así que basta un desfase constante.
const CO_OFFSET_MS = 5 * 3600000;

// "Reloj CO": un Date cuyos getters UTC (getUTCFullYear, getUTCMonth,
// getUTCDate, getUTCHours, getUTCDay…) devuelven la hora de Bogotá.
function relojCO(ms) { return new Date((ms == null ? Date.now() : ms) - CO_OFFSET_MS); }

// Timestamp real (UTC ms) de la medianoche de Colombia del día que
// contiene `ms` (por defecto, hoy).
function inicioDiaCO(ms) {
  const r = relojCO(ms);
  return Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate()) + CO_OFFSET_MS;
}
// Medianoche CO de un año/mes/día dados (mes 1-12).
function fechaCO(y, m, d) { return Date.UTC(y, m - 1, d || 1) + CO_OFFSET_MS; }
// "YYYY-MM-DD" del día en Colombia.
function isoDiaCO(ms) {
  const r = relojCO(ms);
  return r.getUTCFullYear() + "-" + String(r.getUTCMonth() + 1).padStart(2, "0") + "-" + String(r.getUTCDate()).padStart(2, "0");
}
// Formateo de fecha/hora en zona Colombia (envuelve toLocale* con timeZone).
function fmtFechaCO(ms, opts) {
  return new Date(ms).toLocaleDateString("es-CO", Object.assign({ timeZone: "America/Bogota" }, opts || {}));
}
function fmtHoraCO(ms, opts) {
  return new Date(ms).toLocaleTimeString("es-CO", Object.assign({ timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" }, opts || {}));
}
// ¿`ms` cae en el día de HOY en Colombia?
function esHoyCO(ms) { return !!ms && inicioDiaCO(ms) === inicioDiaCO(); }

// ── Rangos de fecha ──
// Devuelve {desde, hasta, desdeAnterior, hastaAnterior, label} en ms.
// El "periodo anterior" es siempre del MISMO largo, inmediatamente antes
// — así el Δ compara peras con peras (una semana contra una semana).
// TODO el cálculo es respecto a la medianoche de Colombia.
function rangoReporte(clave, personalizado) {
  const dia = 86400000;
  const hoy0 = inicioDiaCO();          // medianoche de Colombia, hoy
  const finDe = (d) => d + dia - 1;
  const r = relojCO(hoy0);
  const anioHoy = r.getUTCFullYear(), mesHoy = r.getUTCMonth();
  let desde, hasta, label;

  switch (clave) {
    // Un día concreto de un <input type="date"> — "YYYY-MM-DD".
    case "dia": {
      const [y, m, d] = String((personalizado && personalizado.dia) || "").split("-").map(Number);
      if (!y || !m || !d) { desde = hoy0; hasta = finDe(desde); label = "Hoy"; break; }
      desde = fechaCO(y, m, d); hasta = finDe(desde);
      label = fmtFechaCO(desde, { day: "2-digit", month: "long", year: "numeric" });
      break;
    }
    // Un mes concreto de un <input type="month"> — "YYYY-MM".
    case "mesEspecifico": {
      const [y, m] = String((personalizado && personalizado.mes) || "").split("-").map(Number);
      if (!y || !m) { desde = hoy0; hasta = finDe(desde); label = "Hoy"; break; }
      desde = fechaCO(y, m, 1);
      hasta = fechaCO(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - 1;
      label = fmtFechaCO(desde, { month: "long", year: "numeric" });
      break;
    }
    case "ayer":
      desde = hoy0 - dia; hasta = finDe(desde); label = "Ayer"; break;
    case "7d":
      desde = hoy0 - 6 * dia; hasta = finDe(hoy0); label = "Últimos 7 días"; break;
    case "30d":
      desde = hoy0 - 29 * dia; hasta = finDe(hoy0); label = "Últimos 30 días"; break;
    case "mes":
      desde = fechaCO(anioHoy, mesHoy + 1, 1); hasta = finDe(hoy0); label = "Este mes"; break;
    case "mesPasado": {
      const y = mesHoy === 0 ? anioHoy - 1 : anioHoy;
      const m = mesHoy === 0 ? 12 : mesHoy;       // 1-12, mes anterior
      desde = fechaCO(y, m, 1);
      hasta = fechaCO(anioHoy, mesHoy + 1, 1) - 1;
      label = "Mes pasado"; break;
    }
    case "custom":
      desde = (personalizado && personalizado.desde) || hoy0;
      hasta = (personalizado && personalizado.hasta) || finDe(hoy0);
      label = "Personalizado"; break;
    case "hoy":
    default:
      desde = hoy0; hasta = finDe(desde); label = "Hoy"; break;
  }

  const largo = hasta - desde + 1;
  return { clave: clave || "hoy", label, desde, hasta, desdeAnterior: desde - largo, hastaAnterior: desde - 1 };
}

// ── Filtro base ──
// opts: { desde, hasta, origen ('mesa'|'domicilio'|'recoger'|''), persona,
//         soloPagados (bool), incluirCancelados (bool) }
// `persona` matchea contra mesero / cajero / driverName — el dashboard
// ofrece un solo selector y no hace falta saber de antemano qué rol es.
function filtrarPedidos(entries, opts) {
  const o = opts || {};
  return (entries || []).filter(([, p]) => {
    if (!p) return false;
    if (!o.incluirCancelados && statusDe(p) === "cancelado") return false;
    if (o.soloPagados && p.pagado !== true) return false;
    const ts = tsDe(p);
    if (o.desde != null && ts < o.desde) return false;
    if (o.hasta != null && ts > o.hasta) return false;
    if (o.origen && origenDe(p) !== o.origen) return false;
    if (o.persona && ![p.mesero, p.cajero, p.driverName].includes(o.persona)) return false;
    return true;
  });
}

// Variación porcentual entera. null si no hay base contra la cual comparar
// (evita el "∞%" cuando el periodo anterior fue 0).
function variacionPct(actual, anterior) {
  if (!anterior) return null;
  return Math.round(((actual - anterior) / anterior) * 100);
}

// ── Resumen de ventas (solo pagados) ──
function resumenVentas(entriesPagados) {
  const lista = entriesPagados || [];
  const total = lista.reduce((s, [, p]) => s + (p.total || 0), 0);
  const envios = lista.reduce((s, [, p]) => s + (p.shipping || 0), 0);
  const propinas = lista.reduce((s, [, p]) => s + (p.tipAmount || 0), 0);
  const unidades = lista.reduce((s, [, p]) => s + (p.lineas || []).reduce((s2, l) => s2 + (l.qty || 0), 0), 0);
  const pedidos = lista.length;
  const porMetodo = { efectivo: 0, tarjeta: 0, transferencia: 0, otro: 0 };
  lista.forEach(([, p]) => {
    const m = p.metodoPago;
    porMetodo[porMetodo[m] !== undefined ? m : "otro"] += p.total || 0;
  });
  return {
    total, pedidos, unidades, envios, propinas, porMetodo,
    ticketPromedio: pedidos ? Math.round(total / pedidos) : 0,
    itemsPorPedido: pedidos ? Math.round((unidades / pedidos) * 10) / 10 : 0,
  };
}

// ── Serie diaria (gráfico de línea) ──
// Devuelve un punto por CADA día del rango, incluso sin ventas — si no,
// la línea "salta" días y engaña sobre la tendencia real.
function serieDiaria(entriesPagados, desde, hasta) {
  const dia = 86400000;
  const acc = {};
  (entriesPagados || []).forEach(([, p]) => {
    const k = inicioDiaCO(tsDe(p));          // medianoche de Colombia de ese pedido
    const a = acc[k] || { total: 0, pedidos: 0 };
    a.total += p.total || 0; a.pedidos += 1; acc[k] = a;
  });
  const puntos = [];
  for (let t = inicioDiaCO(desde); t <= hasta; t += dia) {
    const a = acc[t] || { total: 0, pedidos: 0 };
    puntos.push({ ts: t, fecha: fmtFechaCO(t, { day: "2-digit", month: "short" }), total: a.total, pedidos: a.pedidos });
  }
  return puntos;
}

// ── Buckets de demanda ──
// Cuenta TODOS los pedidos no cancelados (no solo los pagados): la
// demanda operativa es cuánta gente pidió, no cuánto se cobró.
function bucketsPorHora(entries) {
  const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, label: String(h).padStart(2, "0") + ":00", pedidos: 0, total: 0 }));
  (entries || []).forEach(([, p]) => {
    const ts = tsDe(p); if (!ts) return;
    const h = relojCO(ts).getUTCHours();     // hora de Colombia
    horas[h].pedidos += 1; horas[h].total += p.total || 0;
  });
  return horas;
}

function bucketsPorDiaSemana(entries) {
  const nombres = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const dias = nombres.map((n, i) => ({ dia: i, label: n, pedidos: 0, total: 0 }));
  (entries || []).forEach(([, p]) => {
    const ts = tsDe(p); if (!ts) return;
    const d = relojCO(ts).getUTCDay();       // día de la semana en Colombia
    dias[d].pedidos += 1; dias[d].total += p.total || 0;
  });
  return dias;
}

// ── Tiempos de operación ──
// Salen de statusHistory[] (cada cambio: {status, at, byEmail}). Los
// pedidos viejos de prueba no lo tienen: esas muestras se descartan en
// vez de contar como 0 min, que ensuciaría el promedio.
function _horaDeEstado(p, status) {
  const h = p && p.statusHistory ? Object.values(p.statusHistory) : [];
  const match = h.filter((e) => e && e.status === status && typeof e.at === "number").sort((a, b) => a.at - b.at)[0];
  return match ? match.at : null;
}

function _mins(desde, hasta) {
  if (!desde || !hasta || hasta < desde) return null;
  return Math.round((hasta - desde) / 60000);
}

// Tiempos de UN pedido. Cualquiera puede venir null (falta el dato).
function tiemposDePedido(p) {
  const creado = tsDe(p) || null;
  const confirmado = p.tsConfirmado || _horaDeEstado(p, "enviado");
  const listo = _horaDeEstado(p, "listo");
  const enCamino = _horaDeEstado(p, "en_camino");
  const entregado = _horaDeEstado(p, "entregado");
  return {
    confirmacion: _mins(creado, confirmado), // solo domicilio: cuánto tardó caja en aceptar
    cocina: _mins(confirmado || creado, listo),
    entrega: _mins(enCamino, entregado),
    total: _mins(creado, entregado),
  };
}

// Promedios + % a tiempo vs el ETA que prometió caja.
function tiemposOperacion(entries) {
  const acc = { confirmacion: [], cocina: [], entrega: [], total: [] };
  let conEta = 0, aTiempo = 0;
  (entries || []).forEach(([, p]) => {
    const t = tiemposDePedido(p);
    Object.keys(acc).forEach((k) => { if (t[k] != null) acc[k].push(t[k]); });
    if (p.etaMinutes && p.etaSetAt) {
      const entregado = _horaDeEstado(p, "entregado");
      if (entregado) {
        conEta += 1;
        if (entregado <= p.etaSetAt + p.etaMinutes * 60000) aTiempo += 1;
      }
    }
  });
  const prom = (arr) => (arr.length ? Math.round(arr.reduce((s, n) => s + n, 0) / arr.length) : null);
  // La MEDIANA importa tanto como el promedio: con pocos pedidos, un solo
  // caso raro (un pedido que quedó abierto toda la tarde) infla el promedio
  // y hace desconfiar del número. Si promedio y mediana difieren mucho, hay
  // un valor atípico — por eso se devuelven los dos y el rango min–max.
  const mediana = (arr) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  };
  const stat = (arr) => ({
    prom: prom(arr), mediana: mediana(arr), n: arr.length,
    min: arr.length ? Math.min.apply(null, arr) : null,
    max: arr.length ? Math.max.apply(null, arr) : null,
  });
  return {
    confirmacion: prom(acc.confirmacion), cocina: prom(acc.cocina),
    entrega: prom(acc.entrega), total: prom(acc.total),
    muestras: { confirmacion: acc.confirmacion.length, cocina: acc.cocina.length, entrega: acc.entrega.length, total: acc.total.length },
    detalle: { confirmacion: stat(acc.confirmacion), cocina: stat(acc.cocina), entrega: stat(acc.entrega), total: stat(acc.total) },
    pctATiempo: conEta ? Math.round((aTiempo / conEta) * 100) : null,
    muestrasEta: conEta,
  };
}

// Muestra mínima para que un promedio de tiempos sea creíble. Por debajo
// de esto la UI lo marca como "poca muestra" en vez de mostrarlo como si
// fuera un dato firme.
const MUESTRA_MINIMA_TIEMPOS = 5;

// ── Tasas de cancelación / no entregado ──
// Necesita los pedidos SIN filtrar por estado (incluirCancelados: true).
function tasasIncidencia(entriesTodos) {
  const lista = entriesTodos || [];
  const total = lista.length || 1;
  const cancelados = lista.filter(([, p]) => statusDe(p) === "cancelado");
  const noEntregados = lista.filter(([, p]) => statusDe(p) === "no_entregado");
  const agrupar = (arr, campo) => {
    const m = {};
    arr.forEach(([, p]) => { const k = p[campo] || "Sin motivo"; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n);
  };
  return {
    cancelados: cancelados.length,
    pctCancelados: Math.round((cancelados.length / total) * 100),
    motivosCancelacion: agrupar(cancelados, "motivoCancelacion"),
    noEntregados: noEntregados.length,
    pctNoEntregados: Math.round((noEntregados.length / total) * 100),
    motivosNoEntrega: agrupar(noEntregados, "deliveryFailureReason"),
  };
}

// ── Resumen por canal (mesa / domicilio / recoger) ──
function resumenCanales(entriesPagados) {
  const base = { mesa: null, domicilio: null, recoger: null };
  Object.keys(base).forEach((k) => {
    const sub = (entriesPagados || []).filter(([, p]) => origenDe(p) === k);
    base[k] = Object.assign({ canal: k }, resumenVentas(sub));
  });
  return base;
}

// ── Resumen por persona ──
// rol: 'mesero' | 'cajero' | 'driverName'. Devuelve filas ordenadas por
// total vendido. `pedidos` cuenta las veces que esa persona aparece.
function resumenPersonas(entriesPagados, rol) {
  const campo = rol || "mesero";
  const acc = {};
  (entriesPagados || []).forEach(([, p]) => {
    const nombre = p[campo];
    if (!nombre) return;
    const a = acc[nombre] || { nombre, total: 0, pedidos: 0, unidades: 0, propinas: 0 };
    a.total += p.total || 0;
    a.pedidos += 1;
    a.unidades += (p.lineas || []).reduce((s, l) => s + (l.qty || 0), 0);
    a.propinas += p.tipAmount || 0;
    acc[nombre] = a;
  });
  return Object.values(acc)
    .map((a) => Object.assign(a, { ticketPromedio: a.pedidos ? Math.round(a.total / a.pedidos) : 0 }))
    .sort((a, b) => b.total - a.total);
}

// ── Venta por categoría ──
function ventasPorCategoria(entriesPagados) {
  const acc = {};
  (entriesPagados || []).forEach(([, p]) => {
    (p.lineas || []).forEach((l) => {
      const k = l.cat || "Sin categoría";
      const a = acc[k] || { cat: k, cantidad: 0, total: 0 };
      a.cantidad += l.qty || 0;
      a.total += precioLinea(l) * (l.qty || 0);
      acc[k] = a;
    });
  });
  return Object.values(acc).sort((a, b) => b.total - a.total);
}

// Solución para Back-Forward Cache (bfcache):
// Obliga a recargar la página si se restaura desde el historial del navegador.
// Esto evita que las apps se queden "congeladas" en la pantalla de verificación
// de sesión si el usuario navega hacia atrás/adelante.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    window.location.reload();
  }
});
