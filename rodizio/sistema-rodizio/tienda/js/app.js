/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   APP — punto de entrada
   =========================================================
   No contiene reglas de negocio ni HTML: solo conecta los
   módulos (data, cart, auth, ui) entre sí y responde a
   eventos del usuario.
   ========================================================= */

import { CATEGORIES, PRODUCTS, setCategories, setProducts, formatCOP, debounce } from './data.js';
import * as cart from './cart.js';
import * as auth from './auth.js';
import * as ui from './ui.js';
import { t, getLang, setLang, campoIdioma } from './i18n.js';
import * as favorites from './favorites.js';
import * as notifications from './notifications.js';
import * as catalog from './catalog.js';
import * as settingsApi from './settings.js';
import { nowInColombia } from './settings.js';
import { watchGlobalErrors } from './errors.js';
import { confirmDialog, pickReasonDialog } from './confirm.js';
import { track } from './analytics.js';
import { iniciarAvisoCookies } from './cookies.js';
import { FAVORITES_ID, ALL_CATEGORIES_ID } from './ui.js';
import { esAlcohol, esProductoVendible } from './reglas-pedido.js';

const $ = (id) => document.getElementById(id);

const SHIPPING_FEE = 5000;
const MIN_SCHEDULE_MINUTES = 30;
const LAST_PHONE_KEY = 'rodizio_last_phone';
const PAGO_PENDIENTE_KEY = 'rodizio_pago_pendiente';
const RESTAURANT_WHATSAPP_NUMBER = '573143938235';

const state = {
  activeCategoryId: ALL_CATEGORIES_ID,
  activeSubGroup: null, // sub-pestaña dentro de una categoría (hoy solo Bebidas la usa)
  searchTerm: '',
  deliveryMode: 'domicilio',
  scheduleMode: 'asap',
  paymentMode: 'efectivo',
  currentUser: null,
  favoriteIds: favorites.getFavoriteIds(),
  outOfStockIds: new Set(),
  settings: settingsApi.DEFAULT_SETTINGS,
  // Coordenadas exactas SOLO si el cliente usó "usar mi ubicación" en
  // este checkout — se manda con el pedido para que el domiciliario
  // (y el panel) puedan navegar directo al punto, no solo al texto
  // de la dirección. Se borra si edita la dirección a mano después
  // (ya no correspondería con el texto) o al abrir un checkout nuevo.
  pendingCustomerLocation: null,
};

let unsubscribeOrders = null;
let unsubscribeAddresses = null;
let savedAddresses = [];

/* ---------- Arranque ---------- */
function init() {
  // js/rescate.js revisa esta bandera: si no existe a los 10 s, el módulo no arrancó.
  window.__rodizioArranco = true;
  watchGlobalErrors('cliente');
  iniciarAvisoCookies();
  registerServiceWorker();
  hideSplashWhenReady();

  // Si el cliente ya había elegido inglés en una visita anterior
  // (guardado en localStorage por i18n.js), aplicarlo desde el primer
  // pintado — antes esto solo pasaba al tocar el botón de idioma, así
  // que alguien que volvía con inglés ya elegido veía la página en
  // español hasta hacer clic de nuevo.
  updateStaticContentFromHTML();
  const headerLangBtn = $('header-lang-btn');
  if (headerLangBtn) headerLangBtn.textContent = getLang() === 'es' ? 'EN' : 'ES';

  // Asegura que la barra flotante y badge inicien con el estado real del carrito
  try {
    ui.renderCartBadge(cart.getState());
  } catch (err) {
    console.warn('Error inicializando estado de carrito:', err);
  }

  arrancarConCatalogoGuardado();
  ui.renderCategoryNav(state.activeCategoryId, abrirCategoria);
  renderMenu();

  catalog.onCategoriesChange((categories) => {
    if (categories.length === 0) return; // aún no hay nada en la base (o se está sembrando)
    setCategories(categories);
    catalogoRecibido('categories');
    // "Todos" y "Favoritos" son pestañas sintéticas — no están en la
    // lista de categorías reales, así que no cuentan como "categoría
    // que ya no existe". Sin esta guarda, la vista arrancaba siempre en
    // la primera categoría en vez de en "Todos".
    if (
      state.activeCategoryId !== ALL_CATEGORIES_ID &&
      state.activeCategoryId !== FAVORITES_ID &&
      !categories.some((c) => c.id === state.activeCategoryId)
    ) {
      state.activeCategoryId = ALL_CATEGORIES_ID;
    }
    ui.renderCategoryNav(state.activeCategoryId, abrirCategoria);
    ui.renderBottomNavState(state.activeCategoryId);
    renderMenu();
  }, mostrarErrorCatalogo);

  catalog.onProductsChange((products) => {
    if (products.length === 0) return; // aún no hay nada en la base (o no se puede leer todavía)
    setProducts(products);
    cart.reconcileProducts(products);
    favorites.reconcileProducts(products);
    catalogoRecibido('products');
    renderMenu();
  }, mostrarErrorCatalogo);

  favorites.onFavoritesChange((ids) => {
    state.favoriteIds = ids;
    renderMenu();
  });

  auth.onOutOfStockChange((ids) => {
    state.outOfStockIds = ids;
    renderMenu();
  });

  cart.onCartChange((cartState) => {
    ui.renderCartBadge(cartState);
    ui.renderCartDrawer(cartState, {
      onQtyChange: cart.updateQty,
      onRemove: cart.removeItem,
    });
    ui.renderCheckoutTotals(cartState.subtotal, currentShippingFee());
    renderMinOrderHint(cartState.subtotal);
  });

  auth.onAuthChange((user) => {
    state.currentUser = user;
    ui.renderAccountButton(user);
    if (user) ui.renderProfile(user);
    startOrdersTracking(user);
    if (user) revisarRegresoDePago();
    // La barra inferior (Inicio/Favoritos/Carrito/Perfil) solo tiene
    // sentido con sesión iniciada — a pedido del usuario. Sin sesión,
    // el botón de cuenta del header sigue siendo la puerta de entrada
    // para iniciar sesión.
    const bottomNav = $('bottom-nav');
    if (bottomNav) bottomNav.hidden = !user;
  });

  settingsApi.onSettingsChange((settings) => {
    state.settings = settings;
    renderDireccionRestaurante();
    renderOpenStatus();
    ui.renderCallButton();
    updateZoneInfo();
    renderPaymentModes();
  });
  // Revisa el horario/aviso de "cierra pronto" aunque no cambie la
  // configuración (el tiempo sigue corriendo, y con horario automático
  // el negocio puede pasar de abierto a cerrado sin que nadie toque nada)
  // — cada minuto es suficiente.
  setInterval(renderOpenStatus, 60000);

  bindHeaderEvents();
  bindProductModalOverlay();
  bindCartEvents();
  bindCheckoutEvents();
  bindAuthEvents();
  bindProfileEvents();
  bindBottomNavEvents();
  bindGeolocation();
}

function handleQuickAdd(product, btnEl) {
  if (!cart.addItem(product, 1, '')) return;
  ui.nudgeCartNav();
  ui.showToast(t('agregadoAlCarrito').replace('{nombre}', campoIdioma(product, 'name')));

  if (window.gsap && btnEl) {
    window.gsap.fromTo(
      btnEl,
      { scale: 0.7, rotate: -20 },
      { scale: 1, rotate: 0, duration: 0.35, ease: 'back.out(2.5)' }
    );
  }

  const floatingBar = $('floating-cart-bar');
  if (floatingBar && window.gsap && !floatingBar.hidden) {
    window.gsap.fromTo(
      floatingBar,
      { scale: 0.95, y: 5 },
      { scale: 1, y: 0, duration: 0.35, ease: 'back.out(1.8)' }
    );
  }

  track('add_to_cart', {
    currency: 'COP',
    value: product.price,
    items: [{ item_id: product.id, item_name: product.name, price: product.price, quantity: 1 }],
  });
}

