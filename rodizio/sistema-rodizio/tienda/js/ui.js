/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   UI — funciones puras de renderizado
   =========================================================
   Este módulo solo lee estado y pinta HTML. No conoce
   Firebase ni el carrito directamente: recibe todo por
   parámetros desde app.js, que es quien orquesta.
   ========================================================= */

import { CATEGORIES, PRODUCTS, formatCOP, fmtHoraCO, normalizeText, debounce, urlFoto } from './data.js';
import { t, campoIdioma, getLang } from './i18n.js';
import { esAlcohol, esProductoVendible } from './reglas-pedido.js';

const $ = (id) => document.getElementById(id);

/* Nombre de una línea del carrito o de un pedido en el idioma actual. Esas
   líneas guardan una copia del nombre en español (es lo que viaja a cocina
   y al panel, no se toca); para MOSTRARLAS se busca el producto vivo por id
   y, si ya no existe en el menú, se usa la copia guardada. */
function nombreDeItem(item) {
  const p = PRODUCTS.find((x) => x.id === item.id);
  return p ? campoIdioma(p, 'name') : item.name || '';
}

/* Estado del pedido en el idioma actual (estado_<id> en i18n.js). Se llama
   al mostrar: ORDER_STEPS se arma una sola vez al cargar el módulo y un t()
   ahí quedaría fijo en el idioma inicial. */
function etiquetaEstado(id) {
  const texto = t('estado_' + id);
  return texto === 'estado_' + id ? id : texto;
}

/* Recuadro de un producto sin foto: el ícono de su categoría en vez de un
   <img src=""> roto. */
function fotoOIcono(product, alt) {
  if (product.image) {
    return `<img src="${escapeHtml(urlFoto(product.image))}" alt="${escapeHtml(alt)}" loading="lazy" onload="this.classList.add('is-loaded')" onerror="this.style.visibility='hidden'" />`;
  }
  const cat = CATEGORIES.find((c) => c.id === product.categoryId);
  return `<span class="thumb-sin-foto" aria-hidden="true">${window.RodizioIconos?.iconoCategoria(product.categoryId, cat?.name || '', '', 28) ?? ''}</span>`;
}

export const FAVORITES_ID = '__favoritos__';
export const ALL_CATEGORIES_ID = '__todos__';

/* Normalización de texto para búsqueda: sin acentos, minúsculas, espacios limpios */
const normalizeSearchTerm = normalizeText;

/* Diccionario semántico de categorías y términos clave */
const BEVERAGE_KEYWORDS = new Set([
  'bebida', 'bebidas', 'tomar', 'trago', 'tragos', 'refresco', 'refrescos',
  'gaseosa', 'gaseosas', 'jugo', 'jugos', 'agua', 'aguas', 'cerveza', 'cervezas',
  'vino', 'vinos', 'coctel', 'cocteles', 'cocktail', 'cocktails', 'licor', 'licores',
  'pola', 'polas', 'birra', 'birras', 'champagne', 'champagnes', 'mocktail', 'mocktails',
  'frappe', 'frappes', 'limonada', 'limonadas'
]);

const MEAT_KEYWORDS = new Set([
  'carne', 'carnes', 'corte', 'cortes', 'res', 'bife', 'asado', 'asados',
  'parrilla', 'churrasco', 'churrasqueria', 'picanha', 'baby', 'angus', 'steak'
]);

const DESSERT_KEYWORDS = new Set([
  'postre', 'postres', 'dulce', 'dulces', 'flan', 'torta', 'helado', 'brigadeiro'
]);

const APPETIZER_KEYWORDS = new Set([
  'entrada', 'entradas', 'abrebocas', 'compartir', 'picar', 'aperitivo', 'aperitivos'
]);

function isBeverageCategory(cat) {
  const id = (cat.id || '').toLowerCase();
  const name = (cat.name || '').toLowerCase();
  return (
    id === 'bebidas' ||
    id.includes('cerveza') ||
    id.includes('vino') ||
    id.includes('coctel') ||
    id.includes('licor') ||
    id.includes('mocktail') ||
    id.includes('champagne') ||
    name.includes('bebida') ||
    name.includes('cerveza') ||
    name.includes('vino') ||
    name.includes('coctel') ||
    name.includes('licor')
  );
}

function isMeatCategory(cat) {
  const id = (cat.id || '').toLowerCase();
  const name = (cat.name || '').toLowerCase();
  return (
    id === 'cortes' ||
    id === 'de-la-parrilla' ||
    id === 'angus-beef' ||
    id === 'burger-angus' ||
    id === 'de-la-casa' ||
    name.includes('corte') ||
    name.includes('parrilla') ||
    name.includes('angus') ||
    name.includes('carne') ||
    name.includes('res')
  );
}

function categoryMatchesSearch(cat, normTerm) {
  const normCatName = normalizeSearchTerm(cat.name);
  const normCatId = normalizeSearchTerm(cat.id);
  const stemTerm = normTerm.replace(/(es|s)$/, '');
  const stemCat = normCatName.replace(/(es|s)$/, '');

  if (normCatName.includes(normTerm) || normTerm.includes(normCatName)) return true;
  if (normCatId.includes(normTerm) || normTerm.includes(normCatId)) return true;
  if (stemTerm.length >= 3 && (normCatName.includes(stemTerm) || stemCat.includes(stemTerm) || stemTerm.includes(stemCat))) {
    return true;
  }

  if (BEVERAGE_KEYWORDS.has(normTerm) || BEVERAGE_KEYWORDS.has(stemTerm)) {
    if (isBeverageCategory(cat)) return true;
  }

  if (MEAT_KEYWORDS.has(normTerm) || MEAT_KEYWORDS.has(stemTerm)) {
    if (isMeatCategory(cat)) return true;
  }

  if (DESSERT_KEYWORDS.has(normTerm) || DESSERT_KEYWORDS.has(stemTerm)) {
    if (cat.id === 'postres' || normCatName.includes('postre')) return true;
  }

  if (APPETIZER_KEYWORDS.has(normTerm) || APPETIZER_KEYWORDS.has(stemTerm)) {
    if (cat.id === 'entradas' || cat.id === 'para-compartir' || normCatName.includes('entrada')) return true;
  }

  return false;
}

// Evita renormalizar nombre/descripción/insignia de cada producto en
// cada tecla del buscador — el texto normalizado no cambia mientras el
// objeto del producto siga siendo el mismo (misma carga de Firebase).
const searchTextCache = new WeakMap();
function getSearchText(p) {
  let cached = searchTextCache.get(p);
  if (!cached) {
    // Busca en los dos idiomas: un turista puede escribir "steak" aunque la
    // tienda esté en español, y al revés.
    cached = {
      name: normalizeSearchTerm(`${p.name} ${p.nameEn || ''}`),
      desc: normalizeSearchTerm(`${p.description || ''} ${p.descriptionEn || ''}`),
      badge: normalizeSearchTerm(p.badge || ''),
    };
    searchTextCache.set(p, cached);
  }
  return cached;
}

function productMatchesSearch(p, normTerm, catMatches) {
  if (catMatches) return true;

  const { name: normName, desc: normDesc, badge: normBadge } = getSearchText(p);

  const words = normTerm.split(/\s+/).filter(Boolean);
  return words.every((w) => {
    const stemW = w.replace(/(es|s)$/, '');
    return (
      normName.includes(w) ||
      normDesc.includes(w) ||
      normBadge.includes(w) ||
      (stemW.length >= 3 && (normName.includes(stemW) || normDesc.includes(stemW)))
    );
  });
}

/* =========================================================
   ORDEN CANÓNICO Y JERARQUÍA GASTRONÓMICA DE CATEGORÍAS
   Flujo culinario óptimo:
   1. Entradas (cremas, sopas, ensaladas)
   2. Para Compartir (piqueos, tablas, tostones)
   3. De la Parrilla (cortes clásicos, picanha, asados)
   4. Angus Beef (cortes importados premium Angus)
   5. Burger Angus (hamburguesas artesanales)
   6. De la Casa (especialidades insignia)
   7. Cortes / Aves / Cerdo / Embutidos
   8. Del Mar (pescados y mariscos)
   9. Menú Infantil
   10. Acompañamientos
   11. Postres
   12. Bebidas (refrescos, jugos, gaseosas)
   13. Cervezas 3 Cordilleras
   14. Mocktails
   15. Cocteles
   16. Licores
   17. Vinos
   18. Champagnes
   ========================================================= */
