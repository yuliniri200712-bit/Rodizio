/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* ─────────────────────────────────────────────────────────────
   Rodizio · Panel de caja — vanilla JS, sin build, un solo archivo.
   Conectado directamente a Firebase Realtime Database por REST + SSE
   (Server-Sent Events), así que no necesita apiKey ni el SDK de Firebase:
   solo la URL de la base de datos.
   Alcance a propósito reducido: SOLO cobrar. Avanzar el pedido por
   "enviado"/"preparación"/"listo" es trabajo de panel-cocina — caja
   únicamente ve los pedidos ya "entregado" al mesero y confirma el
   pago (campos pagado/tsPago, no un estado nuevo del pedido).
   Sesión: guard de Firebase Authentication + rol "cajero" (o "admin",
   que pasa el guard de cualquier panel) — ver shared/auth.js y
   shared/roles.js. El login ocurre en el login raíz
   (/index.html); este panel solo verifica y, si falla, redirige ahí.
   ───────────────────────────────────────────────────────────── */
// dbUpdate / escucharSSE vienen de ../shared/firebase.js (módulo ES, SDK
// de Firebase). escapeHtml / fmtCop / crearBeep de ../shared/util.js.
// escucharSSE(path, onData, onStatus): onData recibe el árbol completo.

let pedidos = {};      // { pushId: {codigo, mesa, mesero, lineas, total, estado, ts, pagado, tsPago} }
let vistos = new Set(); // ids ya vistos en "por cobrar", para detectar nuevos y sonar aviso
let primeraCarga = true;
let sonidoOn = true;
let expandidos = new Set(); // ids con el detalle "Ver más" abierto en el historial de cobrados
let domiVistos = new Set(); // ids de domicilio ya vistos, para el aviso de "pedido nuevo por confirmar"
let choferes = {};     // { uid: {name, phone, available} } — domiciliarios habilitados (drivers/{uid}/access === true)
const beep = crearBeep([880, 1180]);

let domiciliosPausados = false;

function minsDesde(ts){ return Math.max(0, Math.round((Date.now() - ts) / 60000)); }

function renderPausaDomicilios() {
  const caja = document.getElementById("domiPausa");
  if (!caja) return;
  caja.dataset.pausado = String(domiciliosPausados);
  document.getElementById("domiPausaTitulo").textContent = domiciliosPausados ? "Domicilios en pausa" : "Domicilios activos";
  document.getElementById("domiPausaDetalle").textContent = domiciliosPausados
    ? "Los clientes solo pueden pedir para recoger en el local."
    : "La tienda en línea recibe pedidos a domicilio y para recoger.";
  document.getElementById("btnPausaDomi").textContent = domiciliosPausados ? "Reanudar domicilios" : "Pausar domicilios";
}

document.getElementById("btnPausaDomi")?.addEventListener("click", async () => {
  const btn = document.getElementById("btnPausaDomi");
  const pausar = !domiciliosPausados;
  btn.disabled = true;
  try {
    await dbSet("/settings/domiciliosPausados", pausar);
    mostrarToast(pausar ? "Domicilios en pausa: solo recoger" : "Domicilios reanudados");
  } catch (err) {
    mostrarToast("No se pudo cambiar: " + (err.message || err));
  } finally {
    btn.disabled = false;
  }
});

/* ── Server-Sent Events: escucha /orders en tiempo real ── */
function conectar() {
  // Domiciliarios habilitados — para el selector "Asignar domiciliario" de
  // la pestaña Domicilios. Solo los que el dueño habilitó a mano en
  // drivers/{uid}/access (nunca se auto-otorga). Si las reglas no dejan
  // leer /drivers (cajero que no es admin), simplemente queda vacío y el
  // selector muestra solo "Sin asignar".
  escucharSSE("/drivers", (data) => {
    const all = data || {};
    choferes = {};
    Object.entries(all).forEach(([uid, d]) => {
      if (d && d.access === true) choferes[uid] = { name: d.name || "", phone: d.phone || "", available: !!d.available };
    });
    render();
  }, () => {});

  // Pausa de domicilios de la tienda en línea (settings/domiciliosPausados):
  // el cajero la prende cuando no hay domiciliarios o la cocina no da abasto;
  // los clientes siguen pudiendo pedir para recoger. Las reglas dejan que el
  // personal activo escriba SOLO ese campo.
  escucharSSE("/settings/domiciliosPausados", (valor) => {
    domiciliosPausados = valor === true;
    renderPausaDomicilios();
  }, () => {});

  return escucharSSE("/orders", (data) => {
    pedidos = data || {};
    setStatus(true);
    render();
  }, (ok) => setStatus(ok));
}

/* ── Pestañas Cobrar / Domicilios ── */
document.getElementById("cajatabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  document.querySelectorAll("#cajatabs button").forEach((b) => b.classList.toggle("active", b === btn));
  const tab = btn.dataset.tab;
  document.getElementById("tabCobrar").hidden = tab !== "cobrar";
  document.getElementById("tabDomicilios").hidden = tab !== "domicilios";
});

function setStatus(ok) {
  document.getElementById("dot").className = "dot " + (ok ? "live" : "off");
  document.getElementById("statusTxt").textContent = ok ? "En vivo" : "Conectando…";
  document.getElementById("banner").classList.toggle("show", !ok);
}

