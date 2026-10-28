/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* ─────────────────────────────────────────────────────────────
   Rodizio · Panel de administración.

   Modelo de acceso: cualquier trabajador ACTIVO puede operar mesero,
   caja o cocina sin que el admin le asigne esos roles uno a uno — el
   panel que usa lo determina el dispositivo/URL en el que trabaja hoy
   (ver guard de sesión de cada uno de esos 3 paneles). El único rol
   que sigue viviendo en rolesPermitidos es "admin", porque da acceso
   a esta pantalla (crear, editar, activar/desactivar y eliminar
   trabajadores).

   Guard de acceso: si no hay sesión, o el trabajador no tiene el rol
   "admin", se manda de vuelta al login raíz (ver app.js:iniciar()).

   Límites conocidos (sin backend/Admin SDK, ver shared/auth.js):
   - "Eliminar" borra el perfil en /trabajadores, no la cuenta de
     Firebase Authentication — pierde el acceso igual, porque todos los
     guards exigen que exista el perfil, pero la cuenta de acceso queda
     huérfana. Borrarla de verdad requiere la consola de Firebase.
   - El usuario (y por lo tanto el email sintético de login) no se
     puede cambiar una vez creada la cuenta — al editar, ese campo
     queda bloqueado.
   ───────────────────────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);

function esperarAuthListo() {
  return new Promise((resolve) => {
    (function chequear() {
      if (window.login && window.onAuthStateChanged && window.crearCuenta && window.dbGet) resolve();
      else setTimeout(chequear, 30);
    })();
  });
}

const toast = window.mostrarToast;

let trabajadores = {};   // uid -> perfil, cache de la última carga de /trabajadores
let miUid = null;        // uid del admin con la sesión activa (para los resguardos de abajo)
let editandoUid = null;  // uid en edición, o null si el formulario está en modo "crear"

// Cuántos admins ACTIVOS hay sin contar a excluirUid — para no dejar el
// sistema sin ningún admin al desactivar/quitar-rol/eliminar (no hay
// bootstrap de recuperación: si esto llega a 0, solo queda arreglarlo
// a mano desde la consola de Firebase).
function contarAdminsActivos(excluirUid) {
  return Object.entries(trabajadores).filter(([uid, t]) =>
    uid !== excluirUid && t && t.estado === "activo" && hasRole(t, "admin")
  ).length;
}