export const CANONICAL_CATEGORY_ORDER = [
  'entradas',
  'para-compartir',
  'de-la-parrilla',
  'angus-beef',
  'burger-angus',
  'de-la-casa',
  'rodizio-casero',
  'cortes',
  'aves',
  'cerdo',
  'embutidos',
  'del-mar',
  'menu-infantil',
  'acompanamientos',
  'postres',
  'bebidas',
  'cervezas-3-cordilleras',
  'mocktails',
  'cocteles',
  'vinos',
  'champagnes',
];

export function sortCategories(cats) {
  if (!Array.isArray(cats)) return [];
  const getRank = (c) => {
    const id = normalizeSearchTerm(c.id || '');
    const name = normalizeSearchTerm(c.name || '');
    const exact = CANONICAL_CATEGORY_ORDER.indexOf(id);
    if (exact >= 0) return exact;
    const byName = CANONICAL_CATEGORY_ORDER.findIndex((k) => name.includes(k) || id.includes(k));
    if (byName >= 0) return byName;
    return 100 + (c.order != null ? c.order : 50);
  };
  return cats.slice().sort((a, b) => {
    const rA = getRank(a);
    const rB = getRank(b);
    if (rA !== rB) return rA - rB;
    return (a.order || 0) - (b.order || 0);
  });
}

// Íconos Lucide compartidos con la carta del QR de mesa: las reglas y los
// trazos viven en shared/iconos-categoria.js (acá llega como la copia
// js/iconos-categoria.js, cargada como script clásico en index.html).
// ALL_CATEGORIES_ID/FAVORITES_ID ("__todos__"/"__favoritos__") los
// reconoce la función compartida al normalizar.
export function getCategoryIcon(catId, catName) {
  return window.RodizioIconos?.iconoCategoria(catId, catName, 'cat-tab-icon', 14) ?? '';
}

/* --- Categorías con opción "Todos", orden gastronómico óptimo y scroll centrado --- */
export function renderCategoryNav(activeId, onSelect) {
  const nav = $('category-nav');
  if (!nav) return;
  nav.innerHTML = '';

  const sortedCategories = sortCategories(CATEGORIES);

  // Píldora "Todos" al principio
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'category-tab' + (activeId === ALL_CATEGORIES_ID || !activeId ? ' is-active' : '');
  allBtn.innerHTML = `${getCategoryIcon(ALL_CATEGORIES_ID, 'Todos')}<span>${escapeHtml(t('todos'))}</span>`;
  allBtn.addEventListener('click', () => {
    onSelect(ALL_CATEGORIES_ID);
    pulseCategoryIcon(allBtn);
    allBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });
  nav.appendChild(allBtn);

  sortedCategories.forEach((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'category-tab' + (cat.id === activeId ? ' is-active' : '');
    // El ícono se elige por el nombre en español (las reglas de
    // iconos-categoria.js están en español); lo que se muestra va traducido.
    btn.innerHTML = `${getCategoryIcon(cat.id, cat.name)}<span>${escapeHtml(campoIdioma(cat, 'name'))}</span>`;
    btn.addEventListener('click', () => {
      onSelect(cat.id);
      pulseCategoryIcon(btn);
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
    nav.appendChild(btn);
  });
}

/* --- Portada por categorías (estilo app de comida rápida) ---
   En el celular, tirar los ~110 productos en una sola lista hacía que el
   cliente tuviera que bajar sin rumbo. La portada ahora muestra tarjetas
   grandes de categoría (foto + ícono + cuántas opciones) separadas en
   "Para comer" y "Para tomar"; al tocar una se entra a esa categoría sola,
   con la barra de categorías fija arriba para saltar entre ellas. */

// La categoría estrella va en una tarjeta ancha al principio.
const CATEGORIA_ESTRELLA = 'de-la-parrilla';

function productosVisibles(catId) {
  return PRODUCTS.filter((p) => p.categoryId === catId && !p.hidden);
}

/* Foto que representa la categoría: un producto con insignia si hay
   (lo que el restaurante quiere mostrar), si no el primero con foto. */
function fotoDeCategoria(catId) {
  const conFoto = productosVisibles(catId).filter((p) => p.image);
  return urlFoto((conFoto.find((p) => p.badge) || conFoto[0])?.image || '');
}

function iconoCategoriaGrande(cat, px) {
  return window.RodizioIconos?.iconoCategoria(cat.id, cat.name, '', px) ?? '';
}

function tarjetaCategoria(cat, estrella) {
  const n = productosVisibles(cat.id).length;
  const foto = fotoDeCategoria(cat.id);
  const nombre = campoIdioma(cat, 'name');
  return `
    <button type="button" class="cat-tile${estrella ? ' cat-tile-estrella' : ''}${foto ? '' : ' sin-foto'}" data-cat-id="${escapeHtml(cat.id)}">
      ${foto ? `<img class="cat-tile-foto" src="${escapeHtml(foto)}" alt="" loading="lazy" onload="this.classList.add('is-loaded')" onerror="this.remove()" />` : ''}
      <span class="cat-tile-velo" aria-hidden="true"></span>
      <span class="cat-tile-icono" aria-hidden="true">${iconoCategoriaGrande(cat, 18)}</span>
      ${estrella ? `<span class="cat-tile-sello">${escapeHtml(t('especialidadCasa'))}</span>` : ''}
      <span class="cat-tile-texto">
        <span class="cat-tile-nombre">${escapeHtml(nombre)}</span>
        <span class="cat-tile-cuenta">${escapeHtml(t('nOpciones').replace('{n}', n))}</span>
      </span>
      <span class="cat-tile-flecha" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>
    </button>`;
}

function renderCategoryHome(main, onSelectCategory) {
  const conProductos = sortCategories(CATEGORIES).filter((c) => productosVisibles(c.id).length > 0);
  const comer = conProductos.filter((c) => !isBeverageCategory(c));
  const tomar = conProductos.filter((c) => isBeverageCategory(c));
  // La estrella primero dentro de "Para comer", sin alterar el resto del orden.
  comer.sort((a, b) => (b.id === CATEGORIA_ESTRELLA) - (a.id === CATEGORIA_ESTRELLA));

  const grupo = (titulo, cats) => cats.length === 0 ? '' : `
    <div class="cat-home-grupo">
      <h3 class="cat-home-grupo-titulo">${escapeHtml(titulo)}</h3>
      <div class="cat-home-grid">
        ${cats.map((c) => tarjetaCategoria(c, c.id === CATEGORIA_ESTRELLA)).join('')}
      </div>
    </div>`;

  // Primera visita sin menú guardado: tarjetas "cargando" en vez del menú de
  // fábrica de data.js (ver arrancarConCatalogoGuardado en app.js).
  const cargando = document.body.dataset.catalogo === 'cargando' && conProductos.length === 0;
  const errorCarga = document.body.dataset.catalogo === 'error' && conProductos.length === 0;
  const mensajeError = `
    <div class="cat-home-error" role="alert">
      <p>${escapeHtml(t('menuNoCargo'))}</p>
      <button type="button" class="btn btn-primary" data-reintentar-menu>${escapeHtml(t('reintentar'))}</button>
    </div>`;
  const esqueleto = `
    <div class="cat-home-grupo" aria-busy="true">
      <div class="cat-home-grid">
        ${Array.from({ length: 6 }, (_, i) => `<span class="cat-tile cat-tile-cargando${i === 0 ? ' cat-tile-estrella' : ''}" aria-hidden="true"></span>`).join('')}
      </div>
    </div>`;

  const section = document.createElement('section');
  section.className = 'cat-home';
  section.innerHTML = `
    <div class="cat-home-cabecera">
      <h2>${escapeHtml(t('queSeTeAntoja'))}</h2>
      <p>${escapeHtml(t('eligeCategoria'))}</p>
    </div>
    ${errorCarga ? mensajeError : cargando ? esqueleto : `${grupo(t('paraComer'), comer)}${grupo(t('paraTomar'), tomar)}`}`;
  section.querySelector('[data-reintentar-menu]')?.addEventListener('click', () => location.reload());
  section.querySelectorAll('.cat-tile').forEach((btn, i) => {
    btn.style.setProperty('--i', i);
    btn.addEventListener('click', () => onSelectCategory?.(btn.dataset.catId));
  });
  main.appendChild(section);
}

/* Barra fija de categorías (vive dentro de .search-row, que ya es sticky):
   solo se muestra fuera de la portada. El primer botón vuelve al menú. */
export function renderCategoryStrip(activeId, onSelect) {
  const strip = $('category-strip');
  if (!strip) return;
  const enPortada = !activeId || activeId === ALL_CATEGORIES_ID;
  strip.hidden = enPortada;
  if (enPortada) {
    strip.innerHTML = '';
    return;
  }
  const cats = sortCategories(CATEGORIES).filter((c) => productosVisibles(c.id).length > 0);
  strip.innerHTML =
    `<button type="button" class="strip-chip strip-chip-menu" data-cat-id="${ALL_CATEGORIES_ID}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg><span>${escapeHtml(t('menu'))}</span></button>` +
    cats.map((c) => `<button type="button" class="strip-chip${c.id === activeId ? ' is-active' : ''}" data-cat-id="${escapeHtml(c.id)}">${iconoCategoriaGrande(c, 15)}<span>${escapeHtml(campoIdioma(c, 'name'))}</span></button>`).join('');
  strip.querySelectorAll('.strip-chip').forEach((b) => b.addEventListener('click', () => onSelect(b.dataset.catId)));
  const activo = strip.querySelector('.strip-chip.is-active');
  // Centrar la categoría activa sin mover la página (solo el carril).
  if (activo) strip.scrollLeft = activo.offsetLeft - (strip.clientWidth - activo.offsetWidth) / 2;
}

/* Pequeño "pop" en el ícono al tocar una categoría — el estado activo ya
   lo marca el CSS (.category-tab.is-active), esto es solo el feedback
   inmediato del toque, igual que el nudge del carrito en app.js. */
function pulseCategoryIcon(btn) {
  const icon = btn.querySelector('.cat-tab-icon');
  if (!window.gsap || !icon) return;
  window.gsap.fromTo(icon, { scale: 0.6, rotate: -8 }, { scale: 1, rotate: 0, duration: 0.4, ease: 'back.out(3)' });
}

/* Resalta "Inicio" o "Favoritos" en la barra inferior según la vista actual del menú */
export function renderBottomNavState(activeCategoryId) {
  const navInicio = $('nav-inicio');
  const navFavs = $('nav-favoritos');
  if (navInicio) navInicio.classList.toggle('is-active', activeCategoryId !== FAVORITES_ID);
  if (navFavs) navFavs.classList.toggle('is-active', activeCategoryId === FAVORITES_ID);
}

/* Sub-menú dentro de una categoría — hoy solo "Bebidas" trae productos
   con `subGroup` (ver shared/menu.js), pensado para no tirar sus ~24
   productos en una sola lista larga. Orden fijo (no alfabético) para
   que siempre aparezcan en el mismo orden sin importar cuántos
   productos tenga cada grupo. */
// [español, inglés]: se elige al mostrar (getLang), no al cargar el módulo.
const SUBGROUP_LABELS = {
  'jugos-limonadas': ['Jugos y Limonadas', 'Juices & Lemonades'],
  frappes: ['Frappes', 'Frappés'],
  gaseosas: ['Gaseosas', 'Sodas'],
  aguas: ['Aguas', 'Water'],
  cervezas: ['Cervezas', 'Beer'],
  'sodas-tes-importados': ['Sodas y Tés Importados', 'Imported Sodas & Teas'],
  energizantes: ['Energizantes', 'Energy Drinks'],
};
const etiquetaSubgrupo = (g) => (SUBGROUP_LABELS[g] || [g, g])[getLang() === 'en' ? 1 : 0];
const SUBGROUP_ORDER = Object.keys(SUBGROUP_LABELS);

function presentSubGroups(products) {
  const present = new Set(products.map((p) => p.subGroup).filter(Boolean));
  return SUBGROUP_ORDER.filter((g) => present.has(g));
}

function renderSubGroupNav(main, subGroups, activeSubGroup, onSelectSubGroup) {
  const nav = document.createElement('div');
  nav.className = 'subgroup-nav';
  nav.innerHTML =
    `<button type="button" class="subgroup-tab${!activeSubGroup ? ' is-active' : ''}" data-subgroup="">${escapeHtml(t('todos'))}</button>` +
    subGroups
      .map(
        (g) =>
          `<button type="button" class="subgroup-tab${activeSubGroup === g ? ' is-active' : ''}" data-subgroup="${g}">${escapeHtml(etiquetaSubgrupo(g))}</button>`
      )
      .join('');
  nav.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (typeof onSelectSubGroup === 'function') onSelectSubGroup(btn.dataset.subgroup || null);
    });
  });
  main.appendChild(nav);
}