document.getElementById("soundBtn").addEventListener("click", () => {
  sonidoOn = !sonidoOn;
  const btn = document.getElementById("soundBtn");
  btn.dataset.on = sonidoOn ? "1" : "0";
  document.getElementById("soundIcon").innerHTML = sonidoOn
    ? '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'
    : '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M23 9l-6 6"/><path d="M17 9l6 6"/>';
});

/* ── Cobro: el único cambio que hace caja sobre un pedido. La mesa no
   se toca acá — en mesero-app, "ocupada" se calcula al vuelo mirando
   si queda algún pedido de esa mesa sin pagar, así que en cuanto se
   confirma el último pago, la mesa se ve libre sola. Guarda también el
   método de pago y quién cobró, para que el reporte de caja pueda
   desglosar efectivo/tarjeta y quede registro de quién hizo el cobro. ── */
let cajero = "";
let cajeroUsuario = "";
const confirmandoPago = new Set(); // ids con un cobro en curso, para no duplicar el toque
async function confirmarPago(id, metodoPago) {
  if (confirmandoPago.has(id)) return;
  confirmandoPago.add(id);
  try {
    await dbUpdate(`/orders/${id}`, {
      pagado: true,
      tsPago: Date.now(),
      metodoPago,
      cajero,
      cajeroUsuario,
    });
  } catch (e) {
    alert("No se pudo confirmar el pago — revisa la conexión e intenta de nuevo.");
  } finally {
    confirmandoPago.delete(id);
  }
}

/* Anular un cobro (equivocación de pedido o de método). El pedido vuelve a
   "Por cobrar" y queda un registro permanente en orders/{id}/anulaciones
   con quién, cuándo, cuánto y por qué — nunca se borra, y el dueño lo ve
   en Reportes ("Cobros anulados") y en el Excel. Lo puede hacer cualquier
   cajero porque el admin entra a caja en modo observación (solo lectura);
   el motivo obligatorio + el registro son el control. Fase 2, bug B2. */
const anulando = new Set();       // ids con el formulario de motivo abierto
const motivosAnular = {};         // id -> texto escrito (sobrevive a render())
const anulandoEnCurso = new Set(); // guard anti-doble-clic
function toggleAnular(id) {
  if (anulando.has(id)) anulando.delete(id);
  else anulando.add(id);
  render();
}
async function anularCobro(id) {
  const p = pedidos[id];
  if (!p || !p.pagado || anulandoEnCurso.has(id)) return;
  const motivo = String(motivosAnular[id] || "").trim();
  const input = document.getElementById(`motivo-${id}`);
  if (motivo.length < 3) {
    if (input) { input.classList.add("is-error"); input.focus(); }
    return;
  }
  anulandoEnCurso.add(id);
  const ts = Date.now();
  try {
    await dbUpdate(`/orders/${id}`, {
      pagado: false,
      tsPago: null,
      metodoPago: null,
      cajero: null,
      cajeroUsuario: null,
      [`anulaciones/${ts}`]: {
        ts,
        motivo: motivo.slice(0, 120),
        monto: p.total || 0,
        metodoPago: p.metodoPago || null,
        tsPago: p.tsPago || null,
        cobradoPor: p.cajero || null,
        anuladoPor: cajero,
        anuladoPorUsuario: cajeroUsuario,
      },
    });
    anulando.delete(id);
    delete motivosAnular[id];
    expandidos.delete(id);
    mostrarToast("Cobro anulado — el pedido volvió a \"Por cobrar\"");
  } catch (e) {
    alert("No se pudo anular el cobro — revisa la conexión e intenta de nuevo.");
  } finally {
    anulandoEnCurso.delete(id);
  }
}

/* ── Render ── */
function linea(l) {
  return `<div class="t-linea">
    <span class="t-qty">${l.qty}×</span>
    <span class="t-nombre">${escapeHtml(nombreLinea(l))}${notaLinea(l) ? `<span class="t-nota">${escapeHtml(notaLinea(l))}</span>` : ""}</span>
  </div>`;
}

// Etiqueta de origen para el ticket de caja: "Mesa 5", "Domicilio · Ana",
// "Recoge · Juan". Caja cobra TODOS los pedidos (mesa + tienda) — el panel
// de domiciliarios sigue con la logística, pero la plata se confirma acá.
function etiquetaOrigenCaja(p) {
  const o = origenDe(p);
  if (o === "mesa") return String(p.mesa ?? "—");
  const quien = p.cliente || p.customerName || "";
  if (o === "domicilio") return "Domicilio" + (quien ? " · " + quien : "");
  if (o === "recoger") return "Recoge" + (quien ? " · " + quien : "");
  return String(p.mesa ?? "—");
}

