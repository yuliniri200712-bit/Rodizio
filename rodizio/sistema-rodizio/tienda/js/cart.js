/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
import { esProductoVendible } from './reglas-pedido.js';
/* =========================================================
   CARRITO
   =========================================================
   Estado del carrito en memoria + localStorage, con un
   patrón pub/sub sencillo para que la UI se repinte sola
   cada vez que el carrito cambia.
   ========================================================= */

const STORAGE_KEY = 'rodizio-cucuta-cart';

let items = loadFromStorage();
const listeners = new Set();

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function notify() {
  persist();
  listeners.forEach((fn) => fn(getState()));
}

export function onCartChange(fn) {
  listeners.add(fn);
  fn(getState()); // entrega el estado actual de inmediato
  return () => listeners.delete(fn);
}

export function getState() {
  const count = items.reduce((sum, i) => sum + i.qty, 0);
  const subtotal = items.reduce((sum, i) => sum + i.qty * i.price, 0);
  return { items: [...items], count, subtotal };
}

export const getCartState = getState;

export function addItem(product, qty = 1, notes = '') {
  if (!esProductoVendible(product)) return false;
  const existing = items.find((i) => i.id === product.id && i.notes === notes);
  if (existing) {
    existing.qty += qty;
  } else {
    items.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      qty,
      notes,
    });
  }
  notify();
  return true;
}

/* El carrito se guarda entre visitas. Al recibir el catálogo vigente,
   elimina líneas antiguas de productos que ahora solo están disponibles en
   el restaurante o ya
   no existen; evita que sobrevivan por localStorage hasta el checkout. */
export function reconcileProducts(products) {
  const byId = new Map((products || []).map((product) => [product.id, product]));
  const before = items.length;
  items = items.filter((item) => esProductoVendible(byId.get(item.id)));
  const removed = before - items.length;
  if (removed > 0) notify();
  return removed;
}

export function updateQty(id, notes, qty) {
  const item = items.find((i) => i.id === id && i.notes === notes);
  if (!item) return;
  item.qty = Math.max(0, qty);
  items = items.filter((i) => i.qty > 0);
  notify();
}

export function removeItem(id, notes) {
  items = items.filter((i) => !(i.id === id && i.notes === notes));
  notify();
}

export function clearCart() {
  items = [];
  notify();
}

/* Pone los precios vigentes que devolvió el servidor: el carrito vive
   en localStorage y puede traer precios viejos, y crearPedido lo
   rechaza ("aborted") en vez de cobrar un total que el cliente no vio.
   prices: [{ id, price }]. Devuelve true si algo cambió. */
export function refreshPrices(prices) {
  const vigentes = new Map((prices || []).map((p) => [p.id, p.price]));
  let changed = false;
  for (const item of items) {
    if (vigentes.has(item.id) && vigentes.get(item.id) !== item.price) {
      item.price = vigentes.get(item.id);
      changed = true;
    }
  }
  if (changed) notify();
  return changed;
}
