/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* ─────────────────────────────────────────────────────────────
   Rodizio · Panel de cocina — vanilla JS, sin build, un solo archivo.
   Igual que el panel de caja, se conecta directo a Firebase Realtime
   Database por REST + SSE (sin SDK ni apiKey), así que ambos paneles
   ven exactamente los mismos pedidos y se actualizan solos en cuanto
   uno de los dos —o el mesero desde su celular— cambia un estado.
   Este panel se queda solo con lo esencial para cocinar: el tablero
   y la franja de confirmación de entregados, sin reportes ni estadísticas.
   Sesión: guard de Firebase Authentication + rol "cocinero" (o "admin",
   que pasa el guard de cualquier panel) — ver shared/auth.js y
   shared/roles.js. El login ocurre en el login raíz
   (/index.html); este panel solo verifica y, si falla, redirige ahí.
   ───────────────────────────────────────────────────────────── */
// dbUpdate / escucharSSE / siguienteCodigo vienen de ../shared/firebase.js
// (módulo ES, SDK de Firebase). escapeHtml / fmtCop / crearBeep de ../shared/util.js.
// escucharSSE(path, onData, onStatus): onData recibe el árbol completo.

let pedidos = {};
let rondasVistas = new Set(); // "id:ronda" ya vistas alguna vez, para detectar cuáles son nuevas
let avisosVistos = {}; // id -> ts del último avisoCambio ya alertado
let primeraCarga = true;
let sonidoOn = true;
let marcandoEstado = new Set(); // ids con un cambio de estado (Empezar/Listo) en curso
const beep = crearBeep([880, 1180]);
// Tono distinto (descendente) para no confundir "pedido nuevo" con
// "el mesero avisa un cambio en algo que ya se está cocinando".
const beepAviso = crearBeep([740, 494]);

// Cada ronda PENDIENTE (no "entregado") de un pedido es su propia unidad de
// tablero — antes cocina veía un solo ticket por pedido, ubicado en la
// columna de la ronda MENOS avanzada (ver estadoEfectivoTicket en
// shared/util.js). Eso era un bug real: si la Ronda 1 ya estaba "listo"
// (esperando al mesero) y llegaba una Ronda 2 nueva, el ticket ENTERO volvía
// a "Nuevos" y la Ronda 1 lista desaparecía de la columna "Listos" hasta que
// TODO el pedido quedara listo — además de mezclar en una sola tarjeta
// rondas ya servidas con la ronda nueva que cocina debía preparar. Ahora
// cada ronda pendiente vive en su propia tarjeta y columna: un mismo pedido
// puede tener, por ejemplo, la Ronda 1 en "Listos" y la Ronda 2 en "Nuevos"
// al mismo tiempo. No se toca pedido.estado/estadoEfectivoTicket — panel-caja
// sigue dependiendo de que solo llegue a "entregado" cuando TODAS las rondas
// están servidas.
// Solo estos estados aparecen en el tablero de cocina. "recibido"
// (pedido de domicilio sin confirmar por caja) y "en_camino" (domicilio
// que ya salió) NO se cocinan acá.
const ESTADOS_COCINA = ["enviado", "preparacion", "listo"];

function unidadesPendientes(entries) {
  const unidades = [];
  entries.forEach(([id, p]) => {
    // Guard a nivel de ticket: si el pedido completo ya está más allá de
    // cocina (en_camino / entregado / cancelado), no mostrar ninguna
    // ronda — cubre el caso de un domicilio cuyo rondaEstados quedó
    // "listo" viejo después de que la tienda lo marcó "en_camino".
    if (!ESTADOS_COCINA.includes(statusDe(p))) return;
    const pendientes = agruparPorRonda(p.lineas, p.rondas)
      .filter((g) => ESTADOS_COCINA.includes(estadoDeRonda(p, g.ronda)));
    pendientes.forEach((g, i) => {
      unidades.push({
        id,
        p,
        ronda: g.ronda,
        estado: estadoDeRonda(p, g.ronda),
        lineas: g.lineas,
        ts: g.ts || tsDe(p),
        // El aviso manual (avisarCambioCocina) es por pedido, no por ronda —
        // se muestra una sola vez, en la tarjeta de la ronda pendiente de
        // número más bajo, para no duplicar el banner si hay 2+ pendientes.
        esPrimeraPendiente: i === 0,
      });
    });
  });
  return unidades;
}