function ticket(id, p) {
  const min = minsDesde(p.tsCambio || tsDe(p));
  const nueva = !vistos.has(id) && !primeraCarga;
  const lineasHtml = (p.lineas || []).map(linea).join("");
  const esDomicilio = origenDe(p) === "domicilio";
  const contacto = origenDe(p) === "mesa"
    ? (p.mesero || "Mesero")
    : (p.phone || "") + (esDomicilio && p.address ? " · " + p.address : "");

  return `<div class="ticket ${statusDe(p)}${nueva ? " nueva" : ""}" data-id="${id}">
    <div class="t-top">
      <div><div class="t-codigo">${escapeHtml(codigoPedido(p, id))}</div><span class="t-mesa">${escapeHtml(etiquetaOrigenCaja(p))}</span></div>
      <div class="t-time ${min >= 15 ? "warn" : ""}">hace ${min} min</div>
    </div>
    <div class="t-mesero">${escapeHtml(contacto || "—")}</div>
    <div class="t-lineas">${lineasHtml}</div>
    <div class="t-foot">
      <span class="t-total">${fmtCop(p.total)}</span>
      <div class="t-pago-botones">
        <button class="t-action a-pago" onclick="confirmarPago('${id}','efectivo')">Efectivo</button>
        <button class="t-action a-pago" onclick="confirmarPago('${id}','tarjeta')">Tarjeta</button>
        <button class="t-action a-pago" onclick="confirmarPago('${id}','transferencia')">Transf.</button>
      </div>
    </div>
    ${origenDe(p) !== "mesa"
      // Un domicilio/recoger entregado que no se va a cobrar (cliente no
      // pagó, devolución, cobro anulado) no tenía cómo salir de "Por cobrar".
      // Los de mesa se cancelan desde mesero-app, como siempre.
      ? `<div class="t-cancelar"><button type="button" class="domi-mini-btn danger" onclick="cancelarDomi('${id}')">Cancelar pedido</button></div>`
      : ""}
  </div>`;
}

function render() {
  // Caja ve TODOS los pedidos (mesa, domicilio, recoger) — es la única
  // autoridad del pago. El de domicilio cae acá cuando el domiciliario
  // lo marcó "entregado"; el cajero confirma que la plata entró.
  const entries = Object.entries(pedidos).filter(([, p]) => p && (p.status || p.estado) && statusDe(p) !== "cancelado");
  entries.sort((a, b) => (tsDe(a[1]) || 0) - (tsDe(b[1]) || 0));

  // Cobrable = ya se puede confirmar la plata. Mesa/recoger: cuando está
  // "entregado". Domicilio: también en "en_camino" — el domi pudo pagar
  // al salir (ver flujo de pago en docs-fusion).
  const cobrable = (p) => {
    const s = statusDe(p);
    if (s === "entregado") return true;
    if (origenDe(p) === "domicilio" && (s === "en_camino" || s === "llegado")) return true;
    return false;
  };
  const porCobrar = entries.filter(([, p]) => cobrable(p) && !p.pagado);
  const cobrados = entries.filter(([, p]) => p.pagado);

  fillPorCobrar(porCobrar);
  fillCobrados(cobrados);
  renderDomicilios(entries);

  document.getElementById("statHoy").textContent = entries.filter(([, p]) => esHoy(tsDe(p))).length;
  document.getElementById("statPorCobrar").textContent = porCobrar.length;
  document.getElementById("statCobradas").textContent = cobrados.filter(([, p]) => esHoy(p.tsPago)).length;

  const nuevosSinVer = porCobrar.some(([id]) => !vistos.has(id));
  if (nuevosSinVer && !primeraCarga && sonidoOn) beep();

  entries.forEach(([id]) => vistos.add(id));
  primeraCarga = false;
}

function fillPorCobrar(porCobrar) {
  const col = document.getElementById("colPorCobrar");
  document.getElementById("cPorCobrar").textContent = porCobrar.length;
  col.innerHTML = porCobrar.length
    ? porCobrar.map(([id, p]) => ticket(id, p)).join("")
    : `<div class="empty">No hay pedidos pendientes de cobro</div>`;
}

/* ── Historial de cobrados: solo los de hoy, más reciente primero ──
   "Hoy" es el día de COLOMBIA (esHoyCO en shared/util.js), no el del
   dispositivo — el corte del día tiene que ser el mismo para todos. ── */
function esHoy(ts) { return esHoyCO(ts); }
// Toggle del detalle "Ver más" de una fila del historial — es solo estado de
// esta pantalla (no toca Firebase), así que re-renderiza directo en vez de
// pasar por dbUpdate/SSE como el resto de las acciones de este archivo.
function toggleExpandido(id) {
  if (expandidos.has(id)) expandidos.delete(id);
  else expandidos.add(id);
  render();
}

// Detalle completo del cobro — todo lo que ya vive en el pedido y la fila
// resumida no alcanza a mostrar (mismos campos que ve el Excel de caja).
function bloqueAnular(id) {
  if (!anulando.has(id)) {
    return `<div class="e-anular"><button type="button" class="domi-mini-btn danger" onclick="toggleAnular('${id}')">Anular cobro</button></div>`;
  }
  const valor = escapeHtml(motivosAnular[id] || "");
  return `<div class="e-anular is-open">
    <label class="e-anular-label" for="motivo-${id}">¿Por qué se anula? (queda registrado)</label>
    <input id="motivo-${id}" class="e-anular-motivo" maxlength="120" value="${valor}"
      placeholder="Ej. me equivoqué de método de pago"
      oninput="motivosAnular['${id}'] = this.value; this.classList.remove('is-error')">
    <div class="e-anular-acciones">
      <button type="button" class="domi-mini-btn" onclick="toggleAnular('${id}')">No anular</button>
      <button type="button" class="domi-mini-btn danger" onclick="anularCobro('${id}')">Confirmar anulación</button>
    </div>
  </div>`;
}

