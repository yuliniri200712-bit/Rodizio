/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* Rodizio — shared/menu-loader.js  (Fase 2 de la fusión)

   Reemplaza a shared/menu.js: el menú ya no vive fijo en código, se
   carga de Realtime Database.

   OJO — CARTA DE MESA ≠ MENÚ DE DOMICILIOS (separados el 2026-09-21):
   este loader lee `categoriesMesa` / `productsMesa`, que son SOLO de la
   carta que se ve en la mesa (panel-cliente, mesero-app, panel-cocina).
   El marketplace y el admin de domicilios siguen con `categories` /
   `products` (ver tienda/js/catalog.js). Antes ambos compartían el mismo
   nodo, así que borrar un producto en el admin de domicilios lo borraba
   también de la carta — por eso se separaron (se perdieron los 21 vinos
   y 4 champagnes de la carta hasta que se recuperaron).
   La carta se administra desde la pestaña "Carta" de panel-admin.

   `sugerencias` / `sugerenciasPorProducto` SIGUEN compartidos a propósito:
   son pistas opcionales ("término tres cuartos", "sin cebolla") indexadas
   por categoría y por id de producto — si un producto no existe en un
   menú, su sugerencia simplemente nunca se muestra ahí. Duplicarlas solo
   agregaría mantenimiento doble sin ganar nada.

   Reconstruye en `window` EXACTAMENTE las mismas estructuras que
   exponía menu.js, para que mesero-app y panel-cliente sigan usando
   `MENU`, `SUGERENCIAS`, `sugerenciasParaItem(it)` sin cambios:

     window.MENU  = [ { cat, items: [ { id, img, nombre, desc, precio } ] } ]
     window.SUGERENCIAS            (indexado por NOMBRE de categoría, como antes)
     window.SUGERENCIAS_POR_PRODUCTO
     window.sugerenciasParaItem(item)
     window.esperarMenu()  -> Promise que resuelve cuando MENU está cargado

   Módulo ES. Cada index.html lo carga con
   <script type="module" src="../shared/menu-loader.js">.
   El menú se carga UNA vez al abrir la app (igual que antes menu.js
   requería recargar tras un deploy) — un cambio de menú desde el panel
   se ve al recargar. */

import { db } from "./firebase-app.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

let _resolve;
window.__menuReady = new Promise((r) => { _resolve = r; });
window.esperarMenu = () => window.__menuReady;

window.MENU = [];
window.SUGERENCIAS = {};
window.SUGERENCIAS_POR_PRODUCTO = {};

// Igual que en el menu.js original: solo estas categorías ofrecen
// sugerencias de término/salsa, y solo si el nombre/descr. es de carne.
const CATEGORIAS_CARNE = new Set([
  "De la Parrilla",
  "Angus Beef",
  "Burger Angus",
  "De la Casa",
]);

window.sugerenciasParaItem = function (item) {
  if (!item) return [];
  if (!CATEGORIAS_CARNE.has(item.cat)) return [];
  const texto = `${item.nombre} ${item.desc}`.toLowerCase();
  if (!/res|carne|churrasco|lomo|bife|angus|hamburguesa|pollo|cerdo|chicharron|chicharrón|morcilla|chorizo|chunchulla|ubre|costilla|pechuga/.test(texto))
    return [];
  if (window.SUGERENCIAS_POR_PRODUCTO[item.id]) return window.SUGERENCIAS_POR_PRODUCTO[item.id];
  return (window.SUGERENCIAS[item.cat] || []).slice(0, 3);
};

// Fotos en Firebase Storage (2026-10-07): products.image guarda la URL
// completa de menu/<f>.webp (lista, 320 px); hd=true da menu/hd/<f>.webp
// (detalle, 800 px). Una ruta vieja "icons/menu/<f>.webp" se traduce a la
// misma URL de Storage. Cualquier otra URL se usa tal cual. Misma lógica
// que urlFoto() en tienda/js/data.js.
const STORAGE_MENU = "https://firebasestorage.googleapis.com/v0/b/rodiziomarketplace.firebasestorage.app/o/menu%2F";
function rutaFoto(image, hd) {
  if (!image) return "";
  const vieja = /(?:^|\/)icons\/menu\/(?:hd\/)?([^/?#]+)$/.exec(image);
  if (vieja) return STORAGE_MENU + (hd ? "hd%2F" : "") + vieja[1] + "?alt=media";
  if (hd && image.startsWith(STORAGE_MENU) && !image.startsWith(STORAGE_MENU + "hd%2F")) {
    return image.replace(STORAGE_MENU, STORAGE_MENU + "hd%2F");
  }
  return image;
}

async function cargar() {
  const [catsSnap, prodsSnap, sugSnap, sugPSnap] = await Promise.all([
    get(ref(db, "categoriesMesa")),
    get(ref(db, "productsMesa")),
    get(ref(db, "sugerencias")),
    get(ref(db, "sugerenciasPorProducto")),
  ]);
  const cats = catsSnap.val() || {};
  const prods = prodsSnap.val() || {};
  const sug = sugSnap.val() || {};
  const sugP = sugPSnap.val() || {};

  const nombrePorSlug = {};
  Object.entries(cats).forEach(([slug, c]) => { nombrePorSlug[slug] = c.name; });

  // SUGERENCIAS: RTDB las guarda por slug; menu.js las tenía por nombre.
  const SUG = {};
  Object.entries(sug).forEach(([slug, lista]) => {
    SUG[nombrePorSlug[slug] || slug] = lista;
  });
  window.SUGERENCIAS = SUG;
  window.SUGERENCIAS_POR_PRODUCTO = sugP;

  // Productos agrupados por categoría, ordenados por `order`.
  const porCat = {};
  Object.entries(prods).forEach(([id, p]) => {
    (porCat[p.categoryId] = porCat[p.categoryId] || []).push({
      id,
      img: rutaFoto(p.image, false),
      // Versión de 800 px para el detalle del producto (icons/menu/hd/).
      imgHd: rutaFoto(p.image, true),
      nombre: p.name,
      desc: p.description || "",
      // Traducción al inglés (vacía si falta: la app cae al español).
      nombreEn: p.nameEn || "",
      descEn: p.descriptionEn || "",
      precio: p.price || 0,
      _order: typeof p.order === "number" ? p.order : 0,
    });
  });

  window.MENU = Object.entries(cats)
    .sort((a, b) => (a[1].order || 0) - (b[1].order || 0))
    .map(([slug, c]) => ({
      cat: c.name,
      catEn: c.nameEn || "",
      items: (porCat[slug] || [])
        .sort((a, b) => a._order - b._order)
        .map(({ _order, ...it }) => it),
    }))
    .filter((g) => g.items.length);
}

cargar()
  .then(() => _resolve(window.MENU))
  .catch((e) => {
    console.error("menu-loader: no se pudo cargar el menú de RTDB", e);
    _resolve(window.MENU); // resuelve igual (vacío) para no colgar la app
  });
