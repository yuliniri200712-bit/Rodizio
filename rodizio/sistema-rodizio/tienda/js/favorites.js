/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   FAVORITOS
   =========================================================
   Igual que cart.js: estado en memoria + localStorage con
   patrón pub/sub. No requiere sesión iniciada: un favorito
   es una preferencia del dispositivo, no del pedido.
   ========================================================= */

import { esProductoVendible } from './reglas-pedido.js';

const STORAGE_KEY = 'rodizio-cucuta-favorites';

let ids = loadFromStorage();
const listeners = new Set();

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

function notify() {
  persist();
  listeners.forEach((fn) => fn(new Set(ids)));
}

export function onFavoritesChange(fn) {
  listeners.add(fn);
  fn(new Set(ids));
  return () => listeners.delete(fn);
}

export function getFavoriteIds() {
  return new Set(ids);
}

export function isFavorite(id) {
  return ids.has(id);
}

export function toggleFavorite(id, product) {
  if (!esProductoVendible(product)) return false;
  if (ids.has(id)) {
    ids.delete(id);
  } else {
    ids.add(id);
  }
  notify();
  return true;
}

/* Los favoritos también viven en localStorage. Quita al cargar el catálogo
   cualquier producto que quedó guardado antes de pasar su categoría a muestra. */
export function reconcileProducts(products) {
  const byId = new Map((products || []).map((product) => [product.id, product]));
  let changed = false;
  for (const id of ids) {
    const product = byId.get(id);
    if (product && !esProductoVendible(product)) {
      ids.delete(id);
      changed = true;
    }
  }
  if (changed) notify();
  return changed;
}