function detalleCobrado(id, p) {
  const fecha = fmtFechaCO(p.ts || Date.now());
  const horaEntregado = p.tsCambio ? fmtHoraCO(p.tsCambio) : "—";
  const horaPago = p.tsPago ? fmtHoraCO(p.tsPago) : "—";
  const items = (p.lineas || []).map(l =>
    `<div class="e-detalle-item"><span>${l.qty}× ${escapeHtml(nombreLinea(l))}${notaLinea(l) ? ` <em>(${escapeHtml(notaLinea(l))})</em>` : ""}</span><span>${fmtCop(precioLinea(l) * (l.qty || 0))}</span></div>`
  ).join("");
  const metodoLabel = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", en_linea: "En línea" };
  const campos = [
    ["Origen", origenDe(p) === "mesa" ? ("Mesa · " + escapeHtml(p.mesa || "—")) : origenDe(p) === "domicilio" ? "Domicilio" : "Recoge en tienda"],
    [origenDe(p) === "mesa" ? "Mesero" : "Teléfono",
      origenDe(p) === "mesa"
        ? escapeHtml(p.mesero || "—") + (p.meseroUsuario ? " · @" + escapeHtml(p.meseroUsuario) : "")
        : escapeHtml(p.phone || "—")],
    ["Cajero", escapeHtml(p.cajero || "—") + (p.cajeroUsuario ? " · @" + escapeHtml(p.cajeroUsuario) : "")],
    ["Método de pago", metodoLabel[p.metodoPago] || "—"],
  ];
  if (origenDe(p) === "domicilio" && p.address) campos.push(["Dirección", escapeHtml(p.address)]);
  if (p.cliente || p.customerName) campos.push(["Cliente", escapeHtml(p.cliente || p.customerName)]);
  campos.push(["Fecha", fecha], ["Hora entregado", horaEntregado], ["Hora pago", horaPago]);
  if (p.rondaActual && p.rondaActual > 1) campos.push(["Rondas", `Pedido con ${p.rondaActual} rondas`]);

  return `<div class="e-detalle">
    <div class="e-detalle-grid">
      ${campos.map(([label, valor]) => `<div><span class="e-detalle-label">${label}</span><span>${valor}</span></div>`).join("")}
    </div>
    <div class="e-detalle-items">${items}</div>
    ${bloqueAnular(id)}
  </div>`;
}

function cobradoRow(id, p) {
  const hora = fmtHoraCO(p.tsPago || p.tsCambio || p.ts);
  const abierto = expandidos.has(id);
  return `<div class="entregado-row-wrap">
    <div class="entregado-row" onclick="toggleExpandido('${id}')">
      <span class="e-codigo">${escapeHtml(codigoPedido(p, id))}</span>
      <span class="e-mesa">${escapeHtml(etiquetaOrigenCaja(p))}</span>
      <span class="e-mesero">${escapeHtml(origenDe(p) === "mesa" ? (p.mesero || "Mesero") : ({ efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transf.", en_linea: "En línea" }[p.metodoPago] || "Domicilio"))}</span>
      <span class="e-hora">${hora}</span>
      <span class="e-total">${fmtCop(p.total)}</span>
      <span class="e-vermas">${abierto ? "Ver menos ▴" : "Ver más ▾"}</span>
    </div>
    ${abierto ? detalleCobrado(id, p) : ""}
  </div>`;
}
function fillCobrados(cobrados) {
  const hoy = cobrados.filter(([, p]) => esHoy(p.tsPago)).sort((a, b) => (b[1].tsPago || 0) - (a[1].tsPago || 0));
  document.getElementById("cCobrados").textContent = hoy.length;
  const list = document.getElementById("entregadosList");
  // render() corre con cada cambio en vivo de cualquier pedido: si el cajero
  // está escribiendo el motivo de una anulación, se le devuelve el foco y el
  // cursor para que no pierda lo que escribe a mitad de frase.
  const activo = document.activeElement;
  const enMotivo = activo && activo.id && activo.id.startsWith("motivo-") ? activo.id : null;
  const cursor = enMotivo ? activo.selectionEnd : 0;
  list.innerHTML = hoy.length
    ? hoy.map(([id, p]) => cobradoRow(id, p)).join("")
    : `<div class="entregados-empty">Aún no se ha cobrado ningún pedido hoy</div>`;
  if (enMotivo) {
    const el = document.getElementById(enMotivo);
    if (el) { el.focus(); el.setSelectionRange(cursor, cursor); }
  }
}

/* ═══════════════ Pestaña Domicilios ═══════════════
   Caja es la única puerta de entrada a cocina para un pedido de domicilio:
   mientras está "recibido" solo muestra un botón grande "Confirmar y mandar
   a cocina" (recibido → enviado). Ya confirmado, caja tiene también la
   logística (asignar domiciliario, tiempo estimado, nota, cancelar) con el
   diseño de Rodizio — sin reemplazar a tienda/admin.html, que sigue para el
   equipo de domicilios. El "entregado" y el "en_camino" los marca el
   domiciliario desde su app; "llegado" es automático por GPS. */
const confirmandoDomi = new Set();

function etiquetaEstadoDomi(s) {
  return {
    recibido: "Sin confirmar", enviado: "En cocina", preparacion: "En cocina",
    listo: "Listo", en_camino: "En camino", llegado: "Llegando", entregado: "Entregado",
    no_entregado: "No entregado", cancelado: "Cancelado",
  }[s] || s;
}

