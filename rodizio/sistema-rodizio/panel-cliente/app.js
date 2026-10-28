/* ═══════════════════════════════════════════════════════════════
   Rodizio · Panel de cliente — página pública sin login, abierta
   escaneando el QR de la mesa. El pedido del cliente NO va directo
   a cocina: solo llena /solicitudes/{mesaId}, que el mesero revisa
   y confirma desde mesero-app antes de que entre a cocina.
   Firma: djgv · 0808 · 0724
   ═══════════════════════════════════════════════════════════════ */

const cop = fmtCop;
// El menú lo carga shared/menu-loader.js desde RTDB (Fase 2). CATS/
// ITEM_INDEX se llenan en indexarMenu(), tras `await esperarMenu()`
// (ver cargarInicial).
let CATS = [];
const ITEM_INDEX = {};
function indexarMenu() {
  CATS = MENU.map((g) => g.cat);
  MENU.forEach((g) => {
    CAT_EN[g.cat] = g.catEn || '';
    g.items.forEach((i) => {
      ITEM_INDEX[i.id] = Object.assign({ cat: g.cat }, i);
    });
  });
}

// Textos del menú en el idioma actual. El nombre en español sigue siendo la
// clave interna (state.cat, sugerencias, ITEM_INDEX, lo que viaja al mesero
// y a cocina); esto solo cambia lo que se MUESTRA. Sin traducción, español.
const CAT_EN = {};
function nombreDe(it) { return (getLang() === 'en' && it.nombreEn) || it.nombre; }
function descDe(it) { return (getLang() === 'en' && it.descEn) || it.desc; }
function catDe(cat) { return (getLang() === 'en' && CAT_EN[cat]) || cat; }