function handleClearSearch() {
  state.searchTerm = '';
  const searchInput = $('search-input');
  if (searchInput) searchInput.value = '';
  const clearBtn = $('btn-search-clear');
  if (clearBtn) clearBtn.hidden = true;
  renderMenu();
}

/* Menú al arrancar. data.js trae un menú "de fábrica" (semilla de
   catalog.seedCatalogIfEmpty) con precios y productos que ya no existen:
   con señal lenta el cliente lo veía varios segundos y podía agregar
   productos falsos al carrito. Ahora se arranca con el último menú REAL
   guardado en este celular; en la primera visita, sin nada guardado, la
   portada muestra tarjetas "cargando" hasta que llega el de Firebase. */
const CATALOGO_KEY = 'rodizio_catalogo_v1';
const catalogoReal = { categories: false, products: false };

function arrancarConCatalogoGuardado() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CATALOGO_KEY) || 'null');
    if (guardado?.categories?.length && guardado?.products?.length) {
      setCategories(guardado.categories);
      setProducts(guardado.products);
      return;
    }
  } catch {
    // localStorage no disponible o dañado: se sigue como primera visita.
  }
  setCategories([]);
  setProducts([]);
  document.body.dataset.catalogo = 'cargando';
}

/* Sin conexión, permiso denegado o Firebase caído: antes las tarjetas
   "cargando" quedaban para siempre sin decir nada. Ahora se muestra un
   mensaje con botón para reintentar. Si el menú llega después, el
   mensaje desaparece solo (catalogoRecibido quita la marca). */
const CATALOGO_ESPERA_MS = 10000;
function mostrarErrorCatalogo() {
  if (document.body.dataset.catalogo !== 'cargando') return; // ya hay menú (guardado o recibido)
  document.body.dataset.catalogo = 'error';
  renderMenu();
}
setTimeout(mostrarErrorCatalogo, CATALOGO_ESPERA_MS);

function catalogoRecibido(parte) {
  catalogoReal[parte] = true;
  if (!catalogoReal.categories || !catalogoReal.products) return;
  delete document.body.dataset.catalogo;
  try {
    localStorage.setItem(CATALOGO_KEY, JSON.stringify({ categories: CATEGORIES, products: PRODUCTS }));
  } catch {
    // Sin espacio o sin localStorage: la próxima visita arranca con "cargando".
  }
}

/* La dirección que escribe el dueño en el panel reemplaza a la de fábrica
   (la del RUT, que ya viene en el HTML); el enlace lleva a Google Maps. */
function renderDireccionRestaurante() {
  const direccion = (state.settings.restaurantAddress || '').trim();
  const enlace = $('store-address');
  if (!direccion || !enlace) return;
  enlace.textContent = direccion;
  enlace.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;
}

function renderMenu() {
  ui.renderMenu({
    activeCategoryId: state.activeCategoryId,
    activeSubGroup: state.activeSubGroup,
    searchTerm: state.searchTerm,
    favoriteIds: state.favoriteIds,
    outOfStockIds: state.outOfStockIds,
    onOpenProduct: openProduct,
    onQuickAdd: handleQuickAdd,
    onToggleFavorite: favorites.toggleFavorite,
    onAddAllFavorites: handleAddAllFavorites,
    onClearSearch: handleClearSearch,
    onSelectSubGroup: selectSubGroup,
    onSelectCategory: abrirCategoria,
  });
  ui.renderCategoryStrip(state.activeCategoryId, abrirCategoria);
  // El carrusel de destacados no depende de la categoría activa ni de
  // la búsqueda — solo de qué productos tenga insignia y cuáles estén
  // agotados, así que se repinta junto con el menú sin duplicar lógica.
  ui.renderFeaturedCarousel({ outOfStockIds: state.outOfStockIds, onOpenProduct: openProduct });
}

/* "Agregar todos mis favoritos" — accesos rápido para el cliente que
   siempre pide lo mismo, sin tener que abrir cada producto uno por
   uno (los agotados ya vienen filtrados desde ui.js). */
function handleAddAllFavorites(products) {
  const vendibles = products.filter(esProductoVendible);
  if (vendibles.length === 0) return;
  vendibles.forEach((product) => cart.addItem(product, 1, ''));
  ui.nudgeCartNav();
  ui.showToast(t(vendibles.length === 1 ? 'favoritoAgregado' : 'favoritosAgregados').replace('{n}', vendibles.length));
}

// Sub-pestaña dentro de una categoría (ej. "Jugos"/"Gaseosas" dentro de
// Bebidas) — solo tiene sentido mientras se sigue viendo esa misma
// categoría, así que cambiar de categoría la reinicia (ver selectCategory).
function selectSubGroup(subGroup) {
  state.activeSubGroup = subGroup || null;
  renderMenu();
}

function selectCategory(categoryId) {
  state.activeCategoryId = categoryId;
  state.activeSubGroup = null;
  ui.renderCategoryNav(state.activeCategoryId, abrirCategoria);
  ui.renderBottomNavState(state.activeCategoryId);
  renderMenu();
  ui.toggleSheet('category-sidebar', false);
}

/* Navegación tipo app: portada de categorías → una categoría → atrás.
   Al entrar a una categoría desde la portada se apila una entrada en el
   historial, así el botón "atrás" del celular vuelve a la portada en vez
   de salir de la página. Cambiar de categoría desde la barra fija
   reemplaza esa entrada (no se acumulan "atrás"). */