async function cargarTrabajadores() {
  const tbody = $("tbodyTrabajadores");
  try { trabajadores = (await dbGet("/trabajadores")) || {}; }
  catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-tabla">No se pudo cargar la lista — revisa tu conexión y recarga.</td></tr>`;
    return;
  }
  const filas = Object.entries(trabajadores);
  if (!filas.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-tabla">Todavía no hay trabajadores registrados</td></tr>`;
    return;
  }
  filas.sort((a, b) => (a[1].nombre || "").localeCompare(b[1].nombre || ""));
  tbody.innerHTML = filas.map(([uid, t]) => {
    const esAdmin = hasRole(t, "admin");
    const esYo = uid === miUid;
    const activo = t.estado === "activo";
    return `<tr data-uid="${uid}">
      <td>${escapeHtml(t.nombre || "—")}${esYo ? ' <span class="tag-yo">(tú)</span>' : ""}</td>
      <td>@${escapeHtml(t.usuario || "—")}</td>
      <td>${esAdmin ? '<span class="rol-tag">Admin</span>' : '<span class="rol-tag rol-tag-op">Operativo</span>'}</td>
      <td><span class="badge-estado ${activo ? "activo" : "inactivo"}">${activo ? "Activo" : "Inactivo"}</span></td>
      <td class="acciones">
        <button class="link-btn" data-editar="${uid}">Editar</button>
        <button class="link-btn" data-toggle="${uid}"${esYo ? ' disabled title="No puedes desactivar tu propia cuenta"' : ""}>${activo ? "Desactivar" : "Activar"}</button>
        <button class="link-btn link-btn-danger" data-eliminar="${uid}"${esYo ? ' disabled title="No puedes eliminar tu propia cuenta"' : ""}>Eliminar</button>
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-editar]").forEach((b) => b.onclick = () => entrarModoEdicion(b.dataset.editar));
  tbody.querySelectorAll("[data-toggle]:not(:disabled)").forEach((b) => b.onclick = () => alternarEstado(b.dataset.toggle));
  tbody.querySelectorAll("[data-eliminar]:not(:disabled)").forEach((b) => b.onclick = () => eliminarTrabajador(b.dataset.eliminar));
}

/* ── Formulario: modo creación / modo edición ── */

function entrarModoEdicion(uid) {
  const t = trabajadores[uid];
  if (!t) return;
  editandoUid = uid;
  $("formTitulo").textContent = "Editar trabajador";
  $("formSub").textContent = `Editando a @${t.usuario || "—"} — el usuario no se puede cambiar una vez creada la cuenta.`;
  $("fNombre").value = t.nombre || "";
  $("fUsuario").value = t.usuario || "";
  $("fUsuario").disabled = true;
  $("campoPassword").classList.add("hidden");
  $("fEsAdmin").checked = hasRole(t, "admin");
  $("fActivo").checked = t.estado === "activo";
  $("errCrear").classList.add("hidden");
  $("okCrear").classList.add("hidden");
  $("btnCrear").textContent = "Guardar cambios";
  $("btnCancelarEdicion").classList.remove("hidden");
  $("formCrear").scrollIntoView({ behavior: "smooth", block: "start" });
}

function salirModoEdicion() {
  editandoUid = null;
  $("formTitulo").textContent = "Crear trabajador";
  $("formSub").textContent = "Se crea la cuenta en Firebase Authentication y su perfil en /trabajadores. Cualquier trabajador activo puede operar mesero, caja o cocina — el panel que use depende del dispositivo, no hace falta asignárselo aquí.";
  $("formCrear").reset();
  $("fActivo").checked = true;
  $("fUsuario").disabled = false;
  $("campoPassword").classList.remove("hidden");
  $("btnCrear").textContent = "Crear trabajador";
  $("btnCancelarEdicion").classList.add("hidden");
}

async function crearTrabajador(nombre, roles, activo) {
  const errEl = $("errCrear"), okEl = $("okCrear");
  const usuario = $("fUsuario").value.trim().toLowerCase();
  const password = $("fPassword").value;

  if (!/^[a-z0-9_-]{3,20}$/.test(usuario)) { errEl.textContent = "Usuario: 3–20 caracteres, solo letras/números/_/-."; errEl.classList.remove("hidden"); return; }
  if (password.length < 6) { errEl.textContent = "La contraseña debe tener al menos 6 caracteres."; errEl.classList.remove("hidden"); return; }

  const btn = $("btnCrear");
  btn.disabled = true; btn.textContent = "Creando…";
  try {
    const uid = await crearCuenta(usuario, password, nombre);
    const ahora = Date.now();
    await dbSet(`/trabajadores/${uid}`, {
      nombre, usuario, rolesPermitidos: roles,
      estado: activo ? "activo" : "inactivo",
      creado: ahora, actualizado: ahora
    });
    okEl.textContent = `Cuenta creada — @${usuario} ya puede entrar por el login principal.`;
    okEl.classList.remove("hidden");
    toast("Trabajador creado: " + nombre);
    salirModoEdicion();
    await cargarTrabajadores();
  } catch (err) {
    const code = err && err.code;
    let msg = "No se pudo crear la cuenta.";
    if (code === "auth/email-already-in-use") msg = "Ese usuario ya existe.";
    else if (code === "auth/weak-password") msg = "La contraseña es muy débil.";
    else if (code === "auth/network-request-failed") msg = "Sin conexión — revisa tu internet.";
    errEl.textContent = msg;
    errEl.classList.remove("hidden");
  }
  btn.disabled = false; btn.textContent = editandoUid ? "Guardar cambios" : "Crear trabajador";
}

async function guardarEdicion(uid, nombre, roles, activo) {
  const errEl = $("errCrear");
  const original = trabajadores[uid];
  const eraAdminActivo = original && original.estado === "activo" && hasRole(original, "admin");
  const seguiraSiendoAdminActivo = roles.admin === true && activo;
  if (eraAdminActivo && !seguiraSiendoAdminActivo && contarAdminsActivos(uid) === 0) {
    errEl.textContent = "No puedes quitarle el rol admin (ni desactivarlo) siendo el último administrador activo.";
    errEl.classList.remove("hidden");
    return;
  }

  const btn = $("btnCrear");
  btn.disabled = true; btn.textContent = "Guardando…";
  try {
    await dbUpdate(`/trabajadores/${uid}`, {
      nombre, rolesPermitidos: roles,
      estado: activo ? "activo" : "inactivo",
      actualizado: Date.now()
    });
    toast("Cambios guardados: " + nombre);
    salirModoEdicion();
    await cargarTrabajadores();
  } catch (e) {
    errEl.textContent = "No se pudo guardar — revisa tu conexión.";
    errEl.classList.remove("hidden");
  }
  btn.disabled = false; btn.textContent = "Guardar cambios";
}

async function onSubmitFormulario(e) {
  e.preventDefault();
  const errEl = $("errCrear"), okEl = $("okCrear");
  errEl.classList.add("hidden"); okEl.classList.add("hidden");

  const nombre = $("fNombre").value.trim();
  // rolesPermitidos como MAPA ({admin:true}), no array — ver shared/roles.js
  // y la regla de RTDB de /trabajadores (Fase 5 de la fusión).
  const roles = $("fEsAdmin").checked ? { admin: true } : {};
  const activo = $("fActivo").checked;
  if (nombre.length < 3) { errEl.textContent = "Escribe el nombre completo."; errEl.classList.remove("hidden"); return; }

  if (editandoUid) await guardarEdicion(editandoUid, nombre, roles, activo);
  else await crearTrabajador(nombre, roles, activo);
}

/* ── Acciones rápidas por fila: activar/desactivar, eliminar ── */

async function alternarEstado(uid) {
  const t = trabajadores[uid];
  if (!t) return;
  const activarA = t.estado !== "activo";
  if (!activarA && hasRole(t, "admin") && contarAdminsActivos(uid) === 0) {
    toast("No puedes desactivar al último administrador activo.");
    return;
  }
  try {
    await dbUpdate(`/trabajadores/${uid}`, { estado: activarA ? "activo" : "inactivo", actualizado: Date.now() });
    toast(activarA ? "Trabajador activado" : "Trabajador desactivado");
    await cargarTrabajadores();
  } catch (e) {
    toast("No se pudo actualizar — revisa la conexión");
  }
}

async function eliminarTrabajador(uid) {
  const t = trabajadores[uid];
  if (!t) return;
  if (t.estado === "activo" && hasRole(t, "admin") && contarAdminsActivos(uid) === 0) {
    toast("No puedes eliminar al último administrador activo.");
    return;
  }
  const ok = confirm(
    `¿Eliminar a ${t.nombre || t.usuario}?\n\nSu perfil se borra de /trabajadores y pierde el acceso de inmediato. ` +
    `Su cuenta de acceso (usuario/contraseña) queda registrada en Firebase Authentication — esta pantalla no puede borrarla, ` +
    `solo se puede hacer desde la consola de Firebase.`
  );
  if (!ok) return;
  try {
    await dbDelete(`/trabajadores/${uid}`);
    toast("Trabajador eliminado: " + (t.nombre || t.usuario));
    if (editandoUid === uid) salirModoEdicion();
    await cargarTrabajadores();
  } catch (e) {
    toast("No se pudo eliminar — revisa la conexión");
  }
}

/* ── Códigos QR de mesas ──
   100% estático: solo codifica la URL de panel-cliente para esa mesa,
   no escribe nada en Firebase. La librería QRCode se carga con "defer"
   desde el CDN (mismo patrón que ExcelJS en panel-caja), así que puede
   no estar lista todavía cuando este script arranca. ── */
function esperarQrListo() {
  return new Promise((resolve) => {
    (function chequear() {
      if (window.QRCode) resolve();
      else setTimeout(chequear, 30);
    })();
  });
}

// slugMesa(nombre) vive en shared/util.js - misma funcion en las 3 apps.

// Base de panel-cliente para los QR de mesa. En producción `panel-cliente`
// vive SIEMPRE en su propio sitio de Hosting (`rodizio-cliente.web.app`),
// separado de este panel — nunca en `../panel-cliente/` (ese path se excluye
// del sitio del admin, daría 404). Solo en localhost, donde todo se sirve
// junto, se usa la ruta relativa para poder probar sin desplegar.
// Si algún día `panel-cliente` pasa a un dominio propio, cambiar SOLO esta
// constante (o, mejor, moverla a un nodo de config en RTDB).
const CLIENTE_URL_PROD = "https://rodizio-cliente.web.app/";
const EN_LOCAL = ["localhost", "127.0.0.1", ""].includes(location.hostname);
const CLIENTE_BASE = EN_LOCAL
  ? new URL("../panel-cliente/", window.location.href).toString()
  : CLIENTE_URL_PROD;

function urlQrMesa(mesaId, nombre) {
  const url = new URL(CLIENTE_BASE, window.location.href);
  url.searchParams.set("mesa", mesaId);
  url.searchParams.set("nombre", nombre);
  return url.toString();
}

// Enlaces "Acceso a paneles" (y el de panel-cliente en la sección de QR):
// cada panel vive en SU PROPIO sitio de Hosting, así que desde el sitio del
// admin `../mesero-app/` daría 404. En producción se reescriben al dominio
// dedicado de cada panel; en localhost se dejan los href relativos del HTML.
const SITIOS_PANEL = {
  mesero: "https://rodizio-mesero.web.app/",
  caja: "https://rodizio-caja.web.app/",
  cocina: "https://rodizio-cocina.web.app/",
  cliente: CLIENTE_URL_PROD,
};
if (!EN_LOCAL) {
  document.querySelectorAll("a[data-panel]").forEach((a) => {
    const destino = SITIOS_PANEL[a.dataset.panel];
    if (destino) a.href = destino;
  });
}

function agregarQr(mesaId, nombre) {
  // Evita apilar canvases duplicados si se hace doble clic o clics rápidos
  // seguidos en "Generar" para la misma mesa especial — reusa el que ya
  // está en el grid en vez de crear uno nuevo al lado.
  const existente = $("qrGrid").querySelector(`[data-mesa-id="${CSS.escape(mesaId)}"]`);
  if (existente) {
    existente.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const item = document.createElement("div");
  item.className = "qr-item";
  item.dataset.mesaId = mesaId;
  const canvas = document.createElement("canvas");
  const label = document.createElement("b");
  label.textContent = nombre;
  const btnDescargar = document.createElement("button");
  btnDescargar.type = "button";
  btnDescargar.textContent = "Descargar";
  item.append(canvas, label, btnDescargar);
  $("qrGrid").appendChild(item);

  QRCode.toCanvas(canvas, urlQrMesa(mesaId, nombre), { width: 160, margin: 1 }, (err) => {
    if (err) { label.textContent = nombre + " — error al generar"; return; }
    btnDescargar.onclick = () => {
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `qr-${mesaId}.png`;
      a.click();
    };
  });
}

let qrGridGenerado = false;

// Generar los 20 QR de entrada renderiza 20 canvases — de una se nota en el
// espacio de la pantalla. Se posterga hasta que el admin abra el <details>,
// y solo se hace una vez (no se regenera cada vez que se vuelve a abrir).
async function renderQrGrid() {
  if (qrGridGenerado) return;
  qrGridGenerado = true;
  await esperarQrListo();
  $("qrGrid").innerHTML = "";
  for (let i = 1; i <= 20; i++) agregarQr(`mesa-${i}`, `Mesa ${i}`);
}

async function iniciar() {
  await esperarAuthListo();

  onAuthStateChanged(async (user) => {
    if (!user) { window.location.href = "../index.html"; return; }

    let perfil;
    try { perfil = await getWorkerProfile(user.uid); }
    catch (e) { window.location.href = "../index.html"; return; }

    // Cuenta inexistente o inactiva: no hay sesión legítima que preservar.
    if (!perfil || perfil.estado !== "activo") {
      await logout();
      window.location.href = "../index.html";
      return;
    }

    // Sesión válida pero sin el rol "admin" (ej. un cajero que llegó acá por
    // error, o cambiando de pestaña): NO cerrar sesión — solo mandarlo de
    // vuelta al login raíz, que lo reconoce y lo enruta a su panel operativo
    // sin pedirle usuario/contraseña de nuevo.
    if (!hasRole(perfil, "admin")) {
      window.location.href = "../index.html";
      return;
    }

    miUid = user.uid;
    $("vistaCargando").style.display = "none";
    $("app").style.display = "block";
    cargarTrabajadores();
  });

  $("formCrear").addEventListener("submit", onSubmitFormulario);
  $("btnCancelarEdicion").addEventListener("click", salirModoEdicion);
  $("btnLogout").addEventListener("click", async () => {
    await logout();
    window.location.href = "../index.html";
  });
  $("qrDetails").addEventListener("toggle", (e) => {
    if (e.target.open) renderQrGrid();
  });
  $("btnGenerarQrCustom").addEventListener("click", () => {
    const input = $("fMesaCustom");
    const nombre = input.value.trim();
    const id = slugMesa(nombre);
    if (!id) return;
    agregarQr(id, nombre);
    input.value = "";
  });

  // Pestañas Trabajadores/Carta/Reportes — el dashboard de Reportes vive
  // en un archivo aparte (dashboard.js, app de Vue), este toggle solo
  // muestra/oculta las vistas. __dashboardOnShow (expuesto por
  // dashboard.js) fuerza a Chart.js a recalcular el tamaño del canvas,
  // que sale mal mientras su contenedor está en display:none.
  const VISTAS = [
    ["tabTrabajadores", "vistaTrabajadores"],
    ["tabCarta", "vistaCarta"],
    ["tabDashboard", "vistaDashboard"],
  ];
  function mostrarVista(tabActiva) {
    VISTAS.forEach(([tab, vista]) => {
      $(tab).classList.toggle("on", tab === tabActiva);
      $(vista).classList.toggle("hidden", tab !== tabActiva);
    });
  }
  $("tabTrabajadores").addEventListener("click", () => mostrarVista("tabTrabajadores"));
  $("tabCarta").addEventListener("click", () => {
    mostrarVista("tabCarta");
    cargarCarta();
  });
  $("tabDashboard").addEventListener("click", () => {
    mostrarVista("tabDashboard");
    if (window.__dashboardOnShow) window.__dashboardOnShow();
  });

  bindCartaEvents();

  // La fila de marca del header se pliega al bajar y vuelve al subir —
  // en Reportes, que es largo, gana pantalla útil. Umbral de 90px para
  // no reaccionar a micro-movimientos, y solo pliega pasada esa marca.
  const header = document.querySelector("header");
  let ultimoScroll = 0;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    if (Math.abs(y - ultimoScroll) < 8) return;
    if (y > ultimoScroll && y > 90) header.classList.add("is-compact");
    else if (y < ultimoScroll) header.classList.remove("is-compact");
    ultimoScroll = y;
  }, { passive: true });
}

/* ─────────────────────────────────────────────────────────────
   CARTA DE MESA  (nodos productsMesa / categoriesMesa)

   Separada del menú de domicilios (categories/products, que edita
   tienda/admin.html) el 2026-09-21: compartían el mismo nodo, así que
   borrar un producto en el admin de domicilios lo borraba también de la
   carta del cliente — se perdieron los 21 vinos y 4 champagnes hasta que
   se recuperaron. Lo que se edita acá NO toca domicilios y viceversa.

   Alcance deliberado: texto, precio, categoría y orden. Sin fotos ni
   control de agotados — la carta de mesa no los usaba antes y agregarlos
   sin necesidad solo complica la pantalla.
   ───────────────────────────────────────────────────────────── */

let platosMesa = {};       // id -> producto
let categoriasMesa = {};   // slug -> { name, order }
let editandoPlatoId = null;

// Estado de la vista de la lista (no se guarda en Firebase): qué
// categorías están abiertas, cuáles muestran todos sus platos, y el
// buscador/filtro. Sobrevive a los recargos de cargarCarta().
const CARTA_VISIBLES = 6;
const cartaUI = { abiertas: new Set(), completas: new Set(), buscar: "", cat: "" };
let cartaCats = [];        // [{ slug, name }] en el orden de la carta
let cartaMoviendo = false; // guard anti-doble-clic de las flechas ▲▼

function normCarta(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Platos de una categoría en el orden en que los ve el cliente
// (menu-loader ordena por `order`); empate → por nombre.
function itemsDeCategoria(slug) {
  return Object.keys(platosMesa)
    .filter((id) => platosMesa[id].categoryId === slug)
    .sort((a, b) =>
      (platosMesa[a].order || 0) - (platosMesa[b].order || 0) ||
      String(platosMesa[a].name || "").localeCompare(String(platosMesa[b].name || ""))
    );
}

async function cargarCarta() {
  const lista = $("cartaLista");
  const conteo = $("cartaConteo");
  try {
    const [prods, cats] = await Promise.all([
      dbGet("/productsMesa"),
      dbGet("/categoriesMesa"),
    ]);
    platosMesa = prods || {};
    categoriasMesa = cats || {};
  } catch (e) {
    conteo.textContent = "No se pudo cargar la carta — revisa tu conexión y recarga.";
    lista.innerHTML = "";
    return;
  }

  // El <select> de categorías se arma de categoriesMesa, ordenado igual
  // que en la carta del cliente (menu-loader ordena por `order`).
  cartaCats = Object.entries(categoriasMesa)
    .sort((a, b) => (a[1].order || 0) - (b[1].order || 0))
    .map(([slug, c]) => ({ slug, name: c.name || slug }));
  $("pCategoria").innerHTML = cartaCats
    .map((c) => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</option>`)
    .join("");
  $("cartaFiltroCat").innerHTML =
    `<option value="">Todas las categorías</option>` +
    cartaCats
      .map((c) => {
        const n = itemsDeCategoria(c.slug).length;
        return `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)} (${n})</option>`;
      })
      .join("");
  $("cartaFiltroCat").value = cartaUI.cat;

  const ids = Object.keys(platosMesa);
  conteo.textContent = ids.length
    ? `${ids.length} plato${ids.length === 1 ? "" : "s"} en ${cartaCats.length} categorías.`
    : "La carta está vacía.";

  renderCartaLista();
}