function minsDesde(ts){ return Math.max(0, Math.round((Date.now() - ts) / 60000)); }

// Qué mostrar en el lugar de "Mesa X" del ticket: la mesa si es de mesa,
// o "Domicilio" / "Recoge en tienda" si vino de la tienda web.
function etiquetaOrigen(p) {
  if (p.mesa) return String(p.mesa);
  const o = origenDe(p);
  if (o === "domicilio") return "Domicilio";
  if (o === "recoger") return "Recoge en tienda";
  return "—";
}

function conectar() {
  return escucharSSE("/orders", (data) => {
    pedidos = data || {};
    setStatus(true);
    render();
  }, (ok) => setStatus(ok));
}

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

// Cada ronda avanza (Empezar/Marcar listo) por separado — pedir algo más en
// una mesa que ya tiene una parte lista/servida no debe hacer que esa parte
// "vuelva a empezar" (ver estadoEfectivoTicket/estadoDeRonda/rondaEstadosCon
// en shared/util.js). "estado" (el resumen del ticket completo) se recalcula
// en cada cambio para que panel-caja siga funcionando sin tocarlo.
async function marcarRonda(id, ronda, nuevoEstado) {
  // Un doble toque (o una conexión lenta) no debe disparar dos peticiones
  // para la misma ronda — el botón que lo originó desaparece solo en el
  // próximo render, esto cubre el instante entre el toque y ese re-render.
  const key = id + ":" + ronda;
  if (marcandoEstado.has(key)) return;
  marcandoEstado.add(key);
  try {
    const p = pedidos[id];
    if (!p) return;
    const rondaEstados = rondaEstadosCon(p);
    rondaEstados[ronda] = nuevoEstado;
    const ahora = Date.now();
    const patch = { rondaEstados, tsCambio: ahora };
    if (nuevoEstado === "preparacion") {
      patch.rondaPrepInicio = Object.assign({}, p.rondaPrepInicio, { [ronda]: ahora });
    }
    patch.status = estadoEfectivoTicket(Object.assign({}, p, patch));
    await dbUpdate(`/orders/${id}`, patch);
  } catch (e) {
    alert("No se pudo actualizar el pedido — revisa la conexión e intenta de nuevo.");
  } finally {
    marcandoEstado.delete(key);
  }
}

// El mesero avisó un cambio (ver mesero-app: avisarCambioCocina) sin tocar
// el pedido real — cocina confirma que ya habló con el mesero en persona
// y esto solo limpia la alerta, no cambia "lineas" ni "estado".
async function marcarAvisoVisto(id) {
  try {
    await dbUpdate(`/orders/${id}`, { avisoCambio: null });
  } catch (e) {
    alert("No se pudo confirmar — revisa la conexión e intenta de nuevo.");
  }
}

function linea(l) {
  return `<div class="t-linea">
    <span class="t-qty">${l.qty}×</span>
    <span class="t-nombre">${escapeHtml(nombreLinea(l))}${notaLinea(l) ? `<span class="t-nota">${escapeHtml(notaLinea(l))}</span>` : ""}</span>
  </div>`;
}

// Acción/estado visible de una ronda puntual dentro del ticket — cada ronda
// avanza y se sirve por separado (ver marcarRonda arriba), así que una ronda
// ya lista/servida no se ve afectada cuando llega una ronda nueva al mismo
// ticket.
function accionRonda(id, ronda, estadoRonda, esDomicilio, esRecoger) {
  // Domicilio: un solo toque. No hay mesero que recoja ni rondas — cocina
  // marca "Listo" y ya; el domiciliario, al marcar "Recogí" desde su app,
  // saca el ticket del tablero (pasa a en_camino). Ver handlePickup en
  // tienda/js/driver.js: recoger = salió de cocina, listo, y en camino.
  if (esDomicilio) {
    if (estadoRonda === "enviado" || estadoRonda === "preparacion") {
      return `<button class="t-ronda-btn a-listo" onclick="marcarRonda('${id}',${ronda},'listo')">${esRecoger ? "Listo para entregar" : "Listo para el domi"}</button>`;
    }
    if (estadoRonda === "listo") {
      return `<span class="t-ronda-badge b-espera"><span class="b"></span>${esRecoger ? "Listo · esperando al cliente" : "Listo · esperando domiciliario"}</span>`;
    }
    return `<span class="t-ronda-badge b-servido"><span class="material-symbols-outlined">check_circle</span>Recogido</span>`;
  }
  if (estadoRonda === "enviado") {
    return `<button class="t-ronda-btn a-prep" onclick="marcarRonda('${id}',${ronda},'preparacion')">Empezar</button>`;
  }
  if (estadoRonda === "preparacion") {
    return `<button class="t-ronda-btn a-listo" onclick="marcarRonda('${id}',${ronda},'listo')">Marcar listo</button>`;
  }
  if (estadoRonda === "listo") {
    return `<span class="t-ronda-badge b-espera"><span class="b"></span>Esperando mesero</span>`;
  }
  return `<span class="t-ronda-badge b-servido"><span class="material-symbols-outlined">check_circle</span>Servido</span>`;
}