function domiCard(id, p) {
  const s = statusDe(p);
  const min = minsDesde(p.tsConfirmado || tsDe(p));
  const nueva = s === "recibido" && !domiVistos.has(id) && !primeraCarga;
  const quien = p.cliente || p.customerName || "Cliente";
  const esRecoger = origenDe(p) === "recoger";
  const lineasHtml = (p.lineas || []).map(linea).join("");
  const confirmado = s !== "recibido";

  // Ubicación del domi en vivo (si ya salió) — link a Maps.
  let mapHtml = "";
  if (p.driverId && p.driverLocation && p.driverLocation.lat != null) {
    const vieja = (Date.now() - (p.driverLocation.updatedAt || 0)) > 5 * 60000;
    const url = `https://www.google.com/maps?q=${p.driverLocation.lat},${p.driverLocation.lng}`;
    mapHtml = vieja
      ? `<span class="domi-maplink stale">Sin señal del domiciliario</span>`
      : `<a class="domi-maplink" href="${url}" target="_blank" rel="noopener noreferrer">Ver ubicación del domiciliario</a>`;
  }

  const opciones = ['<option value="">Sin asignar</option>']
    .concat(Object.entries(choferes).map(([uid, d]) =>
      `<option value="${uid}"${p.driverId === uid ? " selected" : ""}>${escapeHtml(d.name || uid.slice(0, 6))}${d.available ? " · disponible" : ""}</option>`))
    .join("");

  // Cobro en la misma tarjeta: el domicilio se puede cobrar desde que va
  // "en camino" (el domi pudo cobrar al salir) o al "entregado" (paga al
  // volver). Transferencia hoy es manual; con la pasarela se marcará sola.
  const puedeCobrar = !p.pagado && (s === "entregado" || (origenDe(p) === "domicilio" && (s === "en_camino" || s === "llegado")));
  const cobroHtml = puedeCobrar ? `
    <div class="domi-row">
      <label>Cobrar</label>
      <button class="domi-mini-btn" onclick="confirmarPago('${id}','efectivo')">Efectivo</button>
      <button class="domi-mini-btn" onclick="confirmarPago('${id}','tarjeta')">Tarjeta</button>
      <button class="domi-mini-btn" onclick="confirmarPago('${id}','transferencia')">Transferencia</button>
    </div>` : "";

  const logistica = (confirmado && s !== "entregado" && s !== "cancelado" && s !== "no_entregado" ? `
    ${esRecoger ? "" : `<div class="domi-row">
      <label>Domiciliario</label>
      <select class="domi-select" onchange="asignarDomiciliario('${id}', this.value)">${opciones}</select>
      ${mapHtml}
    </div>`}
    <div class="domi-row">
      <label>Tiempo</label>
      ${[15, 30, 45, 60].map((m) => `<button class="domi-eta-btn${p.etaMinutes === m ? " is-set" : ""}" onclick="setEtaDomi('${id}',${m})">${m} min</button>`).join("")}
    </div>
    <div class="domi-row">
      <input class="domi-note-input" placeholder="Nota interna (solo caja/cocina/domi)" value="${escapeHtml(p.internalNote || "")}" onchange="guardarNotaDomi('${id}', this.value)">
      <button class="domi-mini-btn danger" onclick="cancelarDomi('${id}')">Cancelar pedido</button>
    </div>` : "") + cobroHtml;

  return `<div class="domi-card ${nueva ? "nueva" : ""}" data-id="${id}">
    <div class="domi-top">
      <div>
        <div class="domi-codigo">${escapeHtml(codigoPedido(p, id))}</div>
        <span class="domi-estado ${s}">${etiquetaEstadoDomi(s)}</span>
      </div>
      <div class="domi-time ${min >= 15 ? "warn" : ""}">hace ${min} min</div>
    </div>
    <div class="domi-contacto">${escapeHtml(quien)}${p.phone ? " · " + escapeHtml(p.phone) : ""}</div>
    <div class="domi-dir">${esRecoger ? "Recoge en tienda" : escapeHtml(p.address || "sin dirección")}${!esRecoger && p.reference ? `<span class="domi-ref"> · ${escapeHtml(p.reference)}</span>` : ""}</div>
    ${p.scheduledFor ? `<div class="domi-programado">Programado para las ${fmtHoraCO(p.scheduledFor)}</div>` : ""}
    <div class="domi-lineas">${lineasHtml}</div>
    <div class="domi-foot">
      <span class="domi-total">${fmtCop(p.total)}</span>
      ${p.pagado
        ? `<span class="domi-chip pagado">Pagado${p.metodoPago ? " · " + (p.metodoPago === "en_linea" ? "en línea" : p.metodoPago) : ""}</span>`
        : `<span class="domi-chip sincobrar">Sin cobrar</span>`}
      ${p.etaMinutes && s !== "entregado" && s !== "cancelado" ? `<span class="domi-chip">Estimado ${p.etaMinutes} min</span>` : ""}
    </div>
    ${s === "recibido"
      ? `<button class="btn-confirmar" onclick="confirmarDomicilio('${id}')">Confirmar y mandar a cocina</button>`
      : logistica}
  </div>`;
}

