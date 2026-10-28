/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   CATÁLOGO — categorías y productos en Realtime Database
   =========================================================
   El menú del cliente se suscribe (onCategoriesChange /
   onProductsChange) y solo lee. Guardar/borrar lo usa
   admin.js — las reglas de Realtime Database ya exigen ser
   administrador para escribir aquí (ver firebase-config.js).
   ========================================================= */

import { db } from './firebase-config.js';
import { CATEGORIES as SEED_CATEGORIES, PRODUCTS as SEED_PRODUCTS } from './data.js';
import { logOnValueError } from './errors.js';
import {
  ref,
  onValue,
  set,
  remove,
  get,
  update,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js';

export function onCategoriesChange(callback, onError) {
  return onValue(
    ref(db, 'categories'),
    (snapshot) => {
      const value = snapshot.val() || {};
      const categories = Object.entries(value)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      callback(categories);
    },
    (err) => {
      logOnValueError('catalog:categories')(err);
      if (onError) onError(err);
    }
  );
}

export function onProductsChange(callback, onError) {
  return onValue(
    ref(db, 'products'),
    (snapshot) => {
      const value = snapshot.val() || {};
      const products = Object.entries(value).map(([id, data]) => ({ id, ...data }));
      callback(products);
    },
    (err) => {
      logOnValueError('catalog:products')(err);
      if (onError) onError(err);
    }
  );
}

/* Traducciones al inglés (nameEn, descriptionEn): el formulario del panel no
   las trae y set() reemplaza el registro entero, así que se perdían al editar
   cualquier cosa (un precio, un orden). Se conservan las del registro
   anterior, pero solo si el texto en español de ese campo NO cambió: si el
   dueño reescribe la descripción, la traducción vieja ya no corresponde y se
   descarta (la tienda en inglés muestra el español hasta que se retraduzca,
   mejor que una descripción en inglés que dice otra cosa). */
async function conservarTraducciones(ruta, data, campos) {
  const anterior = (await get(ref(db, ruta))).val();
  if (!anterior) return data;
  const resultado = { ...data };
  for (const campo of campos) {
    const clave = campo + 'En';
    if (clave in data || !anterior[clave]) continue;
    if ((anterior[campo] || '') === (data[campo] || '')) resultado[clave] = anterior[clave];
  }
  return resultado;
}

export async function saveCategory(category) {
  const id = category.id || slugify(category.name);
  if (!id) throw new Error('Ponle un nombre a la categoría.');
  const { id: _drop, ...data } = { ...category, id };
  const ruta = `categories/${id}`;
  await set(ref(db, ruta), await conservarTraducciones(ruta, data, ['name']));
  return id;
}

export function deleteCategory(id) {
  return remove(ref(db, `categories/${id}`));
}

export async function saveProduct(product) {
  const id = product.id || `${slugify(product.name)}-${Date.now().toString(36)}`;
  if (!product.name) throw new Error('Ponle un nombre al producto.');
  const { id: _drop, ...data } = { ...product, id };
  const ruta = `products/${id}`;
  const guardado = await conservarTraducciones(ruta, data, ['name', 'description']);
  // "hidden" no está en el formulario (se cambia en Inventario) y set()
  // reemplaza el registro entero: sin esto, editar un producto oculto
  // (un precio, una foto) lo volvía a mostrar en la tienda sin avisar.
  if (!('hidden' in guardado)) {
    const oculto = (await get(ref(db, `${ruta}/hidden`))).val();
    if (oculto) guardado.hidden = oculto;
  }
  await set(ref(db, ruta), guardado);
  return id;
}

/* Mueve un producto a otra categoría (o lo deja sin categoría con '').
   Es la forma de "quitarlo" de una categoría sin borrarlo. Solo toca
   categoryId: el resto del registro (precio, foto, traducciones) queda igual. */
export function moveProductToCategory(id, categoryId) {
  return update(ref(db, `products/${id}`), { categoryId: categoryId || null });
}

export function deleteProduct(id) {
  return remove(ref(db, `products/${id}`));
}

/* Copia el menú "de fábrica" (data.js) a Realtime Database,
   pero SOLO si products/ todavía está vacío — nunca pisa datos
   que ya hayan sido editados desde el panel. */
export async function seedCatalogIfEmpty() {
  const snapshot = await get(ref(db, 'products'));
  if (snapshot.exists()) return false;

  const categoriesData = {};
  SEED_CATEGORIES.forEach((cat, i) => {
    categoriesData[cat.id] = { name: cat.name, order: i };
  });

  const productsData = {};
  SEED_PRODUCTS.forEach((product) => {
    const { id, ...rest } = product;
    productsData[id] = rest;
  });

  await set(ref(db, 'categories'), categoriesData);
  await set(ref(db, 'products'), productsData);
  return true;
}

const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g');

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