// Pinta UNA ronda pendiente (ver unidadesPendientes arriba) — ya no el
// pedido completo. Mientras se está preparando, el cronómetro cuenta desde
// que se tocó "Empezar" para ESTA ronda, no desde que se creó el pedido.
function ticket(u, esNueva) {
  const p = u.p;
  const min = minsDesde(u.ts);
  const horaExacta = fmtHoraCO(u.ts);
  const inicioPrep = (p.rondaPrepInicio && p.rondaPrepInicio[u.ronda]) || u.ts;
  const tiempoRonda =
    u.estado === "preparacion" && inicioPrep
      ? ` · ${minsDesde(inicioPrep)} min preparando`
      : u.ts
        ? " · hace " + minsDesde(u.ts) + " min"
        : "";
  const esDomicilio = origenDe(p) !== "mesa";
  const header = `<div class="t-ronda-header">
    <span>${esDomicilio ? (origenDe(p) === "recoger" ? "Recoge en tienda" : "Domicilio") : (u.ronda === 1 ? "Pedido inicial" : "Ronda " + u.ronda)}${tiempoRonda}${esDomicilio && p.scheduledFor ? ` · <strong class="t-programado">para las ${fmtHoraCO(p.scheduledFor)}</strong>` : ""}</span>
    ${accionRonda(u.id, u.ronda, u.estado, esDomicilio, origenDe(p) === "recoger")}
  </div>`;
  const lineasHtml = header + u.lineas.map(linea).join("");

  // El pedido en sí no se toca — solo un aviso visible de que el mesero
  // quiere coordinar un cambio en persona (ver marcarAvisoVisto arriba).
  // Se muestra solo en la ronda pendiente de número más bajo (ver
  // esPrimeraPendiente en unidadesPendientes) para no duplicarlo.
  const avisoHtml = p.avisoCambio && u.esPrimeraPendiente
    ? `<div class="t-aviso">
      <span class="material-symbols-outlined">priority_high</span>
      <div class="t-aviso-texto"><b>El mesero avisa un cambio</b>${p.avisoCambio.mensaje ? `<br>${escapeHtml(p.avisoCambio.mensaje)}` : ""}<br><small>${escapeHtml(p.avisoCambio.mesero || "")}</small></div>
      <button onclick="marcarAvisoVisto('${u.id}')">Entendido</button>
    </div>`
    : "";

  return `<div class="ticket ${u.estado}${esNueva ? " nueva" : ""}" data-id="${u.id}" data-ronda="${u.ronda}">
    <div class="t-top">
      <div><div class="t-codigo">${escapeHtml(codigoPedido(p, u.id))}</div><span class="t-mesa">${escapeHtml(etiquetaOrigen(p))}</span></div>
      <div class="t-time ${min >= 15 ? "warn" : ""}">${horaExacta} · hace ${min} min</div>
    </div>
    <div class="t-personas">
      <span class="t-persona"><span class="t-persona-label">Cliente</span><span class="t-persona-valor">${escapeHtml(p.cliente || p.customerName || "—")}</span></span>
      <span class="t-persona"><span class="t-persona-label">${origenDe(p) === "mesa" ? "Mesero" : "Contacto"}</span><span class="t-persona-valor">${escapeHtml(origenDe(p) === "mesa" ? (p.mesero || "Mesero") : (p.phone || "—"))}</span></span>
    </div>
    ${avisoHtml}
    <div class="t-lineas">${lineasHtml}</div>
  </div>`;
}