function abrirCategoria(categoryId) {
  const aPortada = !categoryId || categoryId === ALL_CATEGORIES_ID;
  const desdePortada = state.activeCategoryId === ALL_CATEGORIES_ID;
  if (aPortada) {
    if (history.state?.rzCategoria) {
      history.back(); // el popstate de abajo pinta la portada
      return;
    }
    irAPortada();
    return;
  }
  if (state.searchTerm) {
    state.searchTerm = '';
    const searchInput = $('search-input');
    if (searchInput) searchInput.value = '';
    const clearBtn = $('btn-search-clear');
    if (clearBtn) clearBtn.hidden = true;
  }
  try {
    if (desdePortada && !history.state?.rzCategoria) history.pushState({ rzCategoria: true }, '');
  } catch { /* historial no disponible: la navegación sigue funcionando */ }
  selectCategory(categoryId);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function irAPortada() {
  selectCategory(ALL_CATEGORIES_ID);
  const content = $('menu-content');
  if (content) content.scrollIntoView({ behavior: 'instant', block: 'start' });
}

window.addEventListener('popstate', () => {
  if (state.activeCategoryId !== ALL_CATEGORIES_ID) irAPortada();
});

/* Exponer navegación a categorías para los banners del carrusel */
window.rodizioSelectCategory = (catId) => {
  if (!catId || catId === 'todos') {
    abrirCategoria(ALL_CATEGORIES_ID);
    return;
  } else {
    // Coincidencia exacta o parcial de id (tolera que el slug del banner
    // no calce al 100% con el de la categoría real en RTDB).
    const found =
      CATEGORIES.find((c) => c.id === catId) ||
      CATEGORIES.find((c) => c.id.includes(catId) || catId.includes(c.id));
    if (found) {
      abrirCategoria(found.id);
      return;
    } else {
      state.searchTerm = catId;
      const searchInput = $('search-input');
      if (searchInput) searchInput.value = catId;
      const clearBtn = $('btn-search-clear');
      if (clearBtn) clearBtn.hidden = false;
      renderMenu();
    }
  }
  const content = $('menu-content');
  if (content) {
    content.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

/* Mismo "pop" que ya usa el ícono de categoría al tocarlo (ui.js) —
   feedback inmediato del toque en los 4 botones de la barra inferior. */
function pulseNavIcon(btn) {
  const icon = btn && btn.querySelector('svg');
  if (!window.gsap || !icon) return;
  window.gsap.fromTo(icon, { scale: 0.7 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' });
}

/* ---------- Navegación inferior ---------- */
function bindBottomNavEvents() {
  $('nav-inicio').addEventListener('click', () => {
    pulseNavIcon($('nav-inicio'));
    handleClearSearch();
    abrirCategoria(ALL_CATEGORIES_ID);
  });

  $('nav-favoritos').addEventListener('click', () => {
    pulseNavIcon($('nav-favoritos'));
    abrirCategoria(FAVORITES_ID);
  });

  $('nav-carrito').addEventListener('click', () => {
    pulseNavIcon($('nav-carrito'));
    openCartDrawer();
  });

  $('nav-perfil').addEventListener('click', () => {
    pulseNavIcon($('nav-perfil'));
    if (state.currentUser) {
      openProfileDrawer();
    } else {
      ui.toggleSheet('auth-modal', true);
    }
  });
}

/* ---------- Header: búsqueda + cuenta ---------- */
function bindHeaderEvents() {
  const searchInput = $('search-input');
  const clearBtn = $('btn-search-clear');

  // Language toggle in header
  const headerLangBtn = $('header-lang-btn');
  if (headerLangBtn) {
    headerLangBtn.textContent = getLang() === 'es' ? 'EN' : 'ES';
    headerLangBtn.addEventListener('click', () => {
      setLang(getLang() === 'es' ? 'en' : 'es');
    });
  }

  // El logo del header lleva a "Inicio" — mismo comportamiento que el
  // botón Inicio de la barra inferior (limpia búsqueda, categoría "Todos").
  const brandHome = $('btn-brand-home');
  if (brandHome) {
    const goHome = () => {
      handleClearSearch();
      abrirCategoria(ALL_CATEGORIES_ID);
    };
    brandHome.addEventListener('click', goHome);
    brandHome.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goHome();
      }
    });
  }

  // La barra de búsqueda ya está siempre visible bajo el hero — este
  // botón solo la lleva a la vista y le pone el foco, útil si el
  // cliente ya bajó por el menú.
  $('btn-search-toggle').addEventListener('click', () => {
    $('search-bar').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (searchInput) searchInput.focus();
  });

  $('btn-category-menu').addEventListener('click', () => ui.toggleSheet('category-sidebar', true));
  $('btn-category-sidebar-close').addEventListener('click', () => ui.toggleSheet('category-sidebar', false));
  $('btn-search-cart').addEventListener('click', () => openCartDrawer());

  if (searchInput) {
    // El valor y el botón "limpiar" se actualizan al instante; lo caro
    // (reconstruir toda la grilla de productos) se retrasa un poco para
    // no repintar en cada tecla mientras el cliente todavía está escribiendo.
    const debouncedRenderMenu = debounce(renderMenu, 180);
    searchInput.addEventListener('input', (e) => {
      state.searchTerm = e.target.value;
      if (clearBtn) {
        clearBtn.hidden = !state.searchTerm.trim();
      }
      debouncedRenderMenu();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      handleClearSearch();
      if (searchInput) searchInput.focus();
    });
  }

  $('btn-account').addEventListener('click', () => {
    if (state.currentUser) {
      openProfileDrawer();
    } else {
      ui.toggleSheet('auth-modal', true);
    }
  });

  // Números fijos del restaurante (a pedido del usuario, no salen de
  // settings.restaurantPhone) — el fijo tiene dos líneas, así que en
  // vez de un solo confirmDialog se usa pickReasonDialog para que el
  // cliente elija a cuál de las dos llamar.
  const RESTAURANT_PHONE_OPTIONS = [
    { label: '(607) 596 7644', tel: '6075967644' },
    { label: '(607) 588 8080', tel: '6075888080' },
  ];
  $('btn-call-restaurant').addEventListener('click', (e) => {
    e.preventDefault();
    pickReasonDialog(
      t('aCualNumero'),
      RESTAURANT_PHONE_OPTIONS.map((opt) => opt.label),
      { cancelLabel: t('cancelar') }
    ).then((chosenLabel) => {
      const chosen = RESTAURANT_PHONE_OPTIONS.find((opt) => opt.label === chosenLabel);
      if (chosen) window.location.href = `tel:${chosen.tel}`;
    });
  });

  $('btn-whatsapp-restaurant').addEventListener('click', (e) => {
    e.preventDefault();
    confirmDialog(t('escribirWhatsapp'), {
      confirmLabel: t('abrirWhatsapp'),
      cancelLabel: t('cancelar'),
      danger: false,
    }).then((ok) => {
      if (ok) window.open(`https://wa.me/${RESTAURANT_WHATSAPP_NUMBER}`, '_blank', 'noopener,noreferrer');
    });
  });
}

window.addEventListener('rz-lang-changed', () => {
  const headerLangBtn = $('header-lang-btn');
  if (headerLangBtn) headerLangBtn.textContent = getLang() === 'es' ? 'EN' : 'ES';

  updateStaticContentFromHTML();
  // Todo lo que se arma desde JS también se repinta: antes solo el menú, y
  // el carrito, los avisos de horario/zona y los pedidos seguían en el
  // idioma anterior hasta el próximo cambio de datos.
  renderMenu();
  ui.renderCategoryNav(state.activeCategoryId, abrirCategoria);
  ui.renderCartDrawer(cart.getState(), { onQtyChange: cart.updateQty, onRemove: cart.removeItem });
  // data-i18n="tuPedido" lo acaba de pisar; en el checkout va "Datos de entrega".
  const enCheckout = !$('checkout-view').hidden;
  $('cart-drawer-title').textContent = t(enCheckout ? 'datosEntrega' : 'tuPedido');
  renderOpenStatus();
  updateZoneInfo(); // zona + totales + aviso de pedido mínimo
  if (state.currentUser) {
    renderMyOrders();
    ui.renderActiveOrderBar(lastMyOrders, openProfileDrawer);
  }
});

function updateStaticContentFromHTML() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.placeholder) el.placeholder = t(key);
    } else if (el.querySelector('svg')) {
      // Botón o etiqueta con ícono: cambiar solo el texto, nunca el SVG.
      // (Antes comparaba tagName === 'SVG', pero en HTML llega 'svg' en
      // minúsculas, así que caía en textContent y borraba el ícono.)
      const textNode = Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (textNode) textNode.textContent = ' ' + t(key) + ' ';
    } else {
      el.textContent = t(key);
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  });
}

/* ---------- Modal de producto ---------- */
function openProduct(product, isOutOfStock) {
  track('view_item', {
    currency: 'COP',
    value: product.price,
    items: [{ item_id: product.id, item_name: product.name, price: product.price }],
  });

  ui.openProductModal(product, isOutOfStock, {
    currentUser: state.currentUser,
    onAdd: (p, qty, notes) => {
      if (!cart.addItem(p, qty, notes)) return;
      ui.toggleSheet('product-modal', false);
      ui.nudgeCartNav();
      ui.showToast(t('agregadoAlCarrito').replace('{nombre}', campoIdioma(p, 'name')));
      track('add_to_cart', {
        currency: 'COP',
        value: p.price * qty,
        items: [{ item_id: p.id, item_name: p.name, price: p.price, quantity: qty }],
      });
    },
  });
}