/* Lista por categorías plegables: cerradas por defecto (antes se
   desplegaban los 134 platos en una sola página), cada una muestra
   CARTA_VISIBLES platos y "Ver más". Buscando o filtrando por una
   categoría se abren solas. Las flechas ▲▼ cambian el `order` que usa
   la carta del QR — solo con la lista completa (sin buscar), para que
   "subir" siempre signifique lo mismo. */
function renderCartaLista() {
  const lista = $("cartaLista");
  const q = normCarta(cartaUI.buscar.trim());
  const buscando = q.length > 0;
  const cats = cartaCats.filter((c) => !cartaUI.cat || c.slug === cartaUI.cat);

  const html = cats
    .map((c) => {
      const todos = itemsDeCategoria(c.slug);
      const items = buscando
        ? todos.filter((id) => normCarta(`${platosMesa[id].name} ${platosMesa[id].description}`).includes(q))
        : todos;
      if (!items.length) return "";
      const abierta = buscando || !!cartaUI.cat || cartaUI.abiertas.has(c.slug);
      const completa = buscando || cartaUI.completas.has(c.slug);
      const visibles = completa ? items : items.slice(0, CARTA_VISIBLES);
      const slug = escapeHtml(c.slug);
      const conteo = buscando ? `${items.length} de ${todos.length}` : `${items.length}`;

      let pie = "";
      if (abierta && items.length > visibles.length) {
        pie = `<button type="button" class="carta-vermas" data-ver-mas="${slug}">Ver más (${items.length - visibles.length})</button>`;
      } else if (abierta && !buscando && completa && items.length > CARTA_VISIBLES) {
        pie = `<button type="button" class="carta-vermas" data-ver-menos="${slug}">Ver menos</button>`;
      }

      return `
      <div class="carta-grupo${abierta ? " is-open" : ""}">
        <button type="button" class="carta-cat" data-toggle-cat="${slug}" aria-expanded="${abierta}">
          <span class="carta-cat-chev" aria-hidden="true">▸</span>
          <span class="carta-cat-nombre">${escapeHtml(c.name)}</span>
          <span class="carta-cat-n">${conteo}</span>
        </button>
        ${abierta ? `<div class="carta-items">${visibles.map((id) => filaPlato(id, todos, !buscando)).join("")}</div>${pie}` : ""}
      </div>`;
    })
    .join("");

  lista.innerHTML = html ||
    `<p class="sub">Ningún plato coincide con "${escapeHtml(cartaUI.buscar.trim())}".</p>`;

  const todasAbiertas = cartaCats.length > 0 && cartaCats.every((c) => cartaUI.abiertas.has(c.slug));
  $("cartaToggleTodas").textContent = todasAbiertas ? "Cerrar todas" : "Abrir todas";
  $("cartaToggleTodas").disabled = buscando || !!cartaUI.cat;

  lista.querySelectorAll("[data-toggle-cat]").forEach((b) => {
    b.onclick = () => {
      if (buscando || cartaUI.cat) return; // abiertas a la fuerza mientras se busca/filtra
      const s = b.dataset.toggleCat;
      if (cartaUI.abiertas.has(s)) cartaUI.abiertas.delete(s);
      else cartaUI.abiertas.add(s);
      renderCartaLista();
    };
  });
  lista.querySelectorAll("[data-ver-mas]").forEach((b) => {
    b.onclick = () => { cartaUI.completas.add(b.dataset.verMas); renderCartaLista(); };
  });
  lista.querySelectorAll("[data-ver-menos]").forEach((b) => {
    b.onclick = () => { cartaUI.completas.delete(b.dataset.verMenos); renderCartaLista(); };
  });
  lista.querySelectorAll("[data-editar-plato]").forEach((b) => {
    b.onclick = () => editarPlato(b.dataset.editarPlato);
  });
  lista.querySelectorAll("[data-borrar-plato]").forEach((b) => {
    b.onclick = () => borrarPlato(b.dataset.borrarPlato);
  });
  lista.querySelectorAll("[data-mover-plato]").forEach((b) => {
    b.onclick = () => moverPlato(b.dataset.moverPlato, Number(b.dataset.delta));
  });
}

