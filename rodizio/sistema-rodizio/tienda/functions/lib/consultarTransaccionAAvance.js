/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   Consulta el estado real de una transacción de AAvance por su
   external_order (= nuestro order_number). Ver
   docs-fusion/PLAN-PASARELA-PAGO.md sección 4.

   CABECERA CONFIRMADA 2026-09-22 por prueba en vivo:
   "Authorization: <la llave cruda, SIN prefijo>". La documentación
   del portal dice "Api_key" y eso es INCORRECTO — no reescribir
   esto a Bearer/Api_key sin volver a probar contra el servidor real.

   Nunca imprime las credenciales (ver credenciales() abajo).
   ========================================================= */

const fs = require('fs');
const path = require('path');

function leerEnv(ruta) {
  const env = {};
  for (const linea of fs.readFileSync(ruta, 'utf8').split('\n')) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const corte = limpia.indexOf('=');
    if (corte === -1) continue;
    env[limpia.slice(0, corte).trim()] = limpia.slice(corte + 1).trim();
  }
  return env;
}

// En la Cloud Function las variables ya vienen en process.env (.env +
// el secreto PASARELA_API_KEY de Secret Manager). En los scripts de
// prueba locales se leen de functions/.env y functions/.secret.local.
function credenciales() {
  const env = {};
  for (const archivo of ['.env', '.secret.local']) {
    const ruta = path.join(__dirname, '..', archivo);
    if (fs.existsSync(ruta)) Object.assign(env, leerEnv(ruta));
  }
  for (const clave of ['PASARELA_API_KEY', 'PASARELA_URL_CONSULTA']) {
    if (process.env[clave]) env[clave] = process.env[clave];
  }
  if (!env.PASARELA_API_KEY || !env.PASARELA_URL_CONSULTA) {
    throw new Error('Falta PASARELA_API_KEY o PASARELA_URL_CONSULTA (Secret Manager / functions/.env / .secret.local)');
  }
  return env;
}

/**
 * Devuelve el registro crudo que manda AAvance para ese external_order
 * (o null si no existe ninguna transacción con ese número).
 */
async function consultarTransaccion(externalOrder) {
  const { PASARELA_API_KEY, PASARELA_URL_CONSULTA } = credenciales();
  const url = PASARELA_URL_CONSULTA + '?external_order=' + encodeURIComponent(externalOrder);
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: PASARELA_API_KEY },
  });
  const texto = await res.text();
  if (!res.ok) {
    throw new Error(`AAvance respondió HTTP ${res.status}: ${texto}`);
  }
  const datos = JSON.parse(texto);
  const lista = Array.isArray(datos) ? datos : [datos];
  return lista[0] || null;
}

module.exports = { consultarTransaccion, credenciales };