function bindProductModalOverlay() {
  // Nota del plato en celular: el teclado tapa el pie con "Agregar". Al
  // enfocar se centra el campo en la vista, y "Listo"/Enter cierra el
  // teclado (la nota es corta; un salto de línea con Shift+Enter).
  const notas = $('modal-notes');
  notas.addEventListener('focus', () => {
    setTimeout(() => notas.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
  });
  notas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      notas.blur();
    }
  });
  $('btn-close-modal').addEventListener('click', () => ui.toggleSheet('product-modal', false));
  $('btn-close-order-detail').addEventListener('click', () => ui.toggleSheet('order-detail-modal', false));
}

/* ---------- Carrito ---------- */
function bindCartEvents() {
  $('btn-close-cart').addEventListener('click', () => closeCartDrawer());

  const floatingBar = $('floating-cart-bar');
  if (floatingBar) {
    floatingBar.addEventListener('click', () => openCartDrawer());
  }

  $('overlay').addEventListener('click', () => {
    closeCartDrawer();
    ui.toggleSheet('product-modal', false);
    ui.toggleSheet('auth-modal', false);
    ui.toggleSheet('order-detail-modal', false);
    ui.toggleSheet('category-sidebar', false);
    closeProfileDrawer();
  });

  $('btn-go-checkout').addEventListener('click', () => {
    const status = settingsApi.getScheduleStatus(state.settings);
    if (!status.isOpen) {
      ui.showToast(ui.mensajeCerrado(status.closedMessage) || t('cerradoAhora'));
      return;
    }
    if (!state.currentUser) {
      ui.toggleSheet('auth-modal', true);
      ui.showToast(t('iniciaSesionParaContinuar'));
      return;
    }
    showCheckoutStep();
  });
}

function openCartDrawer() {
  showCartStep();
  ui.toggleSheet('cart-drawer', true);
}

function closeCartDrawer() {
  ui.toggleSheet('cart-drawer', false);
  if (unsubscribeAddresses) {
    unsubscribeAddresses();
    unsubscribeAddresses = null;
  }
}

function showCartStep() {
  $('cart-drawer-title').textContent = t('tuPedido');
  $('cart-view').hidden = false;
  $('cart-footer').hidden = false;
  $('checkout-view').hidden = true;
  $('checkout-footer').hidden = true;
}

function showCheckoutStep() {
  $('cart-drawer-title').textContent = t('datosEntrega');
  $('cart-view').hidden = true;
  $('cart-footer').hidden = true;
  $('checkout-view').hidden = false;
  $('checkout-footer').hidden = false;
  state.pendingCustomerLocation = null; // checkout nuevo: no arrastrar la ubicación de un pedido anterior
  const { subtotal, items } = cart.getState();
  $('ck-adult-field').hidden = !carritoLlevaAlcohol(items);
  $('ck-adult').checked = false;
  ui.renderCheckoutTotals(subtotal, currentShippingFee());
  renderMinOrderHint(subtotal);
  setScheduleTimeMin();
  prefillLastPhone();
  updateZoneInfo();
  track('begin_checkout', {
    currency: 'COP',
    value: subtotal,
    items: items.map((i) => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.qty })),
  });

  if (unsubscribeAddresses) unsubscribeAddresses();
  unsubscribeAddresses = auth.onMyAddressesChange((addresses) => {
    savedAddresses = addresses;
    ui.renderSavedAddresses(addresses, {
      onSelect: (addr) => {
        // Las direcciones nuevas se guardan como "dirección, barrio"; las viejas
        // no traen coma y el cliente completa el barrio a mano.
        const partes = String(addr.address || '').split(', ');
        $('ck-barrio').value = partes.length > 1 ? partes.pop() : '';
        $('ck-address').value = partes.join(', ');
        $('ck-reference').value = addr.reference || '';
        $('ck-save-address').checked = false;
        updateZoneInfo();
      },
      onDelete: (addr) => auth.deleteAddress(addr.id).catch(() => {}),
    });
  });
}

/* ---------- Programar entrega ---------- */
function setScheduleTimeMin() {
  const co = nowInColombia();
  const min = new Date(co.getTime() + MIN_SCHEDULE_MINUTES * 60000);
  $('ck-schedule-time').min = `${String(min.getHours()).padStart(2, '0')}:${String(min.getMinutes()).padStart(2, '0')}`;
}

function resetScheduleMode() {
  state.scheduleMode = 'asap';
  document.querySelectorAll('#schedule-mode button').forEach((b) => b.classList.toggle('is-active', b.dataset.schedule === 'asap'));
  $('schedule-time-field').hidden = true;
  $('ck-schedule-time').value = '';
}

/* Devuelve un Date si el usuario programó una hora válida, o null
   si eligió "lo antes posible". Muestra un toast y devuelve
   `undefined` si la hora elegida no es válida todavía. */
function resolveScheduledFor() {
  if (state.scheduleMode !== 'later') return null;

  const timeValue = $('ck-schedule-time').value;
  if (!timeValue) {
    const mensaje = t('eligeHora');
    ui.showToast(mensaje);
    mostrarAyudaPedidoWhatsapp(mensaje, {}, false);
    return undefined;
  }
  const [h, m] = timeValue.split(':').map(Number);
  const co = nowInColombia();
  const scheduled = new Date(co.getTime());
  scheduled.setHours(h, m, 0, 0);
  if (scheduled.getTime() < co.getTime() + (MIN_SCHEDULE_MINUTES - 5) * 60000) {
    const mensaje = t('horaMinima').replace('{n}', MIN_SCHEDULE_MINUTES);
    ui.showToast(mensaje);
    mostrarAyudaPedidoWhatsapp(mensaje, {}, false);
    return undefined;
  }
  return scheduled;
}

/* Calcula si el negocio está abierto AHORA (horario automático, override
   manual o el interruptor clásico, ver settings.getScheduleStatus) y
   pinta los dos banners que dependen de eso. Se llama al recibir
   settings nuevos y cada 60s (ver bindGlobalEvents), porque con horario
   automático el estado puede cambiar solo con el paso del tiempo. */
function renderOpenStatus() {
  const status = settingsApi.getScheduleStatus(state.settings);
  ui.renderClosedBanner(status);
  ui.renderClosingSoonBanner(status);
  renderPausaDomicilios(status);
}

/* Domicilios pausados por el cajero o el dueño: aviso arriba, botón
   "Domicilio" del checkout apagado y el pedido pasa a "Recoger en tienda".
   El servidor (reglas-pedido.js) igual rechaza un domicilio en pausa.
   body[data-tienda] deja al CSS atenuar los "+" cuando está cerrada. */
function renderPausaDomicilios(status) {
  const pausados = status.isOpen && state.settings.domiciliosPausados === true;
  document.body.dataset.tienda = !status.isOpen ? 'cerrada' : pausados ? 'pausada' : 'abierta';
  const banner = $('domicilios-banner');
  if (banner) banner.hidden = !pausados;
  const btnDomicilio = document.querySelector('#delivery-mode [data-mode="domicilio"]');
  if (!btnDomicilio) return;
  btnDomicilio.disabled = pausados;
  btnDomicilio.title = pausados ? t('domiciliosPausadosCorto') : '';
  if (pausados && state.deliveryMode === 'domicilio') {
    document.querySelector('#delivery-mode [data-mode="recoger"]')?.click();
  }
}

/* ---------- Checkout ---------- */
/* Dirección + barrio, como se guarda en el pedido ("Calle 5 #3-4, La Riviera").
   El barrio va en su propio campo para que el cliente lo escoja a propósito y
   no dependa de que el GPS devuelva una dirección larguísima. Las coordenadas
   (si las hay) viajan aparte en customerLocation y no se muestran. */
function direccionCompleta() {
  const direccion = $('ck-address').value.trim();
  const barrio = $('ck-barrio').value.trim();
  return barrio ? (direccion ? `${direccion}, ${barrio}` : barrio) : direccion;
}

