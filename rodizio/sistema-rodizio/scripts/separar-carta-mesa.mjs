/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* Separa la CARTA DE MESA del MENÚ DE DOMICILIOS.
   ===============================================================
   Hasta ahora los dos leían el mismo nodo de RTDB (`categories` /
   `products`), así que borrar un producto en el admin de domicilios lo
   borraba también de la carta que ve el cliente en la mesa. A partir de
   este cambio:

     categories      / products        -> MENÚ DE DOMICILIOS (tienda/)
     categoriesMesa  / productsMesa    -> CARTA DE MESA (shared/menu-loader.js)

   Este script arma el contenido de los nodos NUEVOS combinando:
     - lo que hay vivo hoy en RTDB (conserva precios y ediciones hechas
       desde el admin), y
     - el respaldo original en scripts/menu-seed/ (repone lo que se borró).

   Uso:
     node scripts/separar-carta-mesa.mjs            -> solo REPORTA, no escribe
     node scripts/separar-carta-mesa.mjs --escribir -> genera los .json de salida

   NUNCA escribe en RTDB por su cuenta: genera archivos en
   scripts/menu-seed/mesa/ y te dice el comando de subida, para que la
   escritura sea siempre un paso consciente. */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'scripts', 'menu-seed');
const OUT = join(SEED, 'mesa');

const ESCRIBIR = process.argv.includes('--escribir');

/* Lo "vivo" se exporta aparte con:
     firebase database:get /products   > scripts/menu-seed/live-products.json
     firebase database:get /categories > scripts/menu-seed/live-categories.json
   Se lee de ahí en vez de llamar a Firebase desde acá: así el script no
   necesita credenciales y el usuario ve exactamente qué se está comparando. */
function leerJSON(ruta, queEs) {
  if (!existsSync(ruta)) {
    console.error(`\n  FALTA el archivo: ${ruta}`);
    console.error(`  Es ${queEs}. Genéralo con:\n`);
    console.error(`     firebase use rodiziomarketplace`);
    console.error(`     firebase database:get /products   > scripts/menu-seed/live-products.json`);
    console.error(`     firebase database:get /categories > scripts/menu-seed/live-categories.json\n`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(ruta, 'utf8'));
  // `firebase database:get` a veces envuelve en null si el nodo está vacío.
  return raw || {};
}

const seedProducts = leerJSON(join(SEED, 'products.json'), 'el respaldo original del menú');
const seedCategories = leerJSON(join(SEED, 'categories.json'), 'el respaldo original de categorías');
const liveProducts = leerJSON(join(SEED, 'live-products.json'), 'lo que hay hoy en RTDB');
const liveCategories = leerJSON(join(SEED, 'live-categories.json'), 'las categorías de hoy en RTDB');

const idsSeed = Object.keys(seedProducts);
const idsLive = Object.keys(liveProducts);

const soloEnSeed = idsSeed.filter((id) => !(id in liveProducts));
const soloEnLive = idsLive.filter((id) => !(id in seedProducts));
const enAmbos = idsSeed.filter((id) => id in liveProducts);

const camposComparables = ['name', 'description', 'price', 'categoryId'];
const difieren = enAmbos
  .map((id) => {
    const cambios = camposComparables
      .filter((c) => String(seedProducts[id][c] ?? '') !== String(liveProducts[id][c] ?? ''))
      .map((c) => ({ campo: c, seed: seedProducts[id][c], vivo: liveProducts[id][c] }));
    return cambios.length ? { id, name: liveProducts[id].name, cambios } : null;
  })
  .filter(Boolean);

console.log('\n══════════ COMPARACIÓN DE CATÁLOGOS ══════════\n');
console.log(`  Respaldo original : ${idsSeed.length} productos`);
console.log(`  Vivo hoy en RTDB  : ${idsLive.length} productos\n`);

console.log(`  ── FALTAN en vivo (estaban en el respaldo) : ${soloEnSeed.length}`);
console.log('     Son los que se borraron desde el admin de domicilios.');
console.log('     La carta de mesa los RECUPERA; el menú de domicilios NO se toca.\n');
soloEnSeed.forEach((id) => {
  const p = seedProducts[id];
  console.log(`       + ${id}  ·  ${p.name}  ·  $${p.price}  ·  ${p.categoryId}`);
});

console.log(`\n  ── SOLO en vivo (creados/renombrados desde el admin) : ${soloEnLive.length}`);
console.log('     Se copian tal cual a la carta de mesa.\n');
soloEnLive.forEach((id) => {
  const p = liveProducts[id];
  console.log(`       · ${id}  ·  ${p.name}  ·  $${p.price}  ·  ${p.categoryId}`);
});

console.log(`\n  ── DIFIEREN entre respaldo y vivo : ${difieren.length}`);
console.log('     GANA SIEMPRE el valor vivo (son tus ediciones, no se pisan).\n');
difieren.forEach((d) => {
  console.log(`       ~ ${d.id}  ·  ${d.name}`);
  d.cambios.forEach((c) => {
    console.log(`           ${c.campo}: respaldo "${c.seed}"  ->  vivo "${c.vivo}"  (se queda el vivo)`);
  });
});

/* Resultado final de la CARTA DE MESA:
   todo lo vivo (con sus ediciones intactas) + lo que se había borrado. */
const cartaMesa = { ...seedProducts, ...liveProducts };
const categoriasMesa = { ...seedCategories, ...liveCategories };

console.log('\n══════════ RESULTADO DE LA CARTA DE MESA ══════════\n');
console.log(`  Productos  : ${Object.keys(cartaMesa).length}`);
console.log(`  Categorías : ${Object.keys(categoriasMesa).length}`);
console.log(`  (= ${idsLive.length} vivos + ${soloEnSeed.length} recuperados)\n`);

if (!ESCRIBIR) {
  console.log('  Esto fue SOLO un reporte — no se escribió ningún archivo.');
  console.log('  Si el resultado te cuadra, vuelve a correrlo con --escribir\n');
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'productsMesa.json'), JSON.stringify(cartaMesa, null, 2), 'utf8');
writeFileSync(join(OUT, 'categoriesMesa.json'), JSON.stringify(categoriasMesa, null, 2), 'utf8');

console.log('  Archivos generados en scripts/menu-seed/mesa/\n');
console.log('  Para subirlos a RTDB (paso consciente, revísalos antes):\n');
console.log('     firebase use rodiziomarketplace');
console.log('     firebase database:set /productsMesa   scripts/menu-seed/mesa/productsMesa.json');
console.log('     firebase database:set /categoriesMesa scripts/menu-seed/mesa/categoriesMesa.json\n');
