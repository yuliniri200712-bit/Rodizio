/* La copia que usa la Cloud Function debe ser idéntica a la que usa el
   navegador — si difieren, el cliente vería un total y se le cobraría
   otro. Arreglo: node scripts/sync-reglas-pedido.cjs */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('lib/reglas-pedido.mjs es copia exacta de js/reglas-pedido.js', () => {
  const navegador = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'js', 'reglas-pedido.js'));
  const servidor = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'reglas-pedido.mjs'));
  assert.ok(navegador.equals(servidor), 'Desincronizado: correr node scripts/sync-reglas-pedido.cjs');
});