function filaPlato(id, todos, puedeOrdenar) {
  const p = platosMesa[id];
  const pos = todos.indexOf(id);
  const idEsc = escapeHtml(id);
  const nombre = escapeHtml(p.name || "");
  const flechas = puedeOrdenar
    ? `<div class="carta-orden">
        <button type="button" class="carta-btn carta-flecha" data-mover-plato="${idEsc}" data-delta="-1" title="Subir en la carta" aria-label="Subir ${nombre}"${pos === 0 ? " disabled" : ""}>▲</button>
        <button type="button" class="carta-btn carta-flecha" data-mover-plato="${idEsc}" data-delta="1" title="Bajar en la carta" aria-label="Bajar ${nombre}"${pos === todos.length - 1 ? " disabled" : ""}>▼</button>
      </div>`
    : "";
  return `<div class="carta-item">
    ${flechas}
    <div class="carta-item-info">
      <b>${escapeHtml(p.name || "—")}${p.hidden ? ' <span class="carta-tag">Oculto</span>' : ""}</b>
      <small>${escapeHtml(p.description || "")}</small>
    </div>
    <span class="carta-item-precio">${fmtCop(p.price || 0)}</span>
    <div class="carta-item-acciones">
      <button type="button" class="carta-btn" data-editar-plato="${idEsc}">Editar</button>
      <button type="button" class="carta-btn carta-btn-danger" data-borrar-plato="${idEsc}">Eliminar</button>
    </div>
  </div>`;
}