/* --- Grilla de productos con búsqueda inteligente y botón de agregar rápido --- */
export function renderMenu({
  activeCategoryId,
  activeSubGroup,
  searchTerm,
  favoriteIds,
  outOfStockIds,
  onOpenProduct,
  onQuickAdd,
  onToggleFavorite,
  onAddAllFavorites,
  onClearSearch,
  onSelectSubGroup,
  onSelectCategory,
}) {
  const main = $('menu-content');
  if (!main) return;
  main.innerHTML = '';

  const rawTerm = (searchTerm || '').trim();
  const normTerm = normalizeSearchTerm(rawTerm);

  // Qué "pantalla" se ve: el CSS esconde el carrusel y los destacados
  // fuera de la portada (body[data-vista]).
  const enPortada = !activeCategoryId || activeCategoryId === ALL_CATEGORIES_ID;
  document.body.dataset.vista = normTerm ? 'busqueda' : enPortada ? 'inicio' : 'categoria';
  if (!normTerm && enPortada) {
    renderCategoryHome(main, onSelectCategory);
    return;
  }
  const favorites = favoriteIds || new Set();
  const outOfStock = outOfStockIds || new Set();

  let cardIndex = 0;

  // sinTitulo: en la vista de una categoría ya lo dice la cabecera con foto.
  function buildSection(title, products, countLabel, sinTitulo = false) {
    const section = document.createElement('section');
    section.className = 'menu-section';
    section.innerHTML = `
      ${sinTitulo ? '' : `<div class="menu-section-title">
        <h2>${escapeHtml(title)}</h2>
        <span>${escapeHtml(countLabel)}</span>
      </div>`}
      <div class="product-grid"></div>
    `;
    const grid = section.querySelector('.product-grid');

    products.forEach((product) => {
      const isSellable = esProductoVendible(product);
      const isFav = isSellable && favorites.has(product.id);
      const isOut = isSellable && outOfStock.has(product.id);
      const card = document.createElement('div');
      card.className = 'product-card' + (isOut ? ' is-out-of-stock' : '') + (!isSellable ? ' is-showcase-only' : '');
      card.style.setProperty('--i', cardIndex);
      cardIndex += 1;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      const nombre = campoIdioma(product, 'name');
      card.innerHTML = `
        <div class="product-thumb">
          ${fotoOIcono(product, nombre)}
          ${isSellable ? `<button type="button" class="fav-toggle${isFav ? ' is-active' : ''}" aria-label="${escapeHtml(t(isFav ? 'quitarFavoritos' : 'agregarFavoritos'))}" aria-pressed="${isFav}">
            ${heartSvg(isFav)}
          </button>` : ''}
        </div>
        <div class="product-info">
          ${isOut ? `<span class="product-badge product-badge-out">${escapeHtml(t('agotado'))}</span><br/>` : product.badge ? `<span class="product-badge">${escapeHtml(product.badge)}</span><br/>` : ''}
          <div class="product-name">${escapeHtml(nombre)}</div>
          <div class="product-desc">${escapeHtml(campoIdioma(product, 'description'))}</div>
          <div class="product-footer">
            <span class="price">${formatCOP(product.price)}</span>
          </div>
        </div>
        ${isSellable ? `<button type="button" class="add-btn" aria-label="${escapeHtml(t('agregarAlPedido').replace('{nombre}', nombre))}" ${isOut ? 'disabled hidden' : ''}>+</button>` : ''}
      `;

      // Click en la tarjeta abre el modal de detalle con opciones/notas
      card.addEventListener('click', () => onOpenProduct(product, isOut));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenProduct(product, isOut);
        }
      });

      // Botón de favoritos — pop inmediato al tocar (antes de que el
      // re-render redibuje la tarjeta con el corazón lleno/vacío).
      const favBtn = card.querySelector('.fav-toggle');
      if (favBtn) {
        favBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.gsap) {
            window.gsap.fromTo(
              favBtn,
              { scale: 1 },
              { scale: 1.35, duration: 0.16, ease: 'power1.out', yoyo: true, repeat: 1 }
            );
          }
          if (!isSellable) return;
          onToggleFavorite(product.id, product);
        });
      }

      // Botón "+" agrega directamente 1 unidad con micro-animación
      const addBtn = card.querySelector('.add-btn');
      if (addBtn) {
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!isSellable || isOut) return;
          if (typeof onQuickAdd === 'function') {
            onQuickAdd(product, addBtn);
          } else {
            onOpenProduct(product, isOut);
          }
        });
      }

      grid.appendChild(card);
    });

    main.appendChild(section);
  }

  // Vista de Favoritos
  if (!normTerm && activeCategoryId === FAVORITES_ID) {
    const products = PRODUCTS.filter((p) => favorites.has(p.id) && !p.hidden && esProductoVendible(p));
    if (products.length === 0) {
      main.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
          </div>
          <h3>Aún no tienes favoritos</h3>
          <p>Toca el corazón en cualquier corte o bebida para tenerlos siempre a mano.</p>
        </div>
      `;
      return;
    }
    const availableProducts = products.filter((p) => esProductoVendible(p) && !outOfStock.has(p.id));
    if (onAddAllFavorites && availableProducts.length > 0) {
      const bar = document.createElement('div');
      bar.className = 'add-all-favorites-bar';
      bar.innerHTML = `<button type="button" class="btn btn-ghost" id="btn-add-all-favorites">${escapeHtml(t('agregarTodosFavoritos').replace('{n}', availableProducts.length))}</button>`;
      main.appendChild(bar);
      bar.querySelector('button').addEventListener('click', () => onAddAllFavorites(availableProducts));
    }
    buildSection(t('favoritos'), products, t('nGuardados').replace('{n}', products.length));
    return;
  }

  // Selección de categorías a evaluar:
  // Si hay término de búsqueda o se eligió "Todos", evaluamos todas las categorías del menú.
  // De lo contrario, solo la categoría activa.
  const sortedCategories = sortCategories(CATEGORIES);
  const categoriesToShow = (normTerm || activeCategoryId === ALL_CATEGORIES_ID || !activeCategoryId)
    ? sortedCategories
    : sortedCategories.filter((c) => c.id === activeCategoryId);

  let totalMatches = 0;

  categoriesToShow.forEach((cat) => {
    const catMatches = normTerm ? categoryMatchesSearch(cat, normTerm) : false;
    // !p.hidden: producto ocultado del marketplace desde el panel
    // (Inventario → "Ocultar") — distinto de agotado, ver admin.js.
    let products = PRODUCTS.filter((p) => p.categoryId === cat.id && !p.hidden);

    // Sub-menú dentro de la categoría (ej. "Jugos"/"Gaseosas"/"Cervezas"
    // dentro de Bebidas) — solo tiene sentido al ver ESA categoría sola,
    // no buscando ni en "Todos" (ahí saldrían varias filas mezcladas).
    const isSingleCategoryView = !normTerm && activeCategoryId === cat.id;
    if (isSingleCategoryView) {
      const foto = fotoDeCategoria(cat.id);
      const cabecera = document.createElement('header');
      cabecera.className = 'cat-cabecera' + (foto ? '' : ' sin-foto');
      cabecera.innerHTML = `
        ${foto ? `<img class="cat-cabecera-foto" src="${escapeHtml(fotoHd(foto))}" alt="" onload="this.classList.add('is-loaded')" onerror="this.remove()" />` : ''}
        <span class="cat-tile-velo" aria-hidden="true"></span>
        <div class="cat-cabecera-texto">
          <span class="cat-tile-icono" aria-hidden="true">${iconoCategoriaGrande(cat, 18)}</span>
          <h2>${escapeHtml(campoIdioma(cat, 'name'))}</h2>
          <span class="cat-tile-cuenta">${escapeHtml(t('nOpciones').replace('{n}', products.length))}</span>
        </div>`;
      main.appendChild(cabecera);
      const subGroups = presentSubGroups(products);
      if (subGroups.length > 1) {
        renderSubGroupNav(main, subGroups, activeSubGroup, onSelectSubGroup);
        if (activeSubGroup) {
          products = products.filter((p) => p.subGroup === activeSubGroup);
        }
      }
    }

    if (normTerm) {
      products = products.filter((p) => productMatchesSearch(p, normTerm, catMatches));
    }

    if (products.length === 0) return;
    totalMatches += products.length;
    buildSection(campoIdioma(cat, 'name'), products, t('nOpciones').replace('{n}', products.length), isSingleCategoryView);
  });

  if (normTerm && totalMatches === 0) {
    main.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/><path d="M8 11h6" stroke-linecap="round"/></svg>
        </div>
        <h3>Sin resultados para "${escapeHtml(rawTerm)}"</h3>
        <p>No encontramos platos ni bebidas con ese término. Prueba buscando "bebidas", "picanha", "cortes" o "postres".</p>
        <button type="button" class="btn btn-primary btn-clear-search" id="btn-empty-clear-search">Ver todo el menú</button>
      </div>
    `;
    const clearBtn = $('btn-empty-clear-search');
    if (clearBtn && typeof onClearSearch === 'function') {
      clearBtn.addEventListener('click', () => onClearSearch());
    }
  }
}