function sinAcentos(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Lee ?mesa=<slug>&nombre=<Nombre> de la URL del QR. mesaId se usa tal
// cual como segmento de ruta REST de Firebase (/solicitudes/{mesaId}),
// así que se valida contra el mismo charset que genera slugMesa()
// (shared/util.js) — la misma función que usan panel-admin al crear el
// QR y mesero-app al "Abrir otra", para que las 3 apps caigan en el
// mismo id. Cualquier otra cosa (barras, puntos, etc.) se trata como
// enlace inválido en vez de dejarla pasar a la URL de Firebase.
function mesaIdValido(id) {
  return typeof id === 'string' && /^[a-z0-9_-]{1,60}$/i.test(id);
}
const params = new URLSearchParams(window.location.search);
const mesaIdCrudo = params.get('mesa');
const mesaId = mesaIdValido(mesaIdCrudo) ? mesaIdCrudo : null;
// Sin ?nombre= en el QR, "mesa-7" se muestra como "Mesa 7" (no el id interno).
const nombreMesa = (params.get('nombre') || (mesaId || '').replace(/^mesa-(\d+)$/i, 'Mesa $1')).slice(0, 60);

const state = {
  cargando: true,
  cat: null, // se fija a CATS[0] tras cargar el menú (indexarMenu)
  busqueda: '',
  carrito: [], // [{id, qty, nota}]
  carritoAbierto: false,
  categoriasAbierto: false,
  productoAbierto: null,
  enviado: false,
  clienteNombre: '', // opcional — viaja con la solicitud para que cocina sepa a nombre de quién es
};

// Timestamp de nuestra propia última escritura — para no reprocesar
// el eco que el propio SSE nos manda de vuelta tras un dbSet.
let ultimoEnviadoTs = 0;
let persistT = null;

function setState(patch) {
  Object.assign(state, patch);
  render();
}

function aviso(mensaje, opts) {
  window.mostrarToast(mensaje, opts);
}

function total() {
  return state.carrito.reduce(
    (s, l) => s + ITEM_INDEX[l.id].precio * l.qty,
    0,
  );
}

function lineasActuales() {
  return state.carrito.map((l) => ({
    id: l.id,
    nombre: ITEM_INDEX[l.id].nombre,
    cat: ITEM_INDEX[l.id].cat,
    qty: l.qty,
    precio: ITEM_INDEX[l.id].precio,
    nota: (l.nota || '').trim(),
  }));
}

// Reemplazo completo del carrito compartido de la mesa — nunca dbUpdate
// parcial, así el resto de celulares en la misma mesa (y mesero-app) ven
// siempre la foto completa por SSE (ver plan: aplicarEventoSSE reusado).
function persistir(inmediato) {
  clearTimeout(persistT);
  const doSet = () => {
    const actualizado = Date.now();
    ultimoEnviadoTs = actualizado;
    // "mesa" (nombre visible) viaja junto al carrito para que mesero-app
    // pueda registrar la mesa en su grilla aunque sea una mesa especial
    // (QR generado desde panel-admin) que todavía no conocía.
    dbSet(`/solicitudes/${mesaId}`, {
      lineas: lineasActuales(),
      mesa: nombreMesa,
      cliente: state.clienteNombre.trim(),
      actualizado,
    }).catch(() => {});
  };
  if (inmediato) doSet();
  else persistT = setTimeout(doSet, 400);
}

function carritoDesdeLineas(lineas) {
  return (lineas || [])
    .filter((l) => ITEM_INDEX[l.id])
    .map((l) => ({ id: l.id, qty: l.qty, nota: l.nota || '' }));
}

function conectarSolicitud() {
  escucharSSE(`/solicitudes/${mesaId}`, (data) => {
    const solicitud = data || {};
    // Ignorar el eco de nuestra propia escritura — ya tenemos ese estado local.
    if (solicitud.actualizado && solicitud.actualizado === ultimoEnviadoTs) return;
    if (state.enviado) return;
    setState({
      carrito: carritoDesdeLineas(solicitud.lineas),
      clienteNombre: solicitud.cliente || state.clienteNombre,
    });
  });
}

async function cargarInicial() {
  if (!mesaId) {
    setState({ cargando: false });
    return;
  }
  // El menú se carga de RTDB (shared/menu-loader.js) — esperar antes de
  // salir de la pantalla de carga. Espera defensiva para evitar
  // ReferenceError si el módulo diferido aún no expuso la función.
  if (typeof esperarMenu === 'function') {
    await esperarMenu();
  } else if (typeof window.esperarMenu === 'function') {
    await window.esperarMenu();
  } else {
    await new Promise((resolve) => {
      let tries = 0;
      const t = setInterval(() => {
        if (typeof window.esperarMenu === 'function') {
          clearInterval(t);
          window.esperarMenu().then(resolve);
        } else if (window.__menuReady || ++tries > 50) {
          clearInterval(t);
          resolve();
        }
      }, 80);
    });
  }
  indexarMenu();
  if (!state.cat) state.cat = CATS[0] || null;
  try {
    const solicitud = await dbGet(`/solicitudes/${mesaId}`);
    setState({
      cargando: false,
      carrito: carritoDesdeLineas(solicitud && solicitud.lineas),
      clienteNombre: (solicitud && solicitud.cliente) || '',
    });
  } catch (e) {
    setState({ cargando: false });
  }
  conectarSolicitud();
}

/* ── Carrito ── */
function cambiar(id, delta) {
  const carrito = state.carrito.slice();
  const i = carrito.findIndex((l) => l.id === id);
  if (i === -1) {
    if (delta > 0) carrito.push({ id, qty: 1, nota: '' });
  } else {
    const q = carrito[i].qty + delta;
    if (q <= 0) carrito.splice(i, 1);
    else carrito[i] = Object.assign({}, carrito[i], { qty: q });
  }
  setState({ carrito });
  persistir();
}
function setNota(id, nota) {
  setState({
    carrito: state.carrito.map((l) =>
      l.id === id ? Object.assign({}, l, { nota }) : l,
    ),
  });
  persistir();
}

function notaPartes(nota) {
  return String(nota || '')
    .split(' · ')
    .map((parte) => parte.trim())
    .filter(Boolean);
}

function alternarSugerencia(id, sugerencia) {
  const linea = state.carrito.find((l) => l.id === id);
  if (!linea) return;
  const partes = notaPartes(linea.nota);
  const indice = partes.indexOf(sugerencia);
  if (indice === -1) partes.unshift(sugerencia);
  else partes.splice(indice, 1);
  setNota(id, partes.join(' · '));
}

async function enviarPedido() {
  if (!state.carrito.length) return;
  const btn = document.getElementById('btnEnviarPedido');
  if (btn) {
    btn.disabled = true;
    btn.textContent = t('enviando');
  }
  persistir(true);
  setState({ carritoAbierto: false, enviado: true });
  aviso(t('pedidoEnviadoToast'), { icono: 'restaurant' });
}

/* ═══════════ Animaciones que no se pueden expresar solo con CSS ═══════════
   render() reemplaza el DOM entero (innerHTML) en cada cambio de estado, así
   que nunca hay una transición real "antes → después" sobre el mismo nodo.
   Estas dos comparan el valor anterior contra el actual y agregan la clase
   de animación a mano solo cuando de verdad cambió algo. */
let unidadesCartAnterior = null;
let drawerAbiertoPrev = false;
let categoriasAbiertoPrev = false;

function flotarMasUno(btn) {
  const rect = btn.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'float-plus';
  el.textContent = '+1';
  el.style.left = rect.left + rect.width / 2 + 'px';
  el.style.top = rect.top + 'px';
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

function sincronizarBumpCarrito() {
  const bar = document.getElementById('btnAbrirCarrito');
  const unidades = state.carrito.reduce((n, l) => n + l.qty, 0);
  if (bar && unidadesCartAnterior !== null && unidades !== unidadesCartAnterior) {
    bar.classList.add('bump');
  }
  unidadesCartAnterior = unidades;
}

function sincronizarAnimDrawer() {
  const drawer = document.querySelector('.drawer');
  const sidebar = document.querySelector('.category-sidebar');
  const backdrop = document.getElementById('backdrop');
  // El backdrop es compartido entre el carrito y el panel de categorías —
  // se anima al abrir/cerrar cualquiera de los dos, no solo el carrito.
  const abiertoAntes = drawerAbiertoPrev || categoriasAbiertoPrev;
  const abiertoAhora = state.carritoAbierto || state.categoriasAbierto;
  if (backdrop) {
    if (abiertoAhora && !abiertoAntes) backdrop.classList.add('anim-in');
    else if (!abiertoAhora && abiertoAntes) backdrop.classList.add('anim-out');
  }
  if (drawer) {
    if (state.carritoAbierto && !drawerAbiertoPrev) drawer.classList.add('anim-in');
    else if (!state.carritoAbierto && drawerAbiertoPrev) drawer.classList.add('anim-out');
  }
  if (sidebar) {
    if (state.categoriasAbierto && !categoriasAbiertoPrev) sidebar.classList.add('anim-in');
    else if (!state.categoriasAbierto && categoriasAbiertoPrev) sidebar.classList.add('anim-out');
  }
  drawerAbiertoPrev = state.carritoAbierto;
  categoriasAbiertoPrev = state.categoriasAbierto;
}

/* ═══════════ RENDER ═══════════ */
function render() {
  const el = document.getElementById('app');
  el.innerHTML = renderApp();
  bindApp();
  sincronizarBumpCarrito();
  sincronizarAnimDrawer();
}

function renderApp() {
  if (!mesaId) return renderError();
  if (state.cargando) return renderCargando();
  if (state.enviado) return renderConfirmacion();
  return `
  <div class="hero">
    <div class="hero-row">
      <img class="hero-wordmark" src="/panel-cliente/logo-white.webp" alt="Rodízio Cúcuta — Desde 1986" />
      <div class="hero-right">
        <button class="lang-btn" id="btnLang">${getLang() === 'es' ? 'EN' : 'ES'}</button>
        <span class="mesa"><span class="material-symbols-outlined">table_restaurant</span>${escapeHtml(nombreMesa)}</span>
      </div>
    </div>
    <p class="hero-sub">${t('heroSub')}</p>
  </div>
  <main>${renderMenu()}</main>
  ${state.carrito.length && !state.carritoAbierto ? renderCartBar() : ''}
  <div class="backdrop ${state.carritoAbierto || state.categoriasAbierto ? 'show' : ''}" id="backdrop"></div>
  ${renderCategorySidebar()}
  ${renderDrawer()}
  ${renderProductoDetalle()}
  `;
}

function renderError() {
  return `<div class="error-wrap">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>
    <h2 style="margin-top:14px">${t('enlaceNoValido')}</h2>
    <p>${t('enlaceNoValidoDesc')}</p>
  </div>`;
}

function renderCargando() {
  return `
  <div class="cargando-wrap">
    <div class="cargando-logo"><img src="/panel-cliente/logo-white.webp" alt="Rodizio"></div>
    <div class="spinner"></div>
    <p class="cargando-texto">${t('cargandoMenu')}</p>
  </div>`;
}

function renderConfirmacion() {
  return `<div class="confirm-wrap">
    <div class="confirm-logo"><img src="/panel-cliente/logo-dark-trans.webp" alt="Rodizio"></div>
    <div class="confirm-icon"><span class="material-symbols-outlined">check_circle</span></div>
    <h2>${t('pedidoEnviado')}</h2>
    <p>${t('pedidoEnviadoDesc')}</p>
    <button class="btn-volver-menu" id="btnVolverMenu">${t('volverMenu')}</button>
  </div>`;
}

function renderCategorySidebar() {
  const abierta = state.categoriasAbierto;
  return `
  <aside class="category-sidebar ${abierta ? 'show' : ''}">
    <div class="drawer-head"><h3>${t('categories')}</h3><button class="drawer-close" id="btnCerrarCategorias"><span class="material-symbols-outlined">close</span></button></div>
    <div class="category-list">
      ${CATS.map((c) => `<button class="category-row ${c === state.cat ? 'on' : ''}" data-cat="${escapeHtml(c)}">${window.RodizioIconos?.iconoCategoria(c, c, 'cat-icon', 19) ?? ''}${escapeHtml(catDe(c))}</button>`).join('')}
    </div>
  </aside>`;
}

function renderMenu() {
  const enCarrito = {};
  state.carrito.forEach((l) => (enCarrito[l.id] = l.qty));
  const termino = sinAcentos(state.busqueda || '').trim();
  const buscando = termino.length >= 2;

  let items = [];
  if (buscando) {
    MENU.forEach((g) =>
      g.items.forEach((it) => {
        // Busca en los dos idiomas: un turista puede escribir "steak" aunque
        // la carta esté en español, y al revés.
        if (
          sinAcentos(it.nombre).includes(termino) ||
          sinAcentos(it.desc).includes(termino) ||
          sinAcentos(it.nombreEn || '').includes(termino) ||
          sinAcentos(it.descEn || '').includes(termino)
        ) {
          items.push({ ...it, catLabel: g.cat });
        }
      }),
    );
  } else {
    const grupo = MENU.find((g) => g.cat === state.cat) || MENU[0];
    items = grupo.items.map((it) => ({ ...it, catLabel: null }));
  }

  return `
  <div class="search-row">
    <button class="hamburger-btn" id="btnAbrirCategorias" aria-label="${escapeHtml(t('verCategorias'))}"><span class="material-symbols-outlined">menu</span></button>
    <div class="menu-search-wrap">
      <svg class="menu-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      <input class="menu-search" id="menuSearch" type="text" placeholder="${t('searchPlaceholder')}" value="${escapeHtml(state.busqueda)}">
      ${state.busqueda ? '<button class="menu-search-clear" id="menuSearchClear"><span class="material-symbols-outlined">close</span></button>' : ''}
    </div>
  </div>
  ${items.length === 0 && buscando ? '<div class="empty-state" style="padding:30px 0"><p>' + t('noResults') + ' "' + escapeHtml(state.busqueda) + '"</p></div>' : ''}
  ${items
    .map((it, idx) => {
      const q = enCarrito[it.id] || 0;
      const foto = it.img
        ? `<img class="plato-foto" src="${escapeHtml(it.img)}" alt="${escapeHtml(nombreDe(it))}" loading="lazy" onload="this.classList.add('cargada')" onerror="this.parentElement.classList.add('sin-foto');this.remove()">`
        : '';
      const delay = Math.min(idx, 8) * 30;
      return `<div class="plato ${q > 0 ? 'in' : ''}" style="animation-delay:${delay}ms" data-detalle="${it.id}" role="button" tabindex="0" aria-label="${escapeHtml(nombreDe(it))}">
      <div class="plato-img${it.img ? '' : ' sin-foto'}">${foto}<span class="material-symbols-outlined icon-fallback">restaurant</span></div>
      <div class="plato-info">
        ${it.catLabel ? `<span class="plato-cat">${escapeHtml(catDe(it.catLabel))}</span>` : ''}
        <b>${escapeHtml(nombreDe(it))}</b><small>${escapeHtml(descDe(it))}</small><span class="precio">${cop(it.precio)}</span>
      </div>
      <div class="stepper">
        ${q > 0 ? `<button data-quitar="${it.id}">–</button><span class="qty">${q}</span>` : ''}
        <button class="add" data-agregar="${it.id}">+</button>
      </div>
    </div>`;
    })
    .join('')}`;
}

function renderProductoDetalle() {
  const it = state.productoAbierto && ITEM_INDEX[state.productoAbierto];
  if (!it) return '';
  const linea = state.carrito.find((l) => l.id === it.id);
  const nota = linea ? linea.nota || '' : '';
  const sugerencias = sugerenciasParaItem(it);
  // Foto de 800 px (icons/menu/hd/). Si no existe todavía (ej. foto nueva sin
  // procesar), cae a la de 320 px de la lista y, si tampoco, al ícono.
  const foto = it.img
    ? `<img src="${escapeHtml(it.imgHd || it.img)}" data-respaldo="${escapeHtml(it.img)}" alt="${escapeHtml(nombreDe(it))}" decoding="async" onerror="if(this.dataset.respaldo&&this.getAttribute('src')!==this.dataset.respaldo){this.src=this.dataset.respaldo}else{this.parentElement.classList.add('sin-foto');this.remove()}">`
    : '';
  return `
  <div class="detalle-backdrop" id="detalleBackdrop"></div>
  <section class="detalle-sheet${it.img ? '' : ' sin-foto'}" role="dialog" aria-modal="true" aria-labelledby="detalleTitulo">
    <button class="detalle-close" id="btnCerrarDetalle" aria-label="${escapeHtml(t('cerrarDetalle'))}"><span class="material-symbols-outlined">close</span></button>
    <div class="detalle-img${it.img ? '' : ' sin-foto'}">${foto}<span class="material-symbols-outlined icon-fallback">restaurant</span></div>
    <span class="detalle-cat">${escapeHtml(catDe(it.cat))}</span>
    <h2 id="detalleTitulo">${escapeHtml(nombreDe(it))}</h2>
    <p class="detalle-desc">${escapeHtml(descDe(it))}</p>
    <strong class="detalle-precio">${cop(it.precio)}</strong>
    <div class="detalle-nota">
      <h3>${t('personalizaPedido')}</h3>
      ${sugerencias.length ? `<div class="sug detalle-sug">${sugerencias.map((t_) => `<button class="${notaPartes(nota).includes(t_) ? 'on' : ''}" data-detalle-nota="${it.id}" data-texto="${escapeHtml(t_)}">${escapeHtml(t_)}</button>`).join('')}</div>` : ''}
      <input class="nota-input" id="detalleNota" maxlength="200" placeholder="${t('otraIndicacion')}" value="${escapeHtml(nota)}">
    </div>
    <div class="detalle-actions">
      <button class="detalle-qty" data-quitar="${it.id}" ${linea ? '' : 'disabled'}>−</button>
      <span>${linea ? linea.qty : 0}</span>
      <button class="detalle-qty add" data-agregar="${it.id}">+</button>
    </div>
  </section>`;
}

function renderCartBar() {
  const unidades = state.carrito.reduce((n, l) => n + l.qty, 0);
  return `<button class="cart-bar" id="btnAbrirCarrito"><b>${unidades} ${unidades === 1 ? t('item') : t('items')}</b><span>${cop(total())}</span><span class="cta-mini">${t('verPedido')}</span></button>`;
}

function renderDrawer() {
  const abierta = state.carritoAbierto;
  const lineas =
    state.carrito
      .map((l) => {
        const it = ITEM_INDEX[l.id];
        const sug = sugerenciasParaItem(it);
        return `<div class="linea-row">
      <div class="linea-top">
        <b>${escapeHtml(nombreDe(it))}</b>
        <div class="stepper"><button data-quitar="${it.id}">–</button><span class="qty">${l.qty}</span><button class="add" data-agregar="${it.id}">+</button></div>
        <span class="sub">${cop(it.precio * l.qty)}</span>
      </div>
      ${sug.length ? `<div class="sug">${sug.map((sugerencia) => `<button class="${notaPartes(l.nota).includes(sugerencia) ? 'on' : ''}" data-nota-chip="${it.id}" data-texto="${escapeHtml(sugerencia)}">${escapeHtml(sugerencia)}</button>`).join('')}</div>` : ''}
      <input class="nota-input" placeholder="${t('notaCocina')}" maxlength="200" data-nota="${it.id}" value="${escapeHtml(l.nota || '')}">
    </div>`;
      })
      .join('') ||
    `<p style="text-align:center;color:var(--color-neutral-500);padding:30px 0">${t('pedidoVacio')}</p>`;
  return `
  <div class="drawer ${abierta ? 'show' : ''}">
    <div class="drawer-head"><h3>${t('tuPedido')} · ${escapeHtml(nombreMesa)}</h3><button class="drawer-close" id="btnCerrarDrawer"><span class="material-symbols-outlined">close</span></button></div>
    <div class="drawer-body">
      <input class="nombre-input" id="clienteNombreInput" maxlength="60" placeholder="${t('nombreOpcional')}" value="${escapeHtml(state.clienteNombre)}">
      ${lineas}
    </div>
    <div class="drawer-foot">
      <div class="drawer-total"><span>${t('total')}</span><span>${cop(total())}</span></div>
      <div class="drawer-actions">
        <button class="btn-ghost" id="btnVaciar">${t('vaciar')}</button>
        <button class="btn-send" id="btnEnviarPedido" ${state.carrito.length ? '' : 'disabled'}>${t('enviarPedido')}</button>
      </div>
    </div>
  </div>`;
}

function bindApp() {
  const menuSearch = document.getElementById('menuSearch');
  if (menuSearch) {
    menuSearch.oninput = (e) => {
      state.busqueda = e.target.value;
      clearTimeout(window.__searchT);
      window.__searchT = setTimeout(() => render(), 200);
    };
    if (state.busqueda) {
      menuSearch.focus();
      menuSearch.setSelectionRange(menuSearch.value.length, menuSearch.value.length);
    }
  }
  const menuSearchClear = document.getElementById('menuSearchClear');
  if (menuSearchClear) menuSearchClear.onclick = () => setState({ busqueda: '' });

  const langBtn = document.getElementById('btnLang');
  if (langBtn) langBtn.onclick = () => {
    setLang(getLang() === 'es' ? 'en' : 'es');
    render();
  };

  document
    .querySelectorAll('[data-cat]')
    .forEach((b) => (b.onclick = () => setState({ cat: b.dataset.cat, busqueda: '', categoriasAbierto: false })));
  const abrirCategorias = document.getElementById('btnAbrirCategorias');
  if (abrirCategorias) abrirCategorias.onclick = () => setState({ categoriasAbierto: true });
  const cerrarCategorias = document.getElementById('btnCerrarCategorias');
  if (cerrarCategorias) cerrarCategorias.onclick = () => setState({ categoriasAbierto: false });
  document.querySelectorAll('[data-agregar]').forEach(
    (b) =>
      (b.onclick = () => {
        flotarMasUno(b);
        cambiar(b.dataset.agregar, 1);
      }),
  );
  document
    .querySelectorAll('[data-quitar]')
    .forEach((b) => (b.onclick = () => cambiar(b.dataset.quitar, -1)));
  // Tocar el plato abre su detalle (igual que el marketplace); los botones
  // − / + del stepper solo cambian la cantidad.
  document.querySelectorAll('.plato[data-detalle]').forEach((card) => {
    const abrir = (e) => {
      if (e.target.closest('.stepper')) return;
      setState({ productoAbierto: card.dataset.detalle });
    };
    card.onclick = abrir;
    card.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(e); }
    };
  });
  const cerrarDetalle = () => setState({ productoAbierto: null });
  const btnCerrarDetalle = document.getElementById('btnCerrarDetalle');
  if (btnCerrarDetalle) btnCerrarDetalle.onclick = cerrarDetalle;
  const detalleBackdrop = document.getElementById('detalleBackdrop');
  if (detalleBackdrop) detalleBackdrop.onclick = cerrarDetalle;
  const detalleNota = document.getElementById('detalleNota');
  if (detalleNota)
    detalleNota.oninput = (e) => setNota(state.productoAbierto, e.target.value);
  document.querySelectorAll('[data-detalle-nota]').forEach(
    (b) =>
      (b.onclick = () =>
        alternarSugerencia(b.dataset.detalleNota, b.dataset.texto)),
  );

  const abrir = document.getElementById('btnAbrirCarrito');
  if (abrir) abrir.onclick = () => setState({ carritoAbierto: true });
  const backdrop = document.getElementById('backdrop');
  if (backdrop) backdrop.onclick = () => setState({ carritoAbierto: false, categoriasAbierto: false });
  const cerrarD = document.getElementById('btnCerrarDrawer');
  if (cerrarD) cerrarD.onclick = () => setState({ carritoAbierto: false });
  const vaciar = document.getElementById('btnVaciar');
  if (vaciar)
    vaciar.onclick = () => {
      setState({ carrito: [], carritoAbierto: false });
      persistir(true);
    };
  const btnEnviar = document.getElementById('btnEnviarPedido');
  if (btnEnviar) btnEnviar.onclick = enviarPedido;
  const btnVolverMenu = document.getElementById('btnVolverMenu');
  if (btnVolverMenu) btnVolverMenu.onclick = () => setState({ enviado: false });

  // Igual que las notas: se escribe sin re-renderizar en cada tecla, para
  // no perder el foco del teclado en móvil.
  const nombreInput = document.getElementById('clienteNombreInput');
  if (nombreInput)
    nombreInput.oninput = (e) => {
      state.clienteNombre = e.target.value;
      persistir();
    };

  // Igual que en mesero-app: la nota se escribe sin re-renderizar en cada
  // tecla, para no perder el foco del teclado en móvil.
  document.querySelectorAll('[data-nota]').forEach(
    (inp) =>
      (inp.oninput = (e) => {
        const linea = state.carrito.find((l) => l.id === inp.dataset.nota);
        if (linea) linea.nota = e.target.value;
        persistir();
      }),
  );
  document.querySelectorAll('[data-nota-chip]').forEach(
    (b) =>
      (b.onclick = () => {
        alternarSugerencia(b.dataset.notaChip, b.dataset.texto);
      }),
  );
}