/* Domicilio siempre calculado con lo que haya configurado el
   dueño en el panel: si la dirección coincide con una zona con
   costo propio, ese costo; si no, el costo por defecto. */
function currentShippingFee() {
  if (state.deliveryMode === 'recoger') return 0;
  const zone = settingsApi.matchZone(direccionCompleta(), state.settings.coverageZones);
  if (zone) return zone.fee;
  return state.settings.defaultShippingFee ?? SHIPPING_FEE;
}

/* Se llama cada vez que cambia la dirección o el modo de entrega:
   recalcula la zona, muestra el aviso correspondiente y refresca
   el total con el costo de domicilio que corresponda. */
/* "Pago en línea" solo aparece si settings.pagoEnLinea === true — queda
   apagado hasta que la pasarela confirme pagos del lado del servidor
   (docs-fusion/PLAN-MAESTRO.md, Fase 3). Con una sola opción no tiene
   sentido mostrar el selector: se oculta entero y queda "efectivo". */
function renderPaymentModes() {
  const enLinea = state.settings.pagoEnLinea === true;
  $('payment-mode-title').hidden = !enLinea;
  $('payment-mode').hidden = !enLinea;
  if (!enLinea && state.paymentMode !== 'efectivo') {
    state.paymentMode = 'efectivo';
    document.querySelectorAll('#payment-mode button').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.payment === 'efectivo');
    });
  }
}

/* Regreso de AAvance (response_url = /?pago=<orderNumber>) o recarga
   con un pago a medio camino. El servidor consulta AAvance y, si está
   aprobado, crea el pedido. PSE puede tardar en aprobar: se reintenta
   unas veces y, si sigue pendiente, se vuelve a revisar en la próxima
   visita (el webhook de AAvance también lo confirma solo). */
let revisandoPago = false;
async function revisarRegresoDePago() {
  if (revisandoPago) return;
  const params = new URLSearchParams(location.search);
  let orderNumber = params.get('pago');
  try { orderNumber ||= localStorage.getItem(PAGO_PENDIENTE_KEY); } catch {}
  if (!orderNumber) return;
  revisandoPago = true;
  if (params.has('pago')) {
    params.delete('pago');
    history.replaceState(history.state, '', location.pathname + (params.size ? `?${params}` : '') + location.hash);
  }
  const olvidar = () => { try { localStorage.removeItem(PAGO_PENDIENTE_KEY); } catch {} };

  // El número de orden es RC + milisegundos de creación: pasado un día ya
  // no hay nada que verificar (el webhook de AAvance cubre lo que se pagó).
  if (Date.now() - Number(orderNumber.slice(2, 15)) > 24 * 60 * 60 * 1000) {
    olvidar();
    revisandoPago = false;
    return;
  }

  ui.showToast(t('verificandoPago'));
  try {
    let resultado;
    for (let intento = 0; intento < 4; intento++) {
      if (intento) await new Promise((r) => setTimeout(r, 4000));
      resultado = await auth.verificarPagoEnLinea(orderNumber);
      if (resultado.estado !== 'pendiente') break;
    }
    if (resultado.estado === 'pagado') {
      olvidar();
      cart.clearCart();
      ui.showToast(t('pagoConfirmado'));
      openProfileDrawer();
    } else if (resultado.estado === 'rechazado') {
      olvidar();
      ui.showToast(t('pagoRechazado'));
      const contactar = await confirmDialog(t('preguntarAyudaPago'), {
        confirmLabel: t('contactarPorWhatsapp'),
        cancelLabel: t('cancelar'),
        danger: false,
      });
      if (contactar) {
        const href = construirUrlAyudaPedido(t('pagoRechazado'), {
          referencia: orderNumber,
          metodoPago: t('pagoEnLinea'),
          modoEntrega: '',
        });
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    } else if (resultado.estado === 'monto_no_coincide') {
      olvidar();
      ui.showToast(t('pagoEnRevision'));
    } else if (resultado.estado === 'pendiente') {
      ui.showToast(t('pagoEnVerificacion'));
    } else {
      olvidar();
    }
  } catch (error) {
    console.error('No se pudo verificar el pago', error);
    ui.showToast(t('pagoEnVerificacion'));
  } finally {
    revisandoPago = false;
  }
}

function updateZoneInfo() {
  const zone = settingsApi.matchZone(direccionCompleta(), state.settings.coverageZones);
  ui.renderZoneInfo({
    deliveryMode: state.deliveryMode,
    zone,
    restrictToZones: state.settings.restrictToZones,
    coverageZones: state.settings.coverageZones,
  });
  const { subtotal } = cart.getState();
  ui.renderCheckoutTotals(subtotal, currentShippingFee());
  renderMinOrderHint(subtotal);
}

/* Si falta para el pedido mínimo a domicilio, sugiere el producto
   disponible más barato que alcance a cerrar la diferencia en un
   solo agregado (si ninguno alcanza solo, sugiere el disponible más
   caro — el que más acerca) en vez de dejar al cliente adivinar qué
   más pedir. */
function bestMinOrderSuggestion(missing) {
  const available = PRODUCTS.filter((p) => !state.outOfStockIds.has(p.id)).sort((a, b) => a.price - b.price);
  if (available.length === 0) return null;
  return available.find((p) => p.price >= missing) || available[available.length - 1];
}

function renderMinOrderHint(subtotal) {
  const minOrder = state.deliveryMode === 'domicilio' ? state.settings.minOrderDomicilio || 0 : 0;
  const missing = minOrder - subtotal;
  ui.renderMinOrderHint(missing > 0 ? missing : 0, missing > 0 ? bestMinOrderSuggestion(missing) : null);
}

/* Un cliente que ya pidió antes no debería tener que volver a
   escribir su teléfono cada vez — lo recordamos localmente (no es
   dato sensible como una contraseña) y lo dejamos listo, pero sin
   pisar lo que ya haya escrito en este mismo formulario. */
function prefillLastPhone() {
  const field = $('ck-phone');
  if (field.value.trim()) return;
  try {
    const saved = localStorage.getItem(LAST_PHONE_KEY);
    if (saved) field.value = saved;
  } catch {
    // localStorage no disponible: sin prellenado, no rompe el checkout.
  }
}

/* Los mensajes que arma el servidor (cerrado, agotado, precio cambiado…)
   llegan con estos códigos y ya están en español; cualquier otro error de
   las funciones ("deadline-exceeded", "internal"…) o de permisos de la
   base viene en inglés técnico y no le sirve al cliente. */
const CODIGOS_CON_MENSAJE = ['functions/failed-precondition', 'functions/aborted', 'functions/unauthenticated', 'functions/invalid-argument', 'functions/not-found', 'functions/resource-exhausted'];
function mensajeDeError(error, claveRespaldo) {
  const codigo = String(error?.code || '');
  if (codigo.startsWith('functions/') && !CODIGOS_CON_MENSAJE.includes(codigo)) return t(claveRespaldo);
  if (/permission[_ -]denied/i.test(`${codigo} ${error?.message || ''}`)) return t(claveRespaldo);
  return error?.message || t(claveRespaldo);
}

function textoWhatsappSeguro(value, maxLength = 240) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function construirUrlAyudaPedido(mensajeVisible, { referencia = '', metodoPago, modoEntrega } = {}) {
  const telefono = textoWhatsappSeguro($('ck-phone')?.value, 40);
  const productos = cart.getState().items
    .slice(0, 8)
    .map((item) => `${Number(item.qty) || 1} × ${textoWhatsappSeguro(item.name || item.id, 60)}`)
    .join(', ')
    .slice(0, 300);
  const entrega = modoEntrega ?? (state.deliveryMode === 'domicilio' ? t('domicilio') : t('recoger'));
  const pago = metodoPago ?? (state.paymentMode === 'payway' ? t('pagoEnLinea') : t('efectivo'));
  const lines = [
    t('whatsappPedidoSaludo'),
    t('whatsappPedidoError').replace('{error}', textoWhatsappSeguro(mensajeVisible)),
    telefono ? t('whatsappPedidoTelefono').replace('{phone}', telefono) : '',
    entrega ? t('whatsappPedidoEntrega').replace('{mode}', entrega) : '',
    pago ? t('whatsappPedidoPago').replace('{method}', pago) : '',
    productos ? t('whatsappPedidoProductos').replace('{items}', productos) : '',
    referencia ? t('whatsappPedidoReferencia').replace('{reference}', textoWhatsappSeguro(referencia, 40)) : '',
    t('whatsappPedidoCierre'),
  ].filter(Boolean);
  return `https://wa.me/${RESTAURANT_WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`;
}

function mostrarAyudaPedidoWhatsapp(mensajeVisible, opciones = {}, desplazar = true) {
  const panel = $('checkout-failure-help');
  const link = $('btn-checkout-whatsapp-help');
  const error = $('checkout-failure-error');
  if (!panel || !link || !error) return;

  error.textContent = textoWhatsappSeguro(mensajeVisible);
  link.href = construirUrlAyudaPedido(mensajeVisible, opciones);
  panel.hidden = false;
  link.hidden = false;
  if (desplazar) panel.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
}

function ocultarAyudaPedidoWhatsapp() {
  const panel = $('checkout-failure-help');
  const link = $('btn-checkout-whatsapp-help');
  if (panel) panel.hidden = true;
  if (link) {
    link.hidden = true;
    link.removeAttribute('href');
  }
}

function rememberPhone(phone) {
  try {
    localStorage.setItem(LAST_PHONE_KEY, phone);
  } catch {
    // localStorage no disponible: no pasa nada, solo no se recuerda.
  }
}

/* Además del toast, resalta en rojo el campo que falta y le pone
   el foco — en el celular es fácil no notar solo el mensaje flotante. */
// ¿El carrito trae alguna bebida con alcohol? Entonces el checkout pide
// confirmar la mayoría de edad (el servidor también lo exige).
function carritoLlevaAlcohol(items) {
  return items.some((i) => esAlcohol(PRODUCTS.find((p) => p.id === i.id)));
}

function markFieldError(field) {
  field.classList.add('field-error');
  field.focus();
  field.addEventListener('input', () => field.classList.remove('field-error'), { once: true });
}

function bindCheckoutEvents() {
  const modeButtons = document.querySelectorAll('#delivery-mode button');
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      modeButtons.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.deliveryMode = btn.dataset.mode;
      $('address-fields').style.display = state.deliveryMode === 'recoger' ? 'none' : 'block';
      updateZoneInfo();
    });
  });

  const paymentButtons = document.querySelectorAll('#payment-mode button');
  paymentButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      paymentButtons.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.paymentMode = btn.dataset.payment;
    });
  });

  $('ck-address').addEventListener('input', () => {
    // Si edita la dirección a mano, las coordenadas exactas que se
    // hayan capturado (por geolocalización o dirección guardada) ya
    // no corresponden con lo que escribió — se descartan.
    state.pendingCustomerLocation = null;
    updateZoneInfo();
  });

  $('ck-barrio').addEventListener('input', () => updateZoneInfo());

  $('ck-save-address').addEventListener('change', () => {
    $('ck-address-label-field').hidden = !$('ck-save-address').checked;
  });

  const scheduleButtons = document.querySelectorAll('#schedule-mode button');
  scheduleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      scheduleButtons.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.scheduleMode = btn.dataset.schedule;
      $('schedule-time-field').hidden = state.scheduleMode !== 'later';
    });
  });

  $('btn-confirm-order').addEventListener('click', handleConfirmOrder);
}