function renderDomicilios(entries) {
  const domis = entries.filter(([, p]) => origenDe(p) !== "mesa");
  domis.sort((a, b) => (tsDe(a[1]) || 0) - (tsDe(b[1]) || 0));
  // Se van de la lista solo los que ya están entregados Y cobrados — un
  // domicilio entregado sin cobrar se queda visible para que caja cierre
  // la plata.
  const activos = domis.filter(([, p]) => statusDe(p) !== "entregado" || !p.pagado);

  const col = document.getElementById("colDomicilios");
  document.getElementById("cDomicilios").textContent = activos.length;
  col.innerHTML = activos.length
    ? activos.map(([id, p]) => domiCard(id, p)).join("")
    : `<div class="empty">No hay pedidos de domicilio activos ahora</div>`;

  const porConfirmar = domis.filter(([, p]) => statusDe(p) === "recibido");
  const badge = document.getElementById("domiBadge");
  badge.hidden = porConfirmar.length === 0;
  badge.textContent = porConfirmar.length;

  const hayNuevo = porConfirmar.some(([id]) => !domiVistos.has(id));
  if (hayNuevo && !primeraCarga && sonidoOn) beep();
  domis.forEach(([id]) => domiVistos.add(id));
}

async function confirmarDomicilio(id) {
  if (confirmandoDomi.has(id)) return;
  confirmandoDomi.add(id);
  const btn = document.querySelector(`.domi-card[data-id="${id}"] .btn-confirmar`);
  if (btn) { btn.disabled = true; btn.textContent = "Confirmando…"; }
  try {
    // El pedido de domicilio recibe su correlativo (D-001) recién acá —
    // cuando caja lo confirma y entra a la comanda de cocina. Antes se
    // mostraba el pushId crudo de Firebase.
    const patch = {
      status: "enviado",
      rondaEstados: { 1: "enviado" },
      confirmadoPor: cajero,
      confirmadoPorUsuario: cajeroUsuario,
      tsConfirmado: Date.now(),
    };
    const actual = pedidos[id];
    if (!actual || !actual.codigo) {
      try { patch.codigo = await siguienteCodigo("D"); } catch (e) { /* sin código, cae al corto */ }
    }
    await dbUpdate(`/orders/${id}`, patch);
    geocodificarDestino(id).catch(() => {});
  } catch (e) {
    alert("No se pudo confirmar el pedido — revisa la conexión e intenta de nuevo.");
    if (btn) { btn.disabled = false; btn.textContent = "Confirmar y mandar a cocina"; }
  } finally {
    confirmandoDomi.delete(id);
  }
}

async function asignarDomiciliario(id, uid) {
  const d = uid ? choferes[uid] : null;
  try {
    await dbUpdate(`/orders/${id}`, {
      driverId: uid || null,
      driverName: d ? d.name : null,
      driverPhone: d ? d.phone : null,
    });
  } catch (e) {
    alert("No se pudo asignar el domiciliario.");
  }
}

async function setEtaDomi(id, minutos) {
  try {
    await dbUpdate(`/orders/${id}`, { etaMinutes: minutos, etaSetAt: Date.now() });
  } catch (e) {
    alert("No se pudo guardar el tiempo estimado.");
  }
}

async function guardarNotaDomi(id, texto) {
  try {
    await dbUpdate(`/orders/${id}`, { internalNote: (texto || "").trim() || null });
  } catch (e) {
    alert("No se pudo guardar la nota.");
  }
}

async function cancelarDomi(id) {
  if (!confirm("¿Cancelar este pedido de domicilio? El cliente será notificado.")) return;
  try {
    await dbUpdate(`/orders/${id}`, { status: "cancelado", tsCambio: Date.now(), canceladoPor: cajero });
  } catch (e) {
    alert("No se pudo cancelar el pedido.");
  }
}

/* Geocodifica la dirección de texto a coordenadas (Nominatim, sin API key —
   ya se usa en la tienda) para que el "llegado" automático por GPS del
   domiciliario tenga un destino contra el cual medir distancia. Best-effort:
   si falla, el domi marca "Llegué" a mano. No pisa customerLocation (la
   ubicación exacta que compartió el cliente, si la compartió). */