/* Sube/baja un plato dentro de su categoría. Reescribe `order` como
   0..n-1 para toda la categoría (los datos traen huecos y empates) en
   UNA sola escritura multi-ruta, y solo de los platos que cambian. */
async function moverPlato(id, delta) {
  if (cartaMoviendo) return;
  const p = platosMesa[id];
  if (!p) return;
  const ids = itemsDeCategoria(p.categoryId);
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];

  const cambios = {};
  ids.forEach((pid, n) => {
    if (platosMesa[pid].order !== n) cambios[`${pid}/order`] = n;
  });
  cartaMoviendo = true;
  try {
    await dbUpdate("/productsMesa", cambios);
    ids.forEach((pid, n) => { platosMesa[pid].order = n; });
    renderCartaLista();
  } catch (e) {
    toast("No se pudo cambiar el orden — revisa tu conexión");
  } finally {
    cartaMoviendo = false;
  }
}

function limpiarFormPlato() {
  editandoPlatoId = null;
  $("cartaFormTitulo").textContent = "Agregar plato";
  $("btnGuardarPlato").textContent = "Agregar plato";
  $("btnCancelarPlato").classList.add("hidden");
  $("pNombre").value = "";
  $("pDesc").value = "";
  $("pPrecio").value = "";
  $("pOrden").value = "";
  $("errPlato").classList.add("hidden");
  $("okPlato").classList.add("hidden");
}