/* --- "Lo más pedido": carrusel con los productos que el panel marcó
   con una insignia (ej. "Más pedido") — nunca inventa destacados, si
   nadie tiene insignia la sección completa se oculta. */
export function renderFeaturedCarousel({ outOfStockIds, onOpenProduct }) {
  const section = $('featured-section');
  const scroll = $('featured-scroll');
  const outOfStock = outOfStockIds || new Set();
  const featured = PRODUCTS.filter((p) => p.badge && !p.hidden).slice(0, 10);

  if (featured.length === 0) {
    section.hidden = true;
    scroll.innerHTML = '';
    return;
  }

  section.hidden = false;
  scroll.innerHTML = featured
    .map((product) => {
      const isSellable = esProductoVendible(product);
      const isOut = isSellable && outOfStock.has(product.id);
      return `
      <div class="featured-card${isOut ? ' is-out-of-stock' : ''}${!isSellable ? ' is-showcase-only' : ''}" role="button" tabindex="0" data-product-id="${product.id}">
        <div class="featured-thumb">
          ${fotoOIcono(product, '')}
          <span class="featured-badge">${escapeHtml(isOut ? t('agotado') : product.badge)}</span>
        </div>
        <div class="featured-name">${escapeHtml(campoIdioma(product, 'name'))}</div>
        <div class="featured-price">${formatCOP(product.price)}</div>
      </div>`;
    })
    .join('');

  scroll.querySelectorAll('.featured-card').forEach((card) => {
    const open = () => {
      const product = featured.find((p) => p.id === card.dataset.productId);
      if (product) onOpenProduct(product, outOfStock.has(product.id));
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });
}

function heartSvg(filled) {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}"><path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.099 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/* --- Selector de sabor dentro del modal de producto ---
   product.sabores (array) -> dos <select> (sabor + segunda opción).
   product.pedirSabor (bool, sin lista fija) -> dos <input> de texto.
   Ninguno de los dos -> los 4 campos quedan ocultos, como antes. */
function setupFlavorFields(product) {
  const selectField = $('modal-flavor-field');
  const select2Field = $('modal-flavor2-field');
  const textField = $('modal-flavor-text-field');
  const text2Field = $('modal-flavor2-text-field');
  const select = $('modal-flavor-select');
  const select2 = $('modal-flavor2-select');
  const text = $('modal-flavor-text');
  const text2 = $('modal-flavor2-text');

  text.value = '';
  text2.value = '';

  const hasFixedList = Array.isArray(product.sabores) && product.sabores.length > 0;
  const hasOpenFlavor = !hasFixedList && !!product.pedirSabor;

  selectField.hidden = !hasFixedList;
  select2Field.hidden = !hasFixedList;
  textField.hidden = !hasOpenFlavor;
  text2Field.hidden = !hasOpenFlavor;

  // Entrada suave de los campos de sabor cuando el producto los necesita
  // — sin GSAP (ej. falla la carga del CDN/vendor) simplemente aparecen
  // sin animar, el hidden de arriba ya los deja visibles igual.
  if (window.gsap && (hasFixedList || hasOpenFlavor)) {
    const visibleFields = [selectField, select2Field, textField, text2Field].filter((el) => !el.hidden);
    window.gsap.fromTo(
      visibleFields,
      { opacity: 0, y: -6 },
      { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out', stagger: 0.05 }
    );
  }

  if (hasFixedList) {
    const buildOptions = (excludeValue) =>
      product.sabores
        .filter((s) => s !== excludeValue)
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join('');

    select.innerHTML = `<option value="">${escapeHtml(t('eligeSaborOpcion'))}</option>${buildOptions('')}`;
    select2.innerHTML = `<option value="">${escapeHtml(t('sinSegundaOpcion'))}</option>${buildOptions('')}`;
    select.value = '';
    select2.value = '';

    // La segunda opción es un respaldo por si no hay la primera — no
    // tiene sentido dejar elegir el mismo sabor dos veces, así que se
    // saca del segundo <select> en cuanto se elige el primero.
    select.onchange = () => {
      const current = select2.value;
      select2.innerHTML = `<option value="">${escapeHtml(t('sinSegundaOpcion'))}</option>${buildOptions(select.value)}`;
      select2.value = current === select.value ? '' : current;
    };
  }

  return {
    hasFixedList,
    hasOpenFlavor,
    // Arma el texto que viaja en las notas del pedido (cocina/panel ya
    // muestran "notes" tal cual, no hizo falta tocar cart.js/admin.js).
    composeNotes(freeNotes) {
      let flavor = '';
      let flavor2 = '';
      if (hasFixedList) {
        flavor = select.value;
        flavor2 = select2.value;
      } else if (hasOpenFlavor) {
        flavor = text.value.trim();
        flavor2 = text2.value.trim();
      }
      const parts = [];
      if (flavor) parts.push(`Sabor: ${flavor}`);
      if (flavor2) parts.push(`si no hay, prefiero: ${flavor2}`);
      if (freeNotes) parts.push(freeNotes);
      return parts.join(' · ');
    },
    isValid() {
      if (hasFixedList) return !!select.value;
      if (hasOpenFlavor) return !!text.value.trim();
      return true;
    },
  };
}

/* --- Modal de producto --- */

/* Foto para el detalle: la versión de 800 px en Storage (menu/hd/). Si no
   existe, mostrarFotoDetalle cae a la de la lista con su onerror. */
function fotoHd(ruta) {
  return urlFoto(ruta, true);
}

function mostrarFotoDetalle(product, nombre) {
  const modal = $('product-modal');
  const media = $('modal-product-media');
  const photo = $('modal-product-photo');
  // Se vacía antes de pedir la nueva: si no, al abrir otro producto se
  // veía un instante la foto del anterior.
  photo.onload = photo.onerror = null;
  photo.classList.remove('is-loaded');
  photo.removeAttribute('src');

  const sinFoto = () => {
    modal.classList.add('sin-foto');
    media.hidden = true;
  };
  if (!product.image) return sinFoto();

  modal.classList.remove('sin-foto');
  media.hidden = false;
  photo.alt = nombre || '';
  photo.onload = () => photo.classList.add('is-loaded');
  photo.onerror = () => {
    // Sin versión HD (ej. una foto nueva todavía sin procesar): la de la lista.
    if (photo.getAttribute('src') !== urlFoto(product.image)) photo.src = urlFoto(product.image);
    else sinFoto();
  };
  photo.src = fotoHd(product.image);
}

/* openProductModal engancha −, + y Agregar para ESE producto. Antes nadie
   llamaba a la limpieza si el cliente cerraba sin agregar: esos listeners
   seguían vivos y, al agregar otro plato, se sumaban al carrito también
   los que solo había mirado. Ahora cada apertura limpia la anterior. */
let limpiarModalProducto = null;

export function openProductModal(product, isOutOfStock, { onAdd }) {
  if (limpiarModalProducto) limpiarModalProducto();

  const nombre = campoIdioma(product, 'name');
  const categoria = CATEGORIES.find((c) => c.id === product.categoryId);
  $('modal-product-category').textContent = categoria ? campoIdioma(categoria, 'name') : '';
  $('modal-product-name').textContent = nombre;
  $('modal-product-price').textContent = formatCOP(product.price);
  $('modal-product-desc').textContent = campoIdioma(product, 'description');
  $('modal-product-legal').hidden = !esAlcohol(product);
  mostrarFotoDetalle(product, nombre);
  $('modal-product-media').closest('.drawer-body').scrollTop = 0;

  let qty = 1;
  $('modal-qty-value').textContent = qty;
  $('modal-notes').value = '';
  updateModalTotal(product.price, qty);

  const flavor = setupFlavorFields(product);
  const isSellable = esProductoVendible(product);
  $('modal-restaurant-only-notice').hidden = isSellable;
  $('product-modal-footer').hidden = !isSellable;
  $('modal-notes').closest('.field').hidden = !isSellable;
  if (!isSellable) {
    ['modal-flavor-field', 'modal-flavor2-field', 'modal-flavor-text-field', 'modal-flavor2-text-field']
      .forEach((id) => { $(id).hidden = true; });
  }
  const minus = $('modal-qty-minus');
  const plus = $('modal-qty-plus');
  const addBtn = $('btn-add-to-cart');

  addBtn.disabled = !isSellable || !!isOutOfStock;
  addBtn.hidden = !isSellable;
  $('modal-out-of-stock-notice').hidden = !isSellable || !isOutOfStock;

  const onMinus = () => {
    qty = Math.max(1, qty - 1);
    $('modal-qty-value').textContent = qty;
    updateModalTotal(product.price, qty);
    pulseQtyValue();
  };
  const onPlus = () => {
    qty += 1;
    $('modal-qty-value').textContent = qty;
    updateModalTotal(product.price, qty);
    pulseQtyValue();
  };
  const onAddClick = () => {
    if (!flavor.isValid()) {
      showToast(t('eligeSabor'));
      return;
    }
    onAdd(product, qty, flavor.composeNotes($('modal-notes').value.trim()));
    cleanup();
  };

  function cleanup() {
    minus.removeEventListener('click', onMinus);
    plus.removeEventListener('click', onPlus);
    addBtn.removeEventListener('click', onAddClick);
    if (limpiarModalProducto === cleanup) limpiarModalProducto = null;
  }
  limpiarModalProducto = cleanup;

  if (!isSellable || isOutOfStock) {
    minus.disabled = true;
    plus.disabled = true;
  } else {
    minus.disabled = false;
    plus.disabled = false;
    minus.addEventListener('click', onMinus);
    plus.addEventListener('click', onPlus);
    addBtn.addEventListener('click', onAddClick);
  }

  toggleSheet('product-modal', true);
  return cleanup;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateModalTotal(price, qty) {
  $('modal-total-price').textContent = formatCOP(price * qty);
}

function pulseQtyValue() {
  const el = $('modal-qty-value');
  if (!window.gsap || !el) return;
  window.gsap.fromTo(el, { scale: 1.3 }, { scale: 1, duration: 0.25, ease: 'power2.out' });
}

/* --- Carrito: badge en la nav inferior + barra flotante (Rappi style) + lista --- */
export function renderCartBadge(state) {
  const badge = $('bottom-nav-cart-badge');
  if (badge) {
    badge.textContent = state.count;
    badge.hidden = state.count === 0;
  }
  const searchRowBadge = $('search-row-cart-badge');
  if (searchRowBadge) {
    searchRowBadge.textContent = state.count;
    searchRowBadge.hidden = state.count === 0;
  }
  const floatingBar = $('floating-cart-bar');
  if (floatingBar) {
    if (state.count > 0) {
      floatingBar.hidden = false;
      floatingBar.classList.remove('is-hidden');
      const qtyEl = $('floating-cart-qty');
      if (qtyEl) qtyEl.textContent = state.count;
    } else {
      floatingBar.hidden = true;
      floatingBar.classList.add('is-hidden');
    }
  }
}

export function renderCartDrawer(state, { onQtyChange, onRemove }) {
  const list = $('cart-items-list');
  list.innerHTML = '';

  if (state.items.length === 0) {
    list.innerHTML = `<div class="empty-state"><h3>${t('vacio')}</h3><p>${t('vacioSub')}</p></div>`;
  }

  state.items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'cart-item';
    li.innerHTML = `
      <div class="cart-item-thumb"><img src="${escapeHtml(urlFoto(item.image))}" alt="" onerror="this.style.visibility='hidden'" /></div>
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(nombreDeItem(item))}</div>
        <div class="cart-item-unit">${formatCOP(item.price)} ${escapeHtml(t('cadaUno'))}${item.notes ? ' · ' + escapeHtml(item.notes) : ''}</div>
        <div class="cart-item-controls">
          <div class="qty-stepper">
            <button class="btn-minus" aria-label="${escapeHtml(t('restar'))}">−</button>
            <span>${item.qty}</span>
            <button class="btn-plus" aria-label="${escapeHtml(t('sumar'))}">+</button>
          </div>
          <span class="price">${formatCOP(item.price * item.qty)}</span>
        </div>
      </div>
      <button type="button" class="cart-item-remove" aria-label="${escapeHtml(t('eliminarDelCarrito').replace('{nombre}', nombreDeItem(item)))}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </button>
    `;
    li.querySelector('.btn-minus').addEventListener('click', () =>
      onQtyChange(item.id, item.notes, item.qty - 1)
    );
    li.querySelector('.btn-plus').addEventListener('click', () =>
      onQtyChange(item.id, item.notes, item.qty + 1)
    );
    // Quitar el producto entero de una — antes, si se agregaban 10 por
    // error, había que tocar "−" diez veces para sacarlo del carrito.
    li.querySelector('.cart-item-remove').addEventListener('click', () => onRemove(item.id, item.notes));
    list.appendChild(li);
  });

  $('cart-subtotal').textContent = formatCOP(state.subtotal);
  $('btn-go-checkout').disabled = state.items.length === 0;
}

/* --- Checkout: totales --- */
export function renderCheckoutTotals(subtotal, shipping) {
  $('ck-subtotal').textContent = formatCOP(subtotal);
  $('ck-shipping').textContent = formatCOP(shipping);
  $('ck-total').textContent = formatCOP(Math.max(0, subtotal + shipping));
}

/* Si falta para el pedido mínimo a domicilio, en vez de solo decir
   "te falta" sugiere un producto concreto (el más barato disponible
   que alcance a cerrar la diferencia en un solo agregado) — así el
   cliente no tiene que adivinar qué más pedir. `missing` en null/0
   oculta el aviso. */
export function renderMinOrderHint(missing, suggestion) {
  const el = $('min-order-hint');
  if (!missing || missing <= 0) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = suggestion
    ? t('faltaMinimoSugerencia').replace('{faltan}', formatCOP(missing)).replace('{nombre}', campoIdioma(suggestion, 'name')).replace('{precio}', formatCOP(suggestion.price))
    : t('faltaMinimo').replace('{faltan}', formatCOP(missing));
}

/* --- Configuración del negocio (settings) --- */
// Recibe el resultado de settings.getScheduleStatus(settings) — ya
// calculado por app.js — para que este módulo siga sin decidir lógica
// de negocio (horario automático, override manual, etc.), solo pintar.
/* El mensaje de "cerrado" lo arma reglas-pedido.js en español (se comparte
   con el servidor, no se toca acá). En inglés se reconocen sus dos formatos
   fijos; un mensaje que escribió el dueño se muestra tal cual. */
const DIAS_EN = {
  hoy: 'today', mañana: 'tomorrow', lunes: 'Monday', martes: 'Tuesday', miércoles: 'Wednesday',
  jueves: 'Thursday', viernes: 'Friday', sábado: 'Saturday', domingo: 'Sunday',
};
export function mensajeCerrado(msg) {
  if (getLang() !== 'en' || !msg) return msg;
  const m = msg.match(/^Estamos cerrados ahora\. Abrimos (.+) a las (\d{1,2}:\d{2})\.$/);
  if (m) return t('cerradoAbrimos').replace('{dia}', DIAS_EN[m[1]] || m[1]).replace('{hora}', m[2]);
  if (msg === 'Estamos cerrados en este momento. Vuelve a intentarlo más tarde.') return t('cerradoIntentaLuego');
  return msg;
}

export function renderClosedBanner(status) {
  const banner = $('closed-banner');
  banner.hidden = status.isOpen;
  if (!banner.hidden) {
    $('closed-banner-text').textContent = mensajeCerrado(status.closedMessage) || t('cerradoAhora');
  }
}

export function renderCallButton() {
  // Los números de llamar/WhatsApp del restaurante son fijos (a pedido
  // del usuario, no salen de settings.restaurantPhone) — el href real
  // lo decide app.js según lo que el cliente elija/confirme, así que
  // aquí solo nos aseguramos de que ambos botones estén visibles.
  $('btn-call-restaurant').hidden = false;
  $('btn-whatsapp-restaurant').hidden = false;
}

/* Aviso de "cerramos pronto" — separado del banner de "cerrado" (ese
   ya cubre el caso de que isOpen esté en false). Este solo aplica
   cuando SÍ está abierto pero falta poco para la hora de cierre.
   Mismo `status` de settings.getScheduleStatus() que renderClosedBanner. */
const CLOSING_SOON_MINUTES = 30;

export function renderClosingSoonBanner(status) {
  const banner = $('closing-soon-banner');
  const minutesLeft = status.minutesUntilClose;
  const show = status.isOpen && minutesLeft !== null && minutesLeft >= 0 && minutesLeft <= CLOSING_SOON_MINUTES;
  banner.hidden = !show;
  if (show) {
    $('closing-soon-banner-text').textContent =
      minutesLeft <= 1 ? t('cerrandoYa') : t('cerramosEn').replace('{n}', minutesLeft);
  }
}

/* Muestra debajo de la dirección si esa zona tiene un costo de
   domicilio distinto, o un aviso si está fuera de cobertura. */
export function renderZoneInfo({ deliveryMode, zone, restrictToZones, coverageZones }) {
  const el = $('zone-info');
  if (deliveryMode !== 'domicilio' || !coverageZones || coverageZones.length === 0) {
    el.hidden = true;
    return;
  }
  if (zone) {
    el.hidden = false;
    el.classList.remove('field-hint-warning');
    el.textContent = t('zonaDomicilio').replace('{zona}', zone.name).replace('{precio}', formatCOP(zone.fee));
  } else if (restrictToZones) {
    el.hidden = false;
    el.classList.add('field-hint-warning');
    el.textContent = t('fueraDeZona');
  } else {
    el.hidden = true;
  }
}

/* --- Checkout: direcciones guardadas --- */
export function renderSavedAddresses(addresses, { onSelect, onDelete } = {}) {
  const container = $('saved-addresses');
  if (!addresses.length) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  container.hidden = false;
  container.innerHTML = addresses
    .map(
      (addr, idx) => `
      <div class="saved-address-chip" data-idx="${idx}" title="${escapeHtml(addr.address)}">
        <span class="saved-address-chip-label">${escapeHtml(addr.label || addr.address)}</span>
        <button type="button" class="saved-address-chip-remove" data-idx="${idx}" aria-label="${escapeHtml(t('eliminarDireccion'))}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        </button>
      </div>`
    )
    .join('');

  container.querySelectorAll('.saved-address-chip').forEach((chip) => {
    chip.addEventListener('click', () => onSelect && onSelect(addresses[Number(chip.dataset.idx)]));
  });
  container.querySelectorAll('.saved-address-chip-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDelete && onDelete(addresses[Number(btn.dataset.idx)]);
    });
  });
}