function claveUnidad(u) { return u.id + ":" + u.ronda; }

function render() {
  // "cancelado" no debe verse en el tablero — se excluye acá para que
  // unidadesPendientes no lo trate como una ronda "enviado" pendiente
  // (una comanda cancelada se queda para siempre en rondaEstados.1 =
  // "enviado" porque solo se puede cancelar antes de que cocina la tome).
  const entries = Object.entries(pedidos).filter(([, p]) => p && (p.status || p.estado) && statusDe(p) !== "cancelado");
  const unidades = unidadesPendientes(entries);
  unidades.sort((a, b) => (a.ts || 0) - (b.ts || 0));

  // Qué rondas son nuevas desde el último render — una ronda siempre nace en
  // "enviado" (ver agregarRonda()/enviarNuevo() en mesero-app/app.js), así
  // que basta con detectar la primera vez que se ve esa ronda puntual, sin
  // importar en qué columna caiga.
  const nuevas = new Set();
  unidades.forEach((u) => {
    const k = claveUnidad(u);
    if (!primeraCarga && !rondasVistas.has(k)) nuevas.add(k);
  });

  const enviados = unidades.filter((u) => u.estado === "enviado");
  const prep = unidades.filter((u) => u.estado === "preparacion");
  const listos = unidades.filter((u) => u.estado === "listo");
  const entregados = entries.filter(([, p]) => statusDe(p) === "entregado");

  fill("colEnviado", "cEnviado", enviados, nuevas);
  fill("colPrep", "cPrep", prep, nuevas);
  fill("colListo", "cListo", listos, nuevas);
  fillEntregados(entregados);
  if (window.actualizarBotonInstalarPWA) window.actualizarBotonInstalarPWA();

  if (nuevas.size && !primeraCarga && sonidoOn) beep();

  // Un aviso "nuevo" es uno cuyo ts no coincide con el último que ya
  // sonamos para ese pedido — así no se repite el sonido en cada re-render
  // mientras el aviso sigue pendiente, pero si cocina lo marca "Entendido"
  // y el mesero avisa de nuevo (otro ts), vuelve a sonar.
  entries.forEach(([id, p]) => {
    if (p.avisoCambio && avisosVistos[id] !== p.avisoCambio.ts) {
      if (!primeraCarga && sonidoOn) beepAviso();
      avisosVistos[id] = p.avisoCambio.ts;
    }
  });

  unidades.forEach((u) => rondasVistas.add(claveUnidad(u)));
  primeraCarga = false;
}

function fill(colId, countId, list, nuevas) {
  const col = document.getElementById(colId);
  document.getElementById(countId).textContent = list.length;
  col.innerHTML = list.length
    ? list.map((u) => ticket(u, nuevas.has(claveUnidad(u)))).join("")
    : `<div class="empty">Sin comandas aquí por ahora</div>`;
}

// Solo una franja de confirmación — los últimos 8 pedidos entregados,
// sin historial completo ni reportes (eso vive en el panel de caja).
function fillEntregados(entregados) {
  const ultimos = entregados
    .sort((a, b) => (b[1].tsCambio || b[1].ts || 0) - (a[1].tsCambio || a[1].ts || 0))
    .slice(0, 8);
  const cont = document.getElementById("entregadosChips");
  cont.innerHTML = ultimos.length
    ? ultimos.map(([id, p]) => `<span class="entregado-chip"><span class="material-symbols-outlined ok">check_circle</span>${escapeHtml(codigoPedido(p, id))} · ${escapeHtml(etiquetaOrigen(p))}</span>`).join("")
    : `<span class="entregado-chip">Todavía no se ha entregado ningún pedido</span>`;
}

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
    // Cualquier trabajador activo puede operar cocina — ya no depende de que
    // el admin le asigne el rol "cocinero" puntualmente (los turnos rotan).
    // Solo se cierra sesión de verdad si la cuenta no existe o está inactiva;
    // si el perfil es válido no hay que sacarlo de Firebase Authentication.
    if (!perfil || perfil.estado !== "activo") {
      await logout();
      window.location.href = "../index.html";
      return;
    }
    // El admin entra a observar, no a operar: ve el tablero en vivo pero
    // no puede avanzar estados (barrera real en shared/firebase.js vía
    // window.__SOLO_LECTURA).
    if (hasRole(perfil, "admin")) activarModoObservador("Administrador");
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