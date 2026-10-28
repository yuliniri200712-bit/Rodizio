/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* Corre las pruebas de emulador (reglas + Cloud Functions) desde la raíz
   del repo. FUNCTIONS_DISCOVERY_TIMEOUT sube de 30 s (por defecto) a 90 s
   el tiempo que el emulador espera a que arranque cada proceso de
   funciones: en Windows, cuando una ráfaga de escrituras dispara varios
   triggers a la vez, algunos tardan más de 30 s en cargar firebase-admin
   y el emulador los cortaba ("Failed to load function"), dejando llamadas
   colgadas hasta el timeout de 70 s. */
const { spawnSync } = require('child_process');
const path = require('path');

const raiz = path.join(__dirname, '..', '..', '..');
// Un solo string con shell: en Windows `firebase` es un .cmd. Argumentos fijos.
const r = spawnSync(
  'firebase emulators:exec --config firebase.test.json --project demo-rodizio --only auth,database,functions "node --test --test-force-exit tienda/functions/test/emulador/*.test.*"',
  { cwd: raiz, shell: true, stdio: 'inherit', env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || '90' } },
);
process.exit(r.status ?? 1);
