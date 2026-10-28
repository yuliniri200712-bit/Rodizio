/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   Aplica scripts/menu-seed/traducciones-en.json a la base:
     - nameEn / descriptionEn en products y productsMesa
     - nameEn en categories y categoriesMesa
     - las descripciones en español que estaban cortadas con "…"
       (descripcionesCompletasEs), en los dos menús

   Arma UN parche multi-ruta y lo deja en scripts/menu-seed/parche-traducciones.json.
   Solo escribe en registros que YA existen en cada nodo: la carta de mesa
   tiene productos que la tienda no (vinos, champagnes…), y escribir
   products/VIN-01/nameEn crearía un producto fantasma a medias.

   Uso:
     node scripts/aplicar-traducciones.mjs            → arma el parche y muestra el resumen (no escribe)
     firebase database:update / scripts/menu-seed/parche-traducciones.json --project rodiziomarketplace

   Volver a correrlo después de regenerar el menú con database:set (ver
   scripts/README.md): sin esto, la regeneración borra las traducciones.
   ========================================================= */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'https://rodiziomarketplace-default-rtdb.firebaseio.com';
const t = JSON.parse(readFileSync(join(RAIZ, 'scripts', 'menu-seed', 'traducciones-en.json'), 'utf8'));

// Lectura pública (las mismas reglas que usa cualquier visitante del menú).
const leer = async (nodo) => (await (await fetch(`${DB}/${nodo}.json?shallow=true`)).json()) || {};

const [products, productsMesa, categories, categoriesMesa] = await Promise.all(
  ['products', 'productsMesa', 'categories', 'categoriesMesa'].map(leer),
);

const parche = {};
const resumen = {};
function poner(nodo, ids, fn) {
  let n = 0;
  for (const id of Object.keys(ids)) {
    const campos = fn(id);
    if (!campos) continue;
    for (const [campo, valor] of Object.entries(campos)) {
      if (valor === undefined) continue;
      parche[`${nodo}/${id}/${campo}`] = valor;
    }
    n++;
  }
  resumen[nodo] = n;
}

const producto = (id) => {
  const tr = t.productos[id];
  if (!tr) return null;
  const [nameEn, descriptionEn] = tr;
  return {
    nameEn,
    // Sin descripción en español tampoco se inventa una en inglés.
    descriptionEn: descriptionEn || undefined,
    description: t.descripcionesCompletasEs[id],
  };
};
const categoria = (id) => (t.categorias[id] ? { nameEn: t.categorias[id] } : null);

poner('products', products, producto);
poner('productsMesa', productsMesa, producto);
poner('categories', categories, categoria);
poner('categoriesMesa', categoriesMesa, categoria);

const sinTraducir = [...new Set([...Object.keys(products), ...Object.keys(productsMesa)])].filter((id) => !t.productos[id]);

writeFileSync(join(RAIZ, 'scripts', 'menu-seed', 'parche-traducciones.json'), JSON.stringify(parche, null, 2) + '\n');
console.log('registros a actualizar por nodo:', resumen);
console.log('rutas en el parche:', Object.keys(parche).length);
console.log('descripciones en español completadas:', Object.keys(parche).filter((k) => k.endsWith('/description')).length);
console.log('productos de la base SIN traducción en el JSON:', sinTraducir.length ? sinTraducir : 'ninguno');
console.log('→ scripts/menu-seed/parche-traducciones.json (todavía no se escribió nada en la base)');