/* --- Perfil --- */
export function renderProfile(user) {
  const img = $('profile-avatar-img');
  img.referrerPolicy = 'no-referrer';
  img.style.display = user.photoURL ? '' : 'none';
  img.src = user.photoURL || '';
  img.alt = user.displayName || 'Usuario';
  img.onerror = () => {
    img.style.display = 'none';
  };
  $('profile-name').textContent = user.displayName || 'Usuario';
  $('profile-email').textContent = user.email || '';
}

/* Pasos simplificados a pedido del usuario — antes eran 7 (Recibido,
   Confirmado, En cocina, Listo, En camino, Llegando, Entregado), ahora
   solo estos 3. Los estados que no tienen paso propio se agrupan en el
   más cercano: recibido/enviado/preparacion -> "En preparación",
   en_camino/llegado -> "En camino"; entregado marca los 3 como hechos
   (el pedido ya no aparece como "activo" en ningún lado igual). */
// "entregado" antes NO era un paso propio — se pintaba igual que
// "en_camino" (mismo índice), así que el pedido se quedaba "atascado"
// en camino a los ojos del cliente aunque ya lo hubieran recibido; el
// recibo también mostraba el texto crudo "entregado" en vez de una
// etiqueta (ORDER_STEPS.find no encontraba nada con ese id). Se agregó
// como cuarto paso real.
const ORDER_STEPS = [
  { id: 'preparacion', label: 'En preparación' },
  { id: 'listo', label: 'Listo' },
  { id: 'en_camino', label: 'En camino' },
  { id: 'entregado', label: 'Entregado' },
];