/* ── Aviso de tratamiento de datos (Ley 1581 de 2012 / Decreto 1377 de
   2013, Colombia) ── panel-cliente es la única app del sistema sin login,
   así que es la única que le pide un dato personal a alguien que no es
   empleado (el nombre opcional del cliente, ver clienteNombreInput arriba).
   Vive FUERA de #app (que render() reemplaza entero en cada cambio de
   estado) para no desmontarse/remontarse con cada re-render — mismo patrón
   que el toast de shared/ui.js. Es solo informativo: nunca bloquea el
   pedido por QR, que debe seguir funcionando sin fricción. */
function mostrarAvisoDatos() {
  if (localStorage.getItem('rz_aviso_datos_visto')) return;
  const el = document.createElement('div');
  el.className = 'aviso-datos';
  el.innerHTML = `
    <p>${t('avisoDatos')} <a href="/panel-cliente/privacidad.html" target="_blank" rel="noopener">${t('masInfo')}</a></p>
    <button id="btnAvisoDatosOk" aria-label="${t('entendido')}">${t('entendido')}</button>
  `;
  document.body.appendChild(el);
  document.getElementById('btnAvisoDatosOk').onclick = () => {
    localStorage.setItem('rz_aviso_datos_visto', '1');
    el.remove();
  };
}

render();
// shared/firebase.js ahora es un módulo ES — puede no haber corrido
// todavía cuando este script clásico llega acá. esperarFirebase()
// (shared/util.js) espera a que window.dbGet / escucharSSE existan.
esperarFirebase().then(cargarInicial);
mostrarAvisoDatos();
