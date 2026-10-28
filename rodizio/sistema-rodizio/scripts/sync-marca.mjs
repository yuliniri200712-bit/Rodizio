/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   Copia a tienda/ los archivos de marca que viven en shared/:
     shared/marca.css           → tienda/css/marca.css      (paleta)
     shared/iconos-categoria.js → tienda/js/iconos-categoria.js (íconos)

   El hosting de tienda/ (marketplace, admin de domicilios,
   domiciliario) publica solo esa carpeta, así que no puede cargar
   ../shared/. La fuente única sigue siendo shared/; estas copias las
   regenera:
     - sola, antes de cada deploy de hosting (predeploy en tienda/firebase.json)
     - a mano: node scripts/sync-marca.mjs
     - para verificar sin escribir: node scripts/sync-marca.mjs --check
       (sale con código 1 si alguna copia está desactualizada)
   ========================================================= */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const COPIAS = [
  { origen: 'shared/marca.css', destino: 'tienda/css/marca.css' },
  { origen: 'shared/iconos-categoria.js', destino: 'tienda/js/iconos-categoria.js' },
];

// El aviso usa /* */, que vale igual en CSS y en JS.
function contenidoEsperado(origen) {
  const aviso =
    `/* COPIA GENERADA de ${origen} por scripts/sync-marca.mjs — NO EDITAR.\n` +
    `   Cambiar ${origen} y correr: node scripts/sync-marca.mjs */\n`;
  return aviso + readFileSync(join(raiz, origen), 'utf8');
}

if (process.argv.includes('--check')) {
  let desactualizadas = 0;
  for (const { origen, destino } of COPIAS) {
    const ruta = join(raiz, destino);
    const actual = existsSync(ruta) ? readFileSync(ruta, 'utf8') : '';
    if (actual !== contenidoEsperado(origen)) {
      console.error(`${relative(process.cwd(), ruta)} desactualizado: correr node scripts/sync-marca.mjs`);
      desactualizadas++;
    }
  }
  if (desactualizadas) process.exit(1);
  console.log('marca sincronizada (paleta e íconos)');
} else {
  for (const { origen, destino } of COPIAS) {
    const ruta = join(raiz, destino);
    writeFileSync(ruta, contenidoEsperado(origen));
    console.log(`${origen} → ${relative(process.cwd(), ruta)}`);
  }
}