function stepIndexForStatus(status) {
  if (status === 'listo') return 1;
  if (status === 'en_camino' || status === 'llegado') return 2;
  if (status === 'entregado') return 3;
  return 0; // recibido, enviado, preparacion (o cualquier estado no reconocido)
}

function renderStatusStepper(status) {
  const currentIndex = stepIndexForStatus(status);
  return `
    <div class="status-stepper">
      ${ORDER_STEPS.map(
        (step, i) => `
        <div class="status-step${i <= currentIndex ? ' is-done' : ''}">
          <span class="status-dot"></span>
          <span class="status-label">${escapeHtml(etiquetaEstado(step.id))}</span>
        </div>`
      ).join('')}
    </div>
  `;
}

/* Si el panel puso un tiempo estimado (ver admin.js), calcula la
   hora aproximada de entrega/recogida a partir de cuándo se puso
   ese estimado. Vuelve null si el pedido ya no está activo o no
   tiene estimado — así el llamador simplemente no muestra nada. */
/* Franja fija sobre la barra inferior con el pedido activo más
   reciente (si hay alguno) — para que el cliente vea el estado sin
   tener que abrir su perfil. "Activo" = no entregado, cancelado ni
   no_entregado. onTap abre el perfil (donde ya está el detalle
   completo), no duplicamos esa vista acá. */
