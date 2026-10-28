/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   Entorno local de pruebas — TODO el sistema en este PC, sin tocar
   producción.

     node scripts/entorno-local.mjs

   Levanta:
     - emuladores de Firebase (Auth, Realtime Database, Functions) con
       el proyecto falso `demo-rodizio` y las reglas reales
       (firebase.test.json)
     - http://localhost:5050  → paneles del restaurante (login en /,
       /mesero-app/, /panel-caja/, /panel-cocina/, /panel-admin/,
       /panel-cliente/?mesa=mesa-5)
     - http://localhost:8080  → tienda (/, /admin.html, /driver.html)

   Las apps detectan localhost y se conectan solas a los emuladores
   (MODO_LOCAL en shared/firebase-app.js y tienda/js/firebase-config.js).

   Datos: copia el menú y la configuración PÚBLICOS de producción (solo
   lectura, los mismos nodos que cualquier visitante puede leer) y crea
   las cuentas de prueba de abajo. Nada de datos personales: ni
   trabajadores, ni clientes, ni pedidos reales. Todo se borra al cerrar
   (Ctrl+C).
   ========================================================= */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROYECTO = 'demo-rodizio';
// El emulador de functions arma su databaseURL con ns=<projectId>; las
// apps usan el mismo (MODO_LOCAL) para ver la base que escribe crearPedido.
const NS = 'demo-rodizio';
const DB = 'http://127.0.0.1:9000';
const AUTH = 'http://127.0.0.1:9099';
const PRODUCCION = 'https://rodiziomarketplace-default-rtdb.firebaseio.com';

// Nodos de lectura pública en database.rules.json — se copian tal cual.
const NODOS_PUBLICOS = [
  'categories', 'products', 'categoriesMesa', 'productsMesa',
  'sugerencias', 'sugerenciasPorProducto', 'settings', 'outOfStock',
];

// Cuentas de prueba. Solo existen dentro del emulador.
const CLAVE_PRUEBA = 'prueba-local-123';
const CUENTAS = [
  // Paneles del restaurante: el login usa usuario → usuario@rodizio.local
  { email: 'prueba@rodizio.local', perfil: (uid) => ({ [`trabajadores/${uid}`]: { usuario: 'prueba', nombre: 'Trabajador Prueba', estado: 'activo', rolesPermitidos: {}, creado: Date.now() } }) },
  { email: 'admin.prueba@rodizio.local', perfil: (uid) => ({ [`trabajadores/${uid}`]: { usuario: 'admin.prueba', nombre: 'Admin Prueba', estado: 'activo', rolesPermitidos: { admin: true }, creado: Date.now() } }) },
  // Tienda: admin de domicilios y domiciliario (login por correo)
  { email: 'dueno@prueba.local', perfil: (uid) => ({ [`admins/${uid}`]: true }) },
  { email: 'domiciliario@prueba.local', perfil: (uid) => ({ [`drivers/${uid}`]: { name: 'Domiciliario Prueba', phone: '3000000000', email: 'domiciliario@prueba.local', access: true, available: true, createdAt: Date.now() } }) },
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function servidorEstatico(base, puerto) {
  return new Promise((resolve, reject) => {
    const srv = createServer(async (req, res) => {
      try {
        const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        let archivo = normalize(join(base, ruta));
        if (archivo !== base && !archivo.startsWith(base + sep)) { res.writeHead(403).end(); return; }
        let info = await stat(archivo).catch(() => null);
        if (info?.isDirectory()) {
          if (!ruta.endsWith('/')) { res.writeHead(301, { Location: ruta + '/' }).end(); return; }
          archivo = join(archivo, 'index.html');
          info = await stat(archivo).catch(() => null);
        }
        if (!info) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No existe'); return; }
        res.writeHead(200, {
          'Content-Type': MIME[extname(archivo).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(await readFile(archivo));
      } catch (e) {
        res.writeHead(500).end(String(e.message));
      }
    });
    srv.on('error', reject);
    srv.listen(puerto, () => resolve(srv));
  });
}

async function esperar(url, intentos = 120) {
  for (let i = 0; i < intentos; i++) {
    try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  throw new Error(`No respondió ${url}`);
}

async function sembrar() {
  const datos = {};
  for (const nodo of NODOS_PUBLICOS) {
    const r = await fetch(`${PRODUCCION}/${nodo}.json`);
    if (!r.ok) throw new Error(`No pude leer ${nodo} de producción (${r.status})`);
    datos[nodo] = await r.json();
  }
  // Cuentas: Auth del emulador (cualquier apiKey sirve) + perfil en la base.
  for (const c of CUENTAS) {
    const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: c.email, password: CLAVE_PRUEBA, returnSecureToken: true }),
    });
    const j = await r.json();
    if (!j.localId) throw new Error(`No pude crear ${c.email}: ${JSON.stringify(j.error || j)}`);
    Object.assign(datos, c.perfil(j.localId));
  }
  // "Bearer owner" = acceso de administrador del emulador (salta las reglas).
  const r = await fetch(`${DB}/.json?ns=${NS}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  if (!r.ok) throw new Error(`No pude sembrar la base: ${r.status} ${await r.text()}`);
  const productos = Object.keys(datos.products || {}).length + Object.keys(datos.productsMesa || {}).length;
  console.log(`✓ Datos de prueba: menú (${productos} productos), configuración y ${CUENTAS.length} cuentas`);
}

// Un solo string (con shell) porque en Windows `firebase` es un .cmd; los
// argumentos son fijos, no vienen de afuera.
const emuladores = spawn(
  `firebase emulators:start --config firebase.test.json --project ${PROYECTO} --only auth,database,functions`,
  // 90 s para que arranque cada proceso de funciones (por defecto 30): en
  // Windows algunos tardan más y el emulador los cortaba ("Failed to load function").
  { cwd: RAIZ, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || '90' } },
);
emuladores.stdout.on('data', (d) => { if (/error|⚠|failed/i.test(d)) process.stdout.write(`[emuladores] ${d}`); });
emuladores.stderr.on('data', (d) => process.stderr.write(`[emuladores] ${d}`));
emuladores.on('exit', (code) => { console.log(`Emuladores cerrados (código ${code}).`); process.exit(code ?? 0); });

function cerrar() {
  console.log('\nCerrando…');
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(emuladores.pid), '/t', '/f']);
  else emuladores.kill('SIGINT');
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);

try {
  console.log('Levantando emuladores (Auth 9099, Database 9000, Functions 5001)…');
  await esperar(`${DB}/.json?ns=${NS}`);
  await esperar(`${AUTH}/`);
  await esperar('http://127.0.0.1:5001/');
  await sembrar();
  await servidorEstatico(RAIZ, 5050);
  await servidorEstatico(join(RAIZ, 'tienda'), 8080);
  console.log(`
Listo. Todo apunta a los emuladores — producción no se toca.
  Paneles:  http://localhost:5050          (usuario: prueba  ·  admin: admin.prueba)
  Carta QR: http://localhost:5050/panel-cliente/?mesa=mesa-5
  Tienda:   http://localhost:8080          (cliente: login de Google del emulador)
  Admin domicilios: http://localhost:8080/admin.html   (dueno@prueba.local)
  Domiciliario:     http://localhost:8080/driver.html  (domiciliario@prueba.local)
  Clave de todas las cuentas de prueba: la constante CLAVE_PRUEBA de este archivo.
Ctrl+C para cerrar y borrar todo.`);
} catch (e) {
  console.error('✗', e.message);
  cerrar();
}