async function handleConfirmOrder() {
  const { items, subtotal } = cart.getState();
  if (items.length === 0) return;

  const status = settingsApi.getScheduleStatus(state.settings);
  if (!status.isOpen) {
    const mensaje = ui.mensajeCerrado(status.closedMessage) || t('cerradoAhora');
    ui.showToast(mensaje);
    mostrarAyudaPedidoWhatsapp(mensaje, {}, false);
    return;
  }

  let blocked;
  try {
    blocked = await auth.isCurrentUserBlocked();
  } catch (error) {
    const mensaje = mensajeDeError(error, 'noSePudoEnviar');
    ui.showToast(mensaje);
    mostrarAyudaPedidoWhatsapp(mensaje, {}, false);
    return;
  }
  if (blocked) {
    const mensaje = t('noPodemosProcesar');
    ui.showToast(mensaje);
    mostrarAyudaPedidoWhatsapp(mensaje, {}, false);
    return;
  }

  const phone = $('ck-phone').value.trim();
  const direccion = $('ck-address').value.trim();
  const barrio = $('ck-barrio').value.trim();
  const address = direccionCompleta();

  if (!phone) {
    const mensaje = t('ingresaTelefono');
    ui.showToast(mensaje);
    mostrarAyudaPedidoWhatsapp(mensaje, {}, false);
    markFieldError($('ck-phone'));
    return;
  }
  if (state.deliveryMode === 'domicilio' && !direccion) {
    const mensaje = t('ingresaDireccion');
    ui.showToast(mensaje);
    mostrarAyudaPedidoWhatsapp(mensaje, {}, false);
    markFieldError($('ck-address'));
    return;
  }
  if (state.deliveryMode === 'domicilio' && !barrio) {
    const mensaje = t('ingresaBarrio');
    ui.showToast(mensaje);
    mostrarAyudaPedidoWhatsapp(mensaje, {}, false);
    markFieldError($('ck-barrio'));
    return;
  }

  const zone = settingsApi.matchZone(address, state.settings.coverageZones);
  if (
    state.deliveryMode === 'domicilio' &&
    state.settings.restrictToZones &&
    (state.settings.coverageZones || []).length > 0 &&
    !zone
  ) {
    const mensaje = t('direccionFueraZona');
    ui.showToast(mensaje);
    mostrarAyudaPedidoWhatsapp(mensaje, {}, false);
    markFieldError($('ck-address'));
    return;
  }

  const minOrder = state.deliveryMode === 'domicilio' ? state.settings.minOrderDomicilio || 0 : 0;
  if (minOrder > 0 && subtotal < minOrder) {
    const mensaje = t('pedidoMinimoEs').replace('{monto}', formatCOP(minOrder));
    ui.showToast(mensaje);
    mostrarAyudaPedidoWhatsapp(mensaje, {}, false);
    return;
  }

  const llevaAlcohol = carritoLlevaAlcohol(items);
  if (llevaAlcohol && !$('ck-adult').checked) {
    const mensaje = t('confirmaMayorEdad');
    ui.showToast(mensaje);
    mostrarAyudaPedidoWhatsapp(mensaje, {}, false);
    $('ck-adult').focus();
    return;
  }

  const scheduledFor = resolveScheduledFor();
  if (scheduledFor === undefined) return; // hora inválida, ya se mostró el toast

  const confirmBtn = $('btn-confirm-order');
  const confirmBtnLabel = confirmBtn.textContent;
  let pedidoCreado = false;
  let referenciaPago = '';
  ocultarAyudaPedidoWhatsapp();
  confirmBtn.disabled = true;
  confirmBtn.classList.add('is-loading');
  confirmBtn.textContent = t('enviandoPedido');

  try {
    const shipping = currentShippingFee();
    const total = Math.max(0, subtotal + shipping);
    
    const orderPayload = {
      items,
      subtotal,
      shipping,
      total,
      deliveryMode: state.deliveryMode,
      address: state.deliveryMode === 'domicilio' ? address : null,
      customerLocation: state.deliveryMode === 'domicilio' ? state.pendingCustomerLocation : null,
      reference: $('ck-reference').value.trim(),
      phone,
      scheduledFor,
      mayorDeEdad: llevaAlcohol,
    };

    if (state.paymentMode === 'payway') {
      // Todos los campos (monto incluido) los arma el servidor. El
      // carrito NO se vacía aquí: si el cliente no termina de pagar, lo
      // conserva; se vacía al volver con el pago confirmado.
      const sesion = await auth.initPaymentSession(orderPayload);
      referenciaPago = sesion.orderNumber || '';
      rememberPhone(phone);
      try { localStorage.setItem(PAGO_PENDIENTE_KEY, sesion.orderNumber); } catch {}

      const form = $('payway-form');
      form.action = sesion.action;
      form.replaceChildren();
      const campos = { ...sesion.campos, response_url: `${location.origin}/?pago=${sesion.orderNumber}` };
      for (const [name, value] of Object.entries(campos)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value ?? '';
        form.append(input);
      }
      form.submit();
      return;
    }

    // Flujo normal en Efectivo — el total real lo calcula el servidor
    // (crearPedido); se usa ese, no el de pantalla, para la analítica.
    const pedido = await auth.placeOrder(orderPayload);
    pedidoCreado = true;

    track('purchase', {
      transaction_id: pedido.orderId,
      currency: 'COP',
      value: pedido.total,
      shipping: pedido.shipping,
      items: items.map((i) => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.qty })),
    });

    if (state.deliveryMode === 'domicilio' && $('ck-save-address').checked) {
      const alreadySaved = savedAddresses.some((a) => a.address === address);
      if (!alreadySaved) {
        auth
          .saveAddress({
            address,
            reference: $('ck-reference').value.trim(),
            label: $('ck-address-label').value.trim(),
          })
          .catch(() => {});
      }
    }

    rememberPhone(phone);
    state.pendingCustomerLocation = null;
    cart.clearCart();
    ocultarAyudaPedidoWhatsapp();
    resetScheduleMode();
    $('ck-save-address').checked = false;
    $('ck-barrio').value = '';
    $('ck-address-label-field').hidden = true;
    $('ck-address-label').value = '';

    // Momento de "sí funcionó de verdad": check animado en el botón
    // antes de cerrar el carrito, en vez de saltar directo al toast —
    // un envío exitoso se siente más premium con un remate visual
    // propio que confundido con cualquier otro toast de la app.
    confirmBtn.classList.remove('is-loading');
    confirmBtn.classList.add('is-success');
    confirmBtn.textContent = t('pedidoConfirmado');
    await new Promise((resolve) => setTimeout(resolve, 650));

    closeCartDrawer();
    ui.showToast(t('pedidoConfirmadoToast'));
    openProfileDrawer();
  } catch (error) {
    // "aborted" = el servidor calculó otro total (el carrito guardado
    // tenía precios viejos): se actualizan y el cliente revisa antes de
    // volver a confirmar — nunca se le cobra un total que no vio.
    if (error.code === 'functions/aborted' && error.details?.items) {
      cart.refreshPrices(error.details.items);
    }
    const mensajeVisible = mensajeDeError(error, 'noSePudoEnviar');
    if (!pedidoCreado) mostrarAyudaPedidoWhatsapp(mensajeVisible, { referencia: referenciaPago });
    ui.showToast(mensajeVisible);
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.classList.remove('is-loading', 'is-success');
    confirmBtn.textContent = confirmBtnLabel;
  }
}