export function renderActiveOrderBar(orders, onTap) {
  const bar = $('active-order-bar');
  const active = orders.find((o) => !['entregado', 'cancelado', 'no_entregado'].includes(o.status || 'recibido'));
  if (!active) {
    bar.hidden = true;
    return;
  }
  const eta = estimatedReadyLabel(active);
  // "llegado" cae en el mismo paso que "en_camino" en el stepper (ver
  // stepIndexForStatus) para no reintroducir un 4to punto en la barra
  // de progreso — pero acá, en el único lugar con texto libre, sí vale
  // la pena decir explícitamente que el domiciliario ya llegó en vez
  // de repetir "Tu pedido: En camino".
  if (active.status === 'llegado') {
    $('active-order-bar-text').textContent = eta ? `${t('domiciliarioLlego')} — ${eta}` : t('domiciliarioLlego');
  } else {
    const paso = ORDER_STEPS[stepIndexForStatus(active.status || 'recibido')];
    const label = etiquetaEstado(paso ? paso.id : 'recibido');
    $('active-order-bar-text').textContent = eta ? `${t('tuPedidoEstado').replace('{estado}', label)} — ${eta}` : t('tuPedidoEstado').replace('{estado}', label);
  }
  bar.hidden = false;
  bar.onclick = onTap || null;
}

function estimatedReadyLabel(order) {
  if (['entregado', 'cancelado'].includes(order.status || 'recibido')) return null;
  if (!order.etaMinutes || !order.etaSetAt) return null;
  const readyAt = order.etaSetAt + order.etaMinutes * 60000;
  const date = new Date(readyAt);
  if (Number.isNaN(date.getTime())) return null;
  return t('listoAprox').replace('{hora}', fmtHoraCO(date.getTime()));
}

// Si el domiciliario lleva más de esto sin mandar una posición
// nueva estando "en camino", asumimos que perdió señal/cerró la
// app/se quedó sin batería — se lo avisamos al cliente en vez de
// mostrar en silencio una ubicación vieja como si fuera actual.
const GPS_STALE_MS = 5 * 60 * 1000;

/* Cuando el domiciliario marca "Recogí el pedido" (driver.js),
   empieza a mandar su ubicación — la mostramos como un enlace a
   Google Maps (sin necesitar clave propia de mapas) más hace cuánto
   se actualizó, para que el cliente sepa si el dato es reciente. */
function driverTrackingInfo(order) {
  if (!['en_camino', 'llegado'].includes(order.status) || !order.driverId || !order.driverLocation) return null;
  const loc = order.driverLocation;
  if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;
  const mapsUrl = trailMapsUrl(order.driverTrail, loc);
  const updatedMs = typeof loc.updatedAt === 'number' ? loc.updatedAt : 0;
  const freshness = updatedMs ? minutesAgoLabel(updatedMs) : '';
  const hasTrail = Array.isArray(order.driverTrail) && order.driverTrail.length > 1;
  const stale = updatedMs > 0 && Date.now() - updatedMs > GPS_STALE_MS;
  return {
    mapsUrl,
    freshness,
    stale,
    driverName: order.driverName || t('tuDomiciliario'),
    label: hasTrail ? t('verRecorrido') : t('verUbicacion'),
  };
}

/* Arma un enlace de Google Maps "Cómo llegar" encadenando los puntos
   del recorrido reciente como paradas — así se ve el camino que ha
   hecho el domiciliario, no solo su punto actual. Google Maps solo
   acepta ~25 puntos en la URL, así que si el recorrido tiene más se
   muestra una muestra pareja (no los 80 completos). Sin librería de
   mapas ni clave de API: es el mismo truco de enlace público que ya
   se usa para "abrir en Maps" en el resto del proyecto. */
function trailMapsUrl(trail, current) {
  const points = (Array.isArray(trail) ? trail : [])
    .filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')
    .map((p) => `${p.lat},${p.lng}`);
  const currentStr = current ? `${current.lat},${current.lng}` : null;
  if (currentStr && points[points.length - 1] !== currentStr) points.push(currentStr);
  if (points.length === 0) return null;
  if (points.length === 1) return `https://www.google.com/maps?q=${points[0]}`;
  const sampled = points.length > 25 ? sampleEvenly(points, 25) : points;
  return `https://www.google.com/maps/dir/${sampled.join('/')}`;
}

function sampleEvenly(points, max) {
  const step = (points.length - 1) / (max - 1);
  const result = [];
  for (let i = 0; i < max; i++) {
    result.push(points[Math.round(i * step)]);
  }
  return result;
}

function minutesAgoLabel(ms) {
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (diffMin < 1) return t('actualizadoAhora');
  if (diffMin < 60) return t('actualizadoHace').replace('{n}', diffMin);
  return t('actualizadoHaceHora');
}