async function geocodificarDestino(id) {
  const p = pedidos[id];
  if (!p || origenDe(p) !== "domicilio") return;
  if (p.customerLocation && p.customerLocation.lat != null) return;
  if (p.destinoCoords && p.destinoCoords.lat != null) return;
  const dir = (p.address || "").trim();
  if (!dir) return;
  try {
    const q = encodeURIComponent(dir + ", Cúcuta, Colombia");
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`, {
      headers: { "Accept": "application/json" },
    });
    const arr = await res.json();
    if (Array.isArray(arr) && arr[0] && arr[0].lat) {
      await dbUpdate(`/orders/${id}`, {
        destinoCoords: { lat: Number(arr[0].lat), lng: Number(arr[0].lon), fuente: "nominatim" },
      });
    }
  } catch (e) { /* best-effort */ }
}

// Selector de mes a exportar — arranca en el mes actual para no obligar
// a elegir en el caso más común (exportar el mes en curso).
const mesInput = document.getElementById("mesExportar");
if (mesInput && !mesInput.value) mesInput.value = isoDiaCO().slice(0, 7);

/* ── Exportar a Excel — los pedidos entregados y cobrados del mes
   elegido en el selector (por defecto, el mes actual), con formato
   legible: encabezado de color, columnas centradas, ancho cómodo y
   moneda formateada. Incluye una segunda hoja con el total vendido por
   plato (código + descripción) para poder buscar cuánto se vendió de
   un plato puntual en el período. ── */
async function exportarExcel() {
  const btn = document.getElementById("btnExportar");
  const mesElegido = mesInput ? mesInput.value : ""; // "YYYY-MM" o "" (sin filtro)
  const cobrados = Object.entries(pedidos)
    .filter(([, p]) => p && p.pagado && statusDe(p) !== "cancelado")
    .filter(([, p]) => !mesElegido || isoDiaCO(tsDe(p) || 0).slice(0, 7) === mesElegido)
    .sort((a, b) => (a[1].tsPago || 0) - (b[1].tsPago || 0));

  if (!cobrados.length) { alert("No hay pedidos cobrados para el mes elegido."); return; }
  if (typeof ExcelJS === "undefined") { alert("No se pudo cargar el generador de Excel — revisa tu conexión e intenta de nuevo."); return; }

  btn.disabled = true; const textoOriginal = btn.textContent; btn.textContent = "Generando…";
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Rodizio";
    wb.created = new Date();
    const ws = wb.addWorksheet("Cobrados", { views: [{ state: "frozen", ySplit: 1 }] });

    ws.columns = [
      { header: "Código", key: "codigo", width: 12 },
      { header: "Origen", key: "origen", width: 11 },
      { header: "Mesa / Cliente", key: "mesa", width: 22 },
      { header: "Mesero / Teléfono", key: "mesero", width: 20 },
      { header: "Fecha", key: "fecha", width: 13 },
      { header: "Hora entregado", key: "horaEntregado", width: 15 },
      { header: "Hora pago", key: "horaPago", width: 13 },
      { header: "Método de pago", key: "metodoPago", width: 15 },
      { header: "Cajero", key: "cajero", width: 18 },
      { header: "Ítems", key: "items", width: 55 },
      { header: "Total", key: "total", width: 15 }
    ];

    cobrados.forEach(([id, p]) => {
      const items = (p.lineas || []).map(l => `${l.qty}× [${l.id}] ${nombreLinea(l)}${notaLinea(l) ? " (" + notaLinea(l) + ")" : ""}`).join("\n");
      const oLabel = { mesa: "Mesa", domicilio: "Domicilio", recoger: "Recoge" }[origenDe(p)] || "Mesa";
      ws.addRow({
        codigo: codigoPedido(p, id),
        origen: oLabel,
        mesa: origenDe(p) === "mesa" ? (p.mesa ?? "—") : (p.cliente || p.customerName || "—"),
        mesero: origenDe(p) === "mesa" ? (p.mesero || "—") : (p.phone || "—"),
        fecha: fmtFechaCO(tsDe(p) || Date.now()),
        horaEntregado: p.tsCambio ? fmtHoraCO(p.tsCambio) : "—",
        horaPago: p.tsPago ? fmtHoraCO(p.tsPago) : "—",
        metodoPago: { tarjeta: "Tarjeta", efectivo: "Efectivo", transferencia: "Transferencia", en_linea: "En línea" }[p.metodoPago] || "—",
        cajero: p.cajero || "—",
        items,
        total: p.total || 0
      });
    });

    const totalGeneral = cobrados.reduce((s, [, p]) => s + (p.total || 0), 0);
    const totalEfectivo = cobrados.filter(([, p]) => p.metodoPago === "efectivo").reduce((s, [, p]) => s + (p.total || 0), 0);
    const totalTarjeta = cobrados.filter(([, p]) => p.metodoPago === "tarjeta").reduce((s, [, p]) => s + (p.total || 0), 0);
    const totalTransfer = cobrados.filter(([, p]) => p.metodoPago === "transferencia").reduce((s, [, p]) => s + (p.total || 0), 0);
    const totalMesa = cobrados.filter(([, p]) => origenDe(p) === "mesa").reduce((s, [, p]) => s + (p.total || 0), 0);
    const totalDomicilio = cobrados.filter(([, p]) => origenDe(p) !== "mesa").reduce((s, [, p]) => s + (p.total || 0), 0);
    const totalUnidades = cobrados.reduce((s, [, p]) => s + (p.lineas || []).reduce((s2, l) => s2 + (l.qty || 0), 0), 0);
    [
      { items: "Total en efectivo", total: totalEfectivo },
      { items: "Total en tarjeta", total: totalTarjeta },
      { items: "Total en transferencia", total: totalTransfer },
      { items: "Total mesa", total: totalMesa },
      { items: "Total domicilio / recoge", total: totalDomicilio },
      { items: "TOTAL DEL PERIODO", total: totalGeneral },
      { items: "Total de productos vendidos (unidades)", total: totalUnidades },
    ].forEach(datos => {
      const fila = ws.addRow(datos);
      fila.font = { bold: true };
      fila.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3E0DA" } };
      });
    });
    const filaUnidades = ws.lastRow;

    // Encabezado: fondo carbón, texto claro, centrado y en negrita.
    const header = ws.getRow(1);
    header.height = 24;
    header.eachCell(cell => {
      cell.font = { bold: true, color: { argb: "FFF2F0EC" }, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A2D33" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });

    // Todas las celdas de datos, centradas y con bordes suaves; la
    // columna de ítems queda alineada a la izquierda por ser texto largo,
    // pero centrada verticalmente para que se vea prolija igual.
    ws.eachRow((row, rowNumber) => {
      row.height = Math.max(row.height || 0, 20);
      row.eachCell({ includeEmpty: true }, cell => {
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFD3CFC8" } },
          left: { style: "thin", color: { argb: "FFD3CFC8" } },
          bottom: { style: "thin", color: { argb: "FFD3CFC8" } },
          right: { style: "thin", color: { argb: "FFD3CFC8" } }
        };
      });
      if (rowNumber > 1) row.getCell("items").alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    });

    ws.getColumn("total").numFmt = '"$"#,##0';
    filaUnidades.getCell("total").numFmt = "#,##0";

    // Filas alternadas para que se lea fácil de un vistazo.
    cobrados.forEach((_, i) => {
      if (i % 2 === 1) {
        ws.getRow(i + 2).eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F6F3" } };
        });
      }
    });

    ws.autoFilter = { from: "A1", to: "K1" };

    // Segunda hoja: total vendido por plato en el período — para buscar,
    // por código, cuántas unidades de un plato puntual se vendieron.
    // ventasPorPlato() vive en shared/util.js — la usa también el
    // dashboard de panel-admin, para no duplicar este cálculo.
    const filasPlato = ventasPorPlato(cobrados);

    const wsPlatos = wb.addWorksheet("Resumen por plato", { views: [{ state: "frozen", ySplit: 1 }] });
    wsPlatos.columns = [
      { header: "Código", key: "codigo", width: 12 },
      { header: "Descripción", key: "nombre", width: 40 },
      { header: "Categoría", key: "cat", width: 18 },
      { header: "Cantidad vendida", key: "cantidad", width: 16 },
      { header: "Total vendido", key: "total", width: 16 }
    ];
    filasPlato.forEach(f => wsPlatos.addRow(f));

    const totalUnidadesPlatos = filasPlato.reduce((s, f) => s + f.cantidad, 0);
    const totalVendidoPlatos = filasPlato.reduce((s, f) => s + f.total, 0);
    const filaTotalPlatos = wsPlatos.addRow({ nombre: "TOTAL VENDIDO (todos los platos)", cantidad: totalUnidadesPlatos, total: totalVendidoPlatos });
    filaTotalPlatos.font = { bold: true };
    filaTotalPlatos.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3E0DA" } };
    });

    const headerPlatos = wsPlatos.getRow(1);
    headerPlatos.height = 24;
    headerPlatos.eachCell(cell => {
      cell.font = { bold: true, color: { argb: "FFF2F0EC" }, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A2D33" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    wsPlatos.eachRow((row, rowNumber) => {
      row.height = Math.max(row.height || 0, 20);
      row.eachCell({ includeEmpty: true }, cell => {
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFD3CFC8" } },
          left: { style: "thin", color: { argb: "FFD3CFC8" } },
          bottom: { style: "thin", color: { argb: "FFD3CFC8" } },
          right: { style: "thin", color: { argb: "FFD3CFC8" } }
        };
      });
      if (rowNumber > 1) row.getCell("nombre").alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    });
    wsPlatos.getColumn("total").numFmt = '"$"#,##0';
    filasPlato.forEach((_, i) => {
      if (i % 2 === 1) {
        wsPlatos.getRow(i + 2).eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F6F3" } };
        });
      }
    });
    wsPlatos.autoFilter = { from: "A1", to: "E1" };

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rodizio-cobrados-" + (mesElegido || isoDiaCO()) + ".xlsx";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    alert("No se pudo generar el Excel. Intenta de nuevo.");
  }
  btn.disabled = false; btn.textContent = textoOriginal;
}
document.getElementById("btnExportar").addEventListener("click", exportarExcel);

/* ── Reloj + repintado del tiempo transcurrido ── */
function tickClock() {
  document.getElementById("clock").textContent = fmtHoraCO(Date.now());
}
setInterval(() => { tickClock(); render(); }, 20000);

/* ── Guard de sesión ── */
function esperarAuthListo() {
  return new Promise((resolve) => {
    (function chequear() {
      if (window.onAuthStateChanged && window.logout && window.dbGet && window.escucharSSE) resolve();
      else setTimeout(chequear, 30);
    })();
  });
}

async function iniciar() {
  await esperarAuthListo();
  onAuthStateChanged(async (user) => {
    if (!user) { window.location.href = "../index.html"; return; }
    let perfil;
    try { perfil = await getWorkerProfile(user.uid); }
    catch (e) { window.location.href = "../index.html"; return; }
    // Cualquier trabajador activo puede operar caja — ya no depende de que
    // el admin le asigne el rol "cajero" puntualmente (los turnos rotan).
    // Solo se cierra sesión de verdad si la cuenta no existe o está inactiva;
    // si el perfil es válido no hay que sacarlo de Firebase Authentication.
    if (!perfil || perfil.estado !== "activo") {
      await logout();
      window.location.href = "../index.html";
      return;
    }
    // El admin entra a observar, no a operar: ve cobros e historial en
    // vivo pero no puede confirmar pagos ni nada (barrera real en
    // shared/firebase.js vía window.__SOLO_LECTURA).
    if (hasRole(perfil, "admin")) activarModoObservador("Administrador");
    cajero = perfil.nombre || perfil.usuario || "Cajero";
    cajeroUsuario = perfil.usuario || "";
    document.getElementById("vistaCargando").style.display = "none";
    document.getElementById("app").style.display = "block";
    tickClock();
    conectar();
  });
}

document.getElementById("btnLogout").addEventListener("click", async () => {
  await logout();
  window.location.href = "../index.html";
});

iniciar();