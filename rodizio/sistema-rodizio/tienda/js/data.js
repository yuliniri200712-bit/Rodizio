/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   DATOS DEL MENÚ
   =========================================================
   CATEGORIES y PRODUCTS empiezan con este menú "de fábrica"
   como valor por defecto (para que la app nunca se vea vacía
   mientras carga o si Realtime Database no tiene nada aún),
   pero catalog.js los reemplaza en vivo con lo que haya en la
   base de datos vía setCategories()/setProducts() — que es lo
   que el panel de administración edita. Este mismo array
   también sirve como semilla la primera vez (ver
   catalog.seedCatalogIfEmpty).
   ========================================================= */

export let CATEGORIES = [
  { id: 'entradas', name: 'Entradas' },
  { id: 'para-compartir', name: 'Para Compartir' },
  { id: 'de-la-parrilla', name: 'De la Parrilla' },
  { id: 'angus-beef', name: 'Angus Beef' },
  { id: 'burger-angus', name: 'Burger Angus' },
  { id: 'de-la-casa', name: 'De la Casa' },
  { id: 'rodizio-casero', name: 'Rodizio Casero' },
  { id: 'del-mar', name: 'Del Mar' },
  { id: 'menu-infantil', name: 'Menú Infantil' },
  { id: 'postres', name: 'Postres' },
  { id: 'bebidas', name: 'Bebidas' },
  { id: 'cervezas-3-cordilleras', name: 'Cervezas 3 Cordilleras' },
  { id: 'mocktails', name: 'Mocktails' },
  { id: 'cocteles', name: 'Cocteles' },
  { id: 'vinos', name: 'Vinos' },
  { id: 'champagnes', name: 'Champagnes' },
];

export let PRODUCTS = [
  // --- Cortes de res ---
  {
    id: 'picanha',
    categoryId: 'de-la-parrilla',
    name: 'Picanha',
    description: 'El corte insignia del rodízio, asado lento al espeto con sal gruesa.',
    price: 38000,
    image: 'images/picanha.jpg',
    badge: 'Más pedido',
  },
  {
    id: 'ancho',
    categoryId: 'de-la-parrilla',
    name: 'Bife Ancho',
    description: 'Corte jugoso con marmoleo generoso, término a elección.',
    price: 34000,
    image: 'images/ancho.jpg',
  },
  {
    id: 'chorizo-bife',
    categoryId: 'de-la-parrilla',
    name: 'Bife de Chorizo',
    description: 'Corte alto y tierno, sellado a la parrilla de carbón.',
    price: 36000,
    image: 'images/chorizo-bife.jpg',
  },
  // --- Aves ---
  {
    id: 'pollo-parrilla',
    categoryId: 'de-la-parrilla',
    name: 'Pollo a la Parrilla',
    description: 'Muslos y contramuslos marinados en hierbas de la casa.',
    price: 22000,
    image: 'images/pollo-parrilla.jpg',
  },
  {
    id: 'alitas-bbq',
    categoryId: 'de-la-parrilla',
    name: 'Alitas BBQ',
    description: 'Bañadas en salsa BBQ ahumada, punto crocante.',
    price: 24000,
    image: 'images/alitas-bbq.jpg',
    badge: 'Picante suave',
  },
  // --- Cerdo ---
  {
    id: 'costillas',
    categoryId: 'de-la-parrilla',
    name: 'Costillas de Cerdo',
    description: 'Cocción lenta de 6 horas, glaseadas antes de servir.',
    price: 30000,
    image: 'images/costillas.jpg',
  },
  {
    id: 'lomo-cerdo',
    categoryId: 'de-la-parrilla',
    name: 'Lomo de Cerdo al Espeto',
    description: 'Con costra de panela y mostaza dulce.',
    price: 27000,
    image: 'images/lomo-cerdo.jpg',
  },
  // --- Embutidos ---
  {
    id: 'chorizo-parrilla',
    categoryId: 'para-compartir',
    name: 'Chorizo a la Parrilla',
    description: 'Receta santandereana, servido con limón.',
    price: 15000,
    image: 'images/chorizo-parrilla.jpg',
  },
  {
    id: 'morcilla',
    categoryId: 'para-compartir',
    name: 'Morcilla Criolla',
    description: 'Con arroz, cebolla larga y especias de la casa.',
    price: 14000,
    image: 'images/morcilla.jpg',
  },
  // --- Acompañamientos ---
  {
    id: 'arroz-blanco',
    categoryId: 'para-compartir',
    name: 'Arroz Blanco',
    description: 'Grano suelto, porción para compartir.',
    price: 8000,
    image: 'images/arroz-blanco.jpg',
  },
  {
    id: 'yuca-frita',
    categoryId: 'para-compartir',
    name: 'Yuca Frita',
    description: 'Crocante por fuera, suave por dentro.',
    price: 9000,
    image: 'images/yuca-frita.jpg',
  },
  {
    id: 'ensalada-casa',
    categoryId: 'para-compartir',
    name: 'Ensalada de la Casa',
    description: 'Mix de hojas verdes, tomate cherry y vinagreta de maracuyá.',
    price: 12000,
    image: 'images/ensalada-casa.jpg',
  },
  // --- Postres ---
  {
    id: 'flan-casero',
    categoryId: 'postres',
    name: 'Flan Casero',
    description: 'Receta tradicional con caramelo oscuro.',
    price: 11000,
    image: 'images/flan-casero.jpg',
  },
  {
    id: 'brigadeiro',
    categoryId: 'postres',
    name: 'Brigadeiro (3 uds)',
    description: 'Trufas brasileñas de chocolate, hechas a mano.',
    price: 10000,
    image: 'images/brigadeiro.jpg',
  },
  // --- Bebidas ---
  {
    id: 'jugo-natural',
    categoryId: 'bebidas',
    name: 'Jugo Natural',
    description: 'Elige entre maracuyá, mango o lulo.',
    price: 8000,
    image: 'images/jugo-natural.jpg',
  },
  {
    id: 'gaseosa',
    categoryId: 'bebidas',
    name: 'Gaseosa 400ml',
    description: 'Variedades disponibles en caja fría.',
    price: 6000,
    image: 'images/gaseosa.jpg',
  },
  {
    id: 'cerveza',
    categoryId: 'bebidas',
    name: 'Cerveza Nacional',
    description: 'Botella 330ml, bien fría.',
    price: 9000,
    image: 'images/cerveza.jpg',
  },
];

// Reasignan el binding vivo — cualquier archivo que haga
// `import { CATEGORIES } from './data.js'` ve el valor nuevo
// automáticamente, sin tener que re-importar nada.
export function setCategories(categories) {
  CATEGORIES = categories;
}
export function setProducts(products) {
  PRODUCTS = products;
}

// Quita tildes/mayúsculas para comparar texto en buscadores — antes había
// una copia de esto en ui.js, admin.js (x2) y settings.js, cada una escrita
// por separado; ahora todas usan esta misma función.
export function normalizeText(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

// Retrasa la ejecución de `fn` hasta que pasen `wait` ms sin que se
// vuelva a llamar — para buscadores en vivo que no deben reconstruir
// toda la lista en cada tecla.
export function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function formatCOP(value) {
  return value.toLocaleString('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  });
}

// ── Hora de Colombia (para todo) ──
// El restaurante opera en Cúcuta. Los cortes de fecha ("hoy" en los
// reportes, la etiqueta de fecha) y las horas mostradas tienen que ser
// respecto a la hora de Colombia, no la del dispositivo. Colombia es
// UTC-5 fijo (nunca tuvo horario de verano).
const CO_OFFSET_MS = 5 * 3600000;

// Timestamp de la medianoche de Colombia de hoy (o del día que contiene `ms`).
export function inicioDiaCO(ms) {
  const r = new Date((ms == null ? Date.now() : ms) - CO_OFFSET_MS);
  return Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate()) + CO_OFFSET_MS;
}
// "YYYY-MM-DD" del día en Colombia.
export function isoDiaCO(ms) {
  const r = new Date((ms == null ? Date.now() : ms) - CO_OFFSET_MS);
  return r.getUTCFullYear() + '-' + String(r.getUTCMonth() + 1).padStart(2, '0') + '-' + String(r.getUTCDate()).padStart(2, '0');
}
// toLocale* forzando zona Colombia.
export function fmtHoraCO(ms, opts) {
  return new Date(ms).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', ...(opts || {}) });
}
export function fmtFechaCO(ms, opts) {
  return new Date(ms).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', ...(opts || {}) });
}

/* Fotos del menú en Firebase Storage (2026-10-07): menu/<f>.webp (lista,
   320 px) y menu/hd/<f>.webp (detalle, hasta 800 px). products.image ya
   guarda la URL completa; esto además traduce las rutas viejas
   "icons/menu/<f>.webp" que quedaron en pedidos y carritos guardados.
   hd=true da la versión de detalle (si no existe, el <img> cae a la normal
   con su onerror). Cualquier otra URL se devuelve tal cual. */
const STORAGE_MENU = 'https://firebasestorage.googleapis.com/v0/b/rodiziomarketplace.firebasestorage.app/o/menu%2F';

export function urlFoto(ruta, hd = false) {
  if (!ruta) return '';
  const vieja = /(?:^|\/)icons\/menu\/(?:hd\/)?([^/?#]+)$/.exec(ruta);
  if (vieja) return `${STORAGE_MENU}${hd ? 'hd%2F' : ''}${vieja[1]}?alt=media`;
  if (hd && ruta.startsWith(STORAGE_MENU) && !ruta.startsWith(`${STORAGE_MENU}hd%2F`)) {
    return ruta.replace(STORAGE_MENU, `${STORAGE_MENU}hd%2F`);
  }
  return ruta;
}