function editarPlato(id) {
  const p = platosMesa[id];
  if (!p) return;
  editandoPlatoId = id;
  $("cartaFormTitulo").textContent = "Editar plato";
  $("btnGuardarPlato").textContent = "Guardar cambios";
  $("btnCancelarPlato").classList.remove("hidden");
  $("pNombre").value = p.name || "";
  $("pDesc").value = p.description || "";
  $("pPrecio").value = p.price || 0;
  $("pCategoria").value = p.categoryId || "";
  $("pOrden").value = typeof p.order === "number" ? p.order : 0;
  $("cartaFormTitulo").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function borrarPlato(id) {
  const p = platosMesa[id];
  if (!p) return;
  const ok = confirm(
    `¿Eliminar "${p.name}" de la carta de mesa?\n\n` +
    `Solo se quita de la carta que ven los clientes en la mesa. ` +
    `El menú de domicilios NO se toca.`
  );
  if (!ok) return;
  try {
    await dbDelete(`/productsMesa/${id}`);
    toast("Plato eliminado de la carta");
    cargarCarta();
  } catch (e) {
    toast("No se pudo eliminar — revisa tu conexión");
  }
}

function bindCartaEvents() {
  $("btnCancelarPlato").addEventListener("click", limpiarFormPlato);

  $("cartaBuscar").addEventListener("input", (ev) => {
    cartaUI.buscar = ev.target.value;
    renderCartaLista();
  });
  $("cartaFiltroCat").addEventListener("change", (ev) => {
    cartaUI.cat = ev.target.value;
    renderCartaLista();
  });
  $("cartaToggleTodas").addEventListener("click", () => {
    const todasAbiertas = cartaCats.every((c) => cartaUI.abiertas.has(c.slug));
    cartaUI.abiertas = todasAbiertas ? new Set() : new Set(cartaCats.map((c) => c.slug));
    renderCartaLista();
  });

  $("formPlato").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = $("errPlato");
    const ok = $("okPlato");
    err.classList.add("hidden");
    ok.classList.add("hidden");

    const name = $("pNombre").value.trim();
    const description = $("pDesc").value.trim();
    const price = Number($("pPrecio").value);
    const categoryId = $("pCategoria").value;
    const order = Number($("pOrden").value) || 0;

    if (!name) {
      err.textContent = "Ponle un nombre al plato.";
      err.classList.remove("hidden");
      return;
    }
    if (!categoryId) {
      err.textContent = "Elige una categoría.";
      err.classList.remove("hidden");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      err.textContent = "El precio tiene que ser un número (sin puntos ni comas).";
      err.classList.remove("hidden");
      return;
    }

    // Id estable: si es nuevo se deriva del nombre + timestamp, mismo
    // criterio que usa el admin de domicilios (tienda/js/catalog.js).
    const id = editandoPlatoId ||
      `${name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;

    // Al editar se conserva TODO lo que el formulario no maneja (foto,
    // sabores, subGroup, hidden…) y solo se pisan sus 5 campos. Antes se
    // guardaba solo `image` y editar una bebida le borraba el selector de
    // sabores, o volvía visible un plato oculto (Fase 2, bug B8).
    const anterior = platosMesa[id] || {};
    const plato = { ...anterior, name, description, price, categoryId, order };
    // Traducción al inglés (nameEn/descriptionEn): si cambió el texto en
    // español, la vieja ya no corresponde y se quita — la carta en inglés
    // muestra el español hasta que se retraduzca, en vez de describir otra
    // cosa. Mismo criterio que tienda/js/catalog.js (conservarTraducciones).
    if ((anterior.name || '') !== name) delete plato.nameEn;
    if ((anterior.description || '') !== description) delete plato.descriptionEn;
    try {
      await dbSet(`/productsMesa/${id}`, plato);
      toast(editandoPlatoId ? "Plato actualizado" : "Plato agregado a la carta");
      limpiarFormPlato();
      cargarCarta();
    } catch (e) {
      err.textContent = "No se pudo guardar — revisa tu conexión.";
      err.classList.remove("hidden");
    }
  });
}

iniciar();