/* ---------- Autenticación ---------- */
const CONSENT_KEY = 'rodizio_consent_accepted';

function bindAuthEvents() {
  $('btn-close-auth').addEventListener('click', () => ui.toggleSheet('auth-modal', false));

  // La casilla de tratamiento de datos bloquea el botón de Google
  // hasta que se marque — una vez aceptada en este dispositivo, no
  // hace falta volver a marcarla en próximos inicios de sesión.
  const consentCheckbox = $('auth-consent-checkbox');
  try {
    if (localStorage.getItem(CONSENT_KEY) === 'true') {
      consentCheckbox.checked = true;
      $('btn-google-signin').disabled = false;
    }
  } catch {
    // localStorage no disponible: simplemente pide marcarla cada vez.
  }
  consentCheckbox.addEventListener('change', (e) => {
    $('btn-google-signin').disabled = !e.target.checked;
    if (e.target.checked) {
      try {
        localStorage.setItem(CONSENT_KEY, 'true');
      } catch {
        // No pasa nada si no se puede recordar — solo pedirá marcarla de nuevo.
      }
    }
  });

  $('btn-google-signin').addEventListener('click', async () => {
    if (!consentCheckbox.checked) return; // el botón ya debería estar disabled, doble seguro
    try {
      await auth.signIn();
      auth.recordConsent('cliente');
      ui.toggleSheet('auth-modal', false);
      ui.showToast(t('sesionIniciada'));
    } catch (error) {
      ui.showToast(error.message);
    }
  });
}

/* ---------- Perfil ---------- */
function bindProfileEvents() {
  $('btn-close-profile').addEventListener('click', () => closeProfileDrawer());
  $('btn-signout').addEventListener('click', async () => {
    if (!(await confirmDialog(t('seguroCerrarSesion'), { confirmLabel: t('siCerrarSesion'), cancelLabel: t('cancelar') }))) return;
    await auth.signOutUser();
    closeProfileDrawer();
    ui.showToast(t('sesionCerrada'));
  });
  $('btn-enable-push').addEventListener('click', handleEnablePush);
}

let lastMyOrders = [];
let ordersFreshnessInterval = null;

// { orderId: status } — para notar cuándo un pedido pasa a "llegado" o
// "entregado" SIN que el cliente lo haya visto todavía (antes no había
// ninguna señal de esto fuera de abrir el perfil a mirar). El primer
// snapshot de la sesión solo llena el mapa, no dispara el aviso — si no,
// un pedido que ya estaba entregado de antes prendería el punto apenas
// se abre la app.
let lastKnownOrderStatuses = {};

function checkForStatusNotification(orders) {
  let shouldNotify = false;
  orders.forEach((o) => {
    const prev = lastKnownOrderStatuses[o.id];
    const current = o.status || 'recibido';
    if (prev !== undefined && prev !== current && (current === 'llegado' || current === 'entregado')) {
      shouldNotify = true;
    }
    lastKnownOrderStatuses[o.id] = current;
  });
  if (shouldNotify) ui.setAccountNotificationDot(true);
}

function renderMyOrders() {
  ui.renderOrdersList(lastMyOrders, {
    onRepeat: handleRepeatOrder,
    onCancel: handleCancelOrder,
    onDetail: ui.openOrderDetailModal,
  });
}

/* Suscripción a "mis pedidos" — corre TODA la sesión mientras haya
   alguien logueado (no solo mientras el drawer de perfil está
   abierto), porque la alimenta tanto el drawer como la franja de
   "pedido en curso" (#active-order-bar) que se ve desde cualquier
   pantalla. Repinta cada 30s aunque no llegue un cambio de Firebase,
   para que avisos que dependen del tiempo (GPS perdido) aparezcan
   sin depender de que llegue un dato nuevo. */
