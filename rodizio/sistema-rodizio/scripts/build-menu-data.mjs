/* Fase 2 de la fusión — transforma shared/menu.js (menú fijo de 162
   ítems del sistema de mesas) al esquema de RTDB del marketplace
   (categories / products / sugerencias), ver docs-fusion/ESQUEMA-UNIFICADO.md.

   Uso:  node scripts/build-menu-data.mjs
   Salida:  scripts/menu-seed/{categories,products,sugerencias,sugerenciasPorProducto}.json

   Es determinístico y re-ejecutable. Los .json resultantes se commitean
   y se suben a RTDB con `firebase database:set` (ver el README de scripts/). */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts", "menu-seed");

// menu.js es un script clásico (const MENU = [...]). Lo evaluamos en un
// sandbox de función para extraer las tres estructuras que nos interesan.
const src = readFileSync(join(ROOT, "shared", "menu.js"), "utf8");
const extraer = new Function(
  src + "\n; return { MENU, SUGERENCIAS, SUGERENCIAS_POR_PRODUCTO };"
);
const { MENU, SUGERENCIAS, SUGERENCIAS_POR_PRODUCTO } = extraer();

// Mapa fijo nombre de categoría -> id slug (debe coincidir con ESQUEMA-UNIFICADO.md).
const CAT_SLUG = {
  "Entradas": "entradas",
  "Para Compartir": "para-compartir",
  "De la Parrilla": "de-la-parrilla",
  "Angus Beef": "angus-beef",
  "Burger Angus": "burger-angus",
  "De la Casa": "de-la-casa",
  "Del Mar": "del-mar",
  "Menú Infantil": "menu-infantil",
  "Postres": "postres",
  "Bebidas": "bebidas",
  "Cervezas 3 Cordilleras": "cervezas-3-cordilleras",
  "Mocktails": "mocktails",
  "Cocteles": "cocteles",
  "Vinos": "vinos",
  "Champagnes": "champagnes",
};

const slugCat = (nombre) => {
  if (!CAT_SLUG[nombre]) throw new Error(`Categoría sin slug en el mapa: "${nombre}"`);
  return CAT_SLUG[nombre];
};

// img en menu.js es "../icons/menu/en1.webp" -> guardamos "icons/menu/en1.webp"
const normImg = (img) => (img ? String(img).replace(/^(\.\.\/)+/, "") : "");

const categories = {};
const products = {};
let totalItems = 0;

MENU.forEach((grupo, i) => {
  const catId = slugCat(grupo.cat);
  categories[catId] = { name: grupo.cat, order: i };
  grupo.items.forEach((it, j) => {
    if (products[it.id]) throw new Error(`ID de producto duplicado: ${it.id}`);
    products[it.id] = {
      name: it.nombre,
      description: it.desc || "",
      price: it.precio || 0,
      image: normImg(it.img),
      categoryId: catId,
      order: j,
      // Selector de sabor en el modal de producto (tienda/js/ui.js openProductModal):
      // "sabores" = lista fija -> dos <select> (sabor + segunda opción de respaldo).
      // "pedirSabor" = sin lista fija -> dos <input> de texto libre (mismo par sabor/respaldo).
      ...(it.sabores ? { sabores: it.sabores } : {}),
      ...(it.pedirSabor ? { pedirSabor: true } : {}),
      // Sub-menú dentro de una categoría (hoy solo "Bebidas" lo usa, ver
      // renderMenu en tienda/js/ui.js) — agrupa un listado largo en
      // pestañas tipo "Jugos", "Gaseosas", "Cervezas", etc.
      ...(it.subGroup ? { subGroup: it.subGroup } : {}),
    };
    totalItems++;
  });
});

// sugerencias por categoría: reindexar por slug
const sugerencias = {};
for (const [catNombre, lista] of Object.entries(SUGERENCIAS || {})) {
  sugerencias[slugCat(catNombre)] = lista;
}
const sugerenciasPorProducto = { ...(SUGERENCIAS_POR_PRODUCTO || {}) };

mkdirSync(OUT, { recursive: true });
const escribir = (nombre, obj) =>
  writeFileSync(join(OUT, nombre + ".json"), JSON.stringify(obj, null, 2) + "\n");

escribir("categories", categories);
escribir("products", products);
escribir("sugerencias", sugerencias);
escribir("sugerenciasPorProducto", sugerenciasPorProducto);

console.log(
  `OK — ${Object.keys(categories).length} categorías, ${totalItems} productos, ` +
  `${Object.keys(sugerencias).length} sugerencias por categoría, ` +
  `${Object.keys(sugerenciasPorProducto).length} por producto.`
);
console.log("Salida en scripts/menu-seed/");