function formatScheduled(value) {
  const date = value && value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// En español a propósito, sin importar el idioma de la tienda: este mensaje
// lo lee el restaurante (igual que las notas que van a cocina).
function whatsappShareUrl(order) {
  const lines = [
    'Mi pedido — Rodízio Cúcuta',
    ...(order.items || []).map((item) => `${item.qty}× ${item.name}`),
    `Total: ${formatCOP(order.total || 0)}`,
    order.deliveryMode === 'recoger' ? 'Recoger en tienda' : `A domicilio${order.address ? ' — ' + order.address : ''}`,
  ];
  return `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`;
}

// El cliente puede cancelar su propio pedido solo mientras sigue
// "recibido" y no han pasado más de estos minutos — pasado eso,
// asumimos que la cocina ya empezó y solo queda llamar.
const CANCEL_WINDOW_MINUTES = 2;

function orderCreatedMs(order) {
  if (!order.createdAt) return 0;
  return typeof order.createdAt === 'number' ? order.createdAt : Number(order.createdAt) || 0;
}

export function renderOrdersList(orders, { onRepeat, onCancel, onDetail } = {}) {
  const container = $('orders-list');
  if (!orders.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>${escapeHtml(t('sinPedidos'))}</h3>
        <p>${escapeHtml(t('sinPedidosSub'))}</p>
      </div>
    `;
    return;
  }
  container.innerHTML = orders
    .map((order, idx) => {
      const status = order.status || 'recibido';
      const isCancelled = status === 'cancelado';
      const isFailed = status === 'no_entregado';
      const canCancel =
        !isCancelled &&
        status === 'recibido' &&
        order.pagado !== true && // pagado en línea: cancelar implicaría devolver plata

        Date.now() - orderCreatedMs(order) < CANCEL_WINDOW_MINUTES * 60000;
      const tracking = driverTrackingInfo(order);
      const etaLabel = estimatedReadyLabel(order);

      return `
      <div class="order-row${isCancelled ? ' is-cancelled' : ''}">
        <div class="order-row-top">
          <span class="price">${formatCOP(order.total || 0)}</span>
          <div class="order-row-actions">
            <a class="order-share-btn" href="${whatsappShareUrl(order)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(t('compartirWhatsapp'))}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.1l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1s-.7.8-.9 1c-.2.2-.3.2-.6.1s-1.2-.4-2.2-1.4c-.8-.7-1.4-1.6-1.5-1.9-.2-.3 0-.4.1-.6l.4-.5c.1-.1.2-.3.2-.4.1-.1.1-.3 0-.4-.1-.1-.6-1.4-.8-1.9-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 1.9s.8 2.2.9 2.4c.1.2 1.6 2.5 4 3.5.6.2 1 .4 1.3.5.6.2 1.1.1 1.5.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2-.1-.1-.2-.2-.4-.3z"/></svg>
            </a>
            <button type="button" class="order-repeat-btn" data-order-idx="${idx}">${escapeHtml(t('repetirPedido'))}</button>
          </div>
        </div>
        ${
          isCancelled
            ? `<p class="order-cancelled-tag">${escapeHtml(t('pedidoCancelado'))}</p>`
            : isFailed
              ? `<p class="order-cancelled-tag">${escapeHtml(t('noEntregado'))}</p>`
              : `${status === 'llegado' ? `<p class="order-arrived-tag">${escapeHtml(t('domiciliarioLlego'))}</p>` : ''}${status === 'entregado' ? `<p class="order-completed-tag">${escapeHtml(t('pedidoCompletado'))}</p>` : ''}${renderStatusStepper(status)}`
        }
        ${etaLabel ? `<p class="order-eta">${etaLabel}</p>` : ''}
        ${
          tracking
            ? tracking.stale
              ? `<p class="order-tracking-link order-tracking-stale">
                   <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
                   ${escapeHtml(t('perdimosSenal').replace('{nombre}', tracking.driverName).replace('{cuando}', tracking.freshness))}
                 </p>`
              : `<a class="order-tracking-link" href="${tracking.mapsUrl}" target="_blank" rel="noopener noreferrer">
                 <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 21s7-6.5 7-11.5A7 7 0 105 9.5C5 14.5 12 21 12 21z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="9.5" r="2.2" stroke="currentColor" stroke-width="1.8"/></svg>
                 ${escapeHtml(t('vaEnCamino').replace('{nombre}', tracking.driverName).replace('{ver}', tracking.label).replace('{cuando}', tracking.freshness))}
               </a>`
            : ''
        }
        <div class="order-row-meta">
          ${order.deliveryMode === 'recoger' ? t('recoger') : t('aDomicilio')} · ${t('nProductos').replace('{n}', (order.items || []).length)}
          ${order.scheduledFor ? ' · ' + t('programado') + ' ' + formatScheduled(order.scheduledFor) : ''}
        </div>
        <div class="order-row-actions-bottom">
          <button type="button" class="order-detail-btn" data-order-idx="${idx}">${escapeHtml(t('verRecibo'))}</button>
          ${canCancel ? `<button type="button" class="order-cancel-btn" data-order-idx="${idx}">${escapeHtml(t('cancelarPedido'))}</button>` : ''}
        </div>
      </div>`;
    })
    .join('');

  if (onRepeat) {
    container.querySelectorAll('.order-repeat-btn').forEach((btn) => {
      btn.addEventListener('click', () => onRepeat(orders[Number(btn.dataset.orderIdx)]));
    });
  }
  if (onCancel) {
    container.querySelectorAll('.order-cancel-btn').forEach((btn) => {
      btn.addEventListener('click', () => onCancel(orders[Number(btn.dataset.orderIdx)]));
    });
  }
  if (onDetail) {
    container.querySelectorAll('.order-detail-btn').forEach((btn) => {
      btn.addEventListener('click', () => onDetail(orders[Number(btn.dataset.orderIdx)]));
    });
  }
}

/* --- Recibo detallado de un pedido (modal aparte) --- */
export function openOrderDetailModal(order) {
  const body = $('order-detail-body');
  const itemsHtml = (order.items || [])
    .map(
      (item) => `
      <div class="receipt-item">
        <span class="receipt-item-main">
          ${
            item.image
              ? `<img class="receipt-item-thumb" src="${escapeHtml(urlFoto(item.image))}" alt="" onerror="this.style.visibility='hidden'" />`
              : `<span class="receipt-item-thumb receipt-item-thumb-empty"></span>`
          }
          <span>${item.qty}× ${escapeHtml(nombreDeItem(item))}</span>
        </span>
        <span>${formatCOP(item.price * item.qty)}</span>
      </div>
      ${item.notes ? `<div class="receipt-item-notes">${escapeHtml(t('nota'))}: ${escapeHtml(item.notes)}</div>` : ''}`
    )
    .join('');

  const dateLabel = order.createdAt
    ? new Date(order.createdAt).toLocaleString(getLang() === 'en' ? 'en-US' : 'es-CO', { dateStyle: 'medium', timeStyle: 'short' })
    : '';
  const status = order.status || 'recibido';
  const statusLabel = etiquetaEstado(status);

  body.innerHTML = `
    <p class="receipt-meta">${dateLabel} · ${statusLabel}</p>
    <p class="receipt-meta">${order.deliveryMode === 'recoger' ? t('recoger') : `${t('aDomicilio')}${order.address ? ' — ' + escapeHtml(order.address) : ''}`}</p>
    ${order.reference ? `<p class="receipt-meta">${escapeHtml(t('referencia'))}: ${escapeHtml(order.reference)}</p>` : ''}
    <div class="receipt-items">${itemsHtml}</div>
    <div class="summary-row"><span>${t('subtotal')}</span><span>${formatCOP(order.subtotal || 0)}</span></div>
    <div class="summary-row"><span>${t('domicilio')}</span><span>${formatCOP(order.shipping || 0)}</span></div>
    <div class="summary-row total"><span>${t('total')}</span><span>${formatCOP(order.total || 0)}</span></div>
  `;
  toggleSheet('order-detail-modal', true);
}

/* --- Header: estado de sesión ---
   Si la foto de Google falla al cargar (bloqueo por referrer,
   sin conexión, etc.) se cae al ícono genérico en vez de dejar
   una imagen rota con el texto alternativo encima. */
export function renderAccountButton(user) {
  const btn = $('btn-account');
  if (user && user.photoURL) {
    btn.innerHTML = `<img src="${user.photoURL}" alt="${user.displayName || 'Usuario'}" referrerpolicy="no-referrer" />`;
    btn.classList.add('avatar-btn');
    btn.classList.remove('icon-btn');
    btn.querySelector('img').addEventListener(
      'error',
      () => renderAccountButton({ ...user, photoURL: null }),
      { once: true }
    );
  } else {
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 20c1.5-4 6-5 8-5s6.5 1 8 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    btn.classList.add('icon-btn');
    btn.classList.remove('avatar-btn');
  }
}

// Prende/apaga el puntito rojo en el botón de cuenta (header) y en
// "Perfil" (barra inferior) — ver app.js -> checkForStatusNotification.
export function setAccountNotificationDot(show) {
  const dotHeader = $('account-notif-dot');
  const dotBottomNav = $('nav-perfil-notif-dot');
  if (dotHeader) dotHeader.hidden = !show;
  if (dotBottomNav) dotBottomNav.hidden = !show;
}

/* --- Overlays genéricos --- */
/* Todas las hojas (producto, carrito, cuenta, categorías…) comparten UN
   overlay. Reglas que antes fallaban: (1) cerrar una hoja apagaba el
   overlay aunque otra siguiera abierta (ej. "Atrás" cerraba el menú de
   categorías y dejaba el plato abierto sin fondo oscuro ni cierre por
   clic fuera); (2) si se cerraba y se reabría una hoja en menos de 250 ms,
   el temporizador del cierre anterior la ocultaba recién abierta; (3) el
   fondo seguía haciendo scroll detrás de la hoja. */
const HOJAS = ['auth-modal', 'cart-drawer', 'category-sidebar', 'order-detail-modal', 'product-modal', 'profile-drawer'];
const hojaTimers = {};
export function toggleSheet(id, open) {
  const el = $(id);
  const overlay = $('overlay');
  clearTimeout(hojaTimers[id]);
  if (open) {
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-open'));
  } else {
    el.classList.remove('is-open');
    hojaTimers[id] = setTimeout(() => {
      el.hidden = true;
    }, 250);
  }
  const algunaAbierta = HOJAS.some((h) => $(h)?.classList.contains('is-open') || (h === id && open));
  overlay.classList.toggle('is-open', algunaAbierta);
  document.body.classList.toggle('sheet-open', algunaAbierta);
}

export function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

export function nudgeCartNav() {
  const item = $('nav-carrito');
  item.classList.remove('is-nudging');
  void item.offsetWidth; // reinicia la animación
  item.classList.add('is-nudging');
}
