/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   Copia tienda/js/reglas-pedido.js → functions/lib/reglas-pedido.mjs

   Las Cloud Functions solo suben la carpeta functions/, así que no
   pueden importar ../js directamente. La fuente única sigue siendo
   js/reglas-pedido.js (la que carga el navegador); esta copia la
   regenera:
     - solo, antes de cada deploy (predeploy en tienda/firebase.json)
     - a mano: node functions/scripts/sync-reglas-pedido.cjs
   test/sync.test.cjs falla si la copia quedó desactualizada.
   ========================================================= */

const fs = require('fs');
const path = require('path');

const origen = path.join(__dirname, '..', '..', 'js', 'reglas-pedido.js');
const destino = path.join(__dirname, '..', 'lib', 'reglas-pedido.mjs');

fs.copyFileSync(origen, destino);
console.log(`reglas-pedido sincronizado → ${path.relative(process.cwd(), destino)}`);