function startOrdersTracking(user) {
  if (unsubscribeOrders) {
    unsubscribeOrders();
    unsubscribeOrders = null;
  }
  if (ordersFreshnessInterval) {
    clearInterval(ordersFreshnessInterval);
    ordersFreshnessInterval = null;
  }
  if (!user) {
    lastMyOrders = [];
    ui.renderActiveOrderBar([], null);
    return;
  }
  unsubscribeOrders = auth.onMyOrdersChange((orders) => {
    lastMyOrders = orders;
    checkForStatusNotification(orders);
    renderMyOrders();
    ui.renderActiveOrderBar(orders, openProfileDrawer);
  });
  ordersFreshnessInterval = setInterval(() => {
    renderMyOrders();
    ui.renderActiveOrderBar(lastMyOrders, openProfileDrawer);
  }, 30000);
}

function openProfileDrawer() {
  ui.renderProfile(state.currentUser);
  ui.toggleSheet('profile-drawer', true);
  updatePushButtonState();
  renderMyOrders();
  ui.setAccountNotificationDot(false);
}

/* Cancelar solo lo deja el botón visible los primeros minutos
   (ver CANCEL_WINDOW_MINUTES en ui.js) — aquí solo se ejecuta. */
async function handleCancelOrder(order) {
  try {
    await auth.cancelOrder(order.id);
    ui.showToast(t('pedidoCancelado'));
  } catch (error) {
    ui.showToast(mensajeDeError(error, 'noSePudoCancelar'));
  }
}

/* ---------- Notificaciones push ---------- */
async function updatePushButtonState() {
  const btn = $('btn-enable-push');
  const label = $('btn-enable-push-label');
  const supported = await notifications.isPushSupported();

  if (!supported) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;

  const permission = notifications.getPermissionState();
  if (permission === 'granted') {
    btn.classList.add('is-enabled');
    btn.disabled = true;
    label.textContent = t('notificacionesActivadas');
  } else if (permission === 'denied') {
    btn.classList.remove('is-enabled');
    btn.disabled = true;
    label.textContent = t('notificacionesBloqueadas');
  } else {
    btn.classList.remove('is-enabled');
    btn.disabled = false;
    label.textContent = t('activarNotificaciones');
  }
}

async function handleEnablePush() {
  const btn = $('btn-enable-push');
  const label = $('btn-enable-push-label');
  btn.disabled = true;
  label.textContent = t('activando');
  try {
    await notifications.enablePushNotifications();
    ui.showToast(t('notificacionesActivadasToast'));
  } catch (error) {
    ui.showToast(error.message || t('noSeActivaronNotificaciones'));
  } finally {
    updatePushButtonState();
  }
}

function closeProfileDrawer() {
  ui.toggleSheet('profile-drawer', false);
  // La suscripción a pedidos sigue corriendo — la usa la franja de
  // "pedido en curso" aunque el drawer esté cerrado (ver
  // startOrdersTracking).
}

function handleRepeatOrder(order) {
  const orderItems = order.items || [];
  const itemsVendibles = orderItems.flatMap((item) => {
    const product = PRODUCTS.find((candidate) => candidate.id === item.id);
    return esProductoVendible(product) && cart.addItem(product, item.qty, item.notes || '') ? [item] : [];
  });
  if (itemsVendibles.length === 0) {
    ui.showToast(t('pedidoSinProductosDisponibles'));
    return;
  }
  closeProfileDrawer();
  ui.showToast(
    itemsVendibles.length === orderItems.length
      ? t('pedidoAgregadoCarrito')
      : t('pedidoParcialmenteDisponible').replace('{n}', orderItems.length - itemsVendibles.length)
  );
  openCartDrawer();
}

/* ---------- Ubicación ---------- */
/* Detecta la posición del navegador y la convierte en una
   dirección legible con la API pública de OpenStreetMap (no
   necesita clave). El cliente siempre debe revisarla antes de
   confirmar — un reverse-geocoding automático nunca es 100% exacto. */
function bindGeolocation() {
  $('btn-use-location').addEventListener('click', handleUseLocation);
}

/* "Usar mi ubicación": rellena la dirección CORTA y el barrio (editables) y
   guarda las coordenadas aparte, sin mostrarlas. Antes se copiaba el
   display_name completo de Nominatim (calle, barrio, comuna, ciudad,
   departamento, código postal, país…), por eso salían direcciones
   larguísimas. Si no hay ubicación (común en computador) o falla la
   consulta, el pedido sigue igual: el cliente escribe dirección y barrio. */
const GEOLOC_TIMEOUT_MS = 8000;

function direccionCortaDe(data) {
  const a = data?.address || {};
  const calle = a.road || a.pedestrian || a.footway || a.path || '';
  const numero = a.house_number || '';
  const barrio = a.neighbourhood || a.suburb || a.quarter || a.city_district || '';
  const direccion = [calle, numero].filter(Boolean).join(' ').trim();
  return { direccion, barrio };
}

function handleUseLocation() {
  const btn = $('btn-use-location');
  if (!navigator.geolocation) {
    ui.showToast(t('ubicacionNoDisponible'));
    return;
  }
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const control = new AbortController();
      const corte = setTimeout(() => control.abort(), GEOLOC_TIMEOUT_MS);
      try {
        const { latitude, longitude } = position.coords;
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=es&lat=${latitude}&lon=${longitude}`,
          { signal: control.signal }
        );
        if (!response.ok) throw new Error('No se pudo consultar la dirección');
        const { direccion, barrio } = direccionCortaDe(await response.json());
        if (direccion || barrio) {
          if (direccion) $('ck-address').value = direccion;
          if (barrio) $('ck-barrio').value = barrio;
          // Coordenadas aparte (no se muestran): el domiciliario navega
          // al punto exacto y el mensaje de WhatsApp lleva el enlace de Maps.
          state.pendingCustomerLocation = { lat: latitude, lng: longitude };
          updateZoneInfo();
          ui.showToast(t('direccionDetectada'));
        } else {
          // Aun sin texto de dirección, el punto sirve al domiciliario.
          state.pendingCustomerLocation = { lat: latitude, lng: longitude };
          ui.showToast(t('direccionNoExacta'));
        }
      } catch {
        // La consulta del texto falló (red, tiempo), pero el GPS sí funcionó:
        // se conserva el punto y el cliente escribe la dirección y el barrio.
        state.pendingCustomerLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
        ui.showToast(t('direccionNoObtenida'));
      } finally {
        clearTimeout(corte);
        btn.disabled = false;
      }
    },
    (error) => {
      // 1 = permiso denegado; el resto (sin señal, tiempo agotado) es común en computador.
      ui.showToast(error && error.code === 1 ? t('ubicacionSinPermiso') : t('ubicacionNoDisponible'));
      btn.disabled = false;
    },
    { timeout: GEOLOC_TIMEOUT_MS }
  );
}

/* ---------- PWA: service worker + splash ---------- */
function registerServiceWorker() {
  // En localhost (entorno de pruebas con emuladores) no: serviría CSS/JS
  // viejos de su caché mientras se edita. Ver scripts/entorno-local.mjs.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    navigator.serviceWorker?.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    return;
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('No se pudo registrar el service worker:', err);
      });
    });
  }
}

/* El splash se quita cuando termina de cargar la página O a los 2,5 s, lo
   que llegue primero: el evento "load" espera hasta la última imagen y
   los scripts de terceros (Google, reCAPTCHA), que en celular con señal
   lenta pueden tardar mucho más que lo que el cliente necesita ver.
   Antes, además, si "load" ya había pasado cuando este módulo corría, el
   splash no se quitaba nunca. */
function hideSplashWhenReady() {
  let hecho = false;
  const ocultar = () => {
    if (hecho) return;
    hecho = true;
    setTimeout(() => $('splash')?.classList.add('is-hidden'), 300);
  };
  if (document.readyState === 'complete') ocultar();
  window.addEventListener('load', ocultar);
  setTimeout(ocultar, 2500);
}

init();
