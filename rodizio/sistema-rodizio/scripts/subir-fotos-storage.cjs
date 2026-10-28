// Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu)
/*
  Sube las fotos del menú a Firebase Storage (copia maestra en la nube):
    icons/menu/*.webp     → menu/<archivo>      (lista, 320 px)
    icons/menu/hd/*.webp  → menu/hd/<archivo>   (detalle, hasta 800 px)

  Usa la sesión del CLI de Firebase de quien lo corre (firebase login), a
  través de los módulos de firebase-tools instalados globalmente — no pide
  ni guarda ninguna clave. Solo sube lo que falta o cambió (compara md5).

      node scripts/subir-fotos-storage.cjs            # sube
      node scripts/subir-fotos-storage.cjs --revisar  # solo dice qué subiría

  La app sigue mostrando las fotos desde Hosting (CDN, mismo dominio):
  Storage queda como copia maestra y como base para que el panel pueda
  subir fotos nuevas sin desplegar. Lectura pública: storage.rules.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const BUCKET = 'rodiziomarketplace.firebasestorage.app';
const RAIZ = path.join(__dirname, '..');
const SOLO_REVISAR = process.argv.includes('--revisar');

const globalNpm = execSync('npm root -g').toString().trim();
const ft = (m) => require(path.join(globalNpm, 'firebase-tools', 'lib', m));

function archivos() {
  const lista = [];
  for (const [dir, prefijo] of [['icons/menu', 'menu/'], ['icons/menu/hd', 'menu/hd/']]) {
    for (const f of fs.readdirSync(path.join(RAIZ, dir))) {
      if (f.endsWith('.webp')) lista.push({ local: path.join(RAIZ, dir, f), nombre: prefijo + f });
    }
  }
  return lista;
}

(async () => {
  await ft('requireAuth').requireAuth({ project: 'rodiziomarketplace', projectRoot: RAIZ, cwd: RAIZ });
  const { Client } = ft('apiv2');
  const gcs = new Client({ urlPrefix: 'https://storage.googleapis.com', auth: true, apiVersion: '' });

  // md5 de lo que ya está en el bucket, para no subir de nuevo lo igual.
  const remotos = new Map();
  let pageToken;
  do {
    const r = await gcs.get(`/storage/v1/b/${BUCKET}/o`, { queryParams: { prefix: 'menu/', ...(pageToken ? { pageToken } : {}) } });
    for (const o of r.body.items || []) remotos.set(o.name, o.md5Hash);
    pageToken = r.body.nextPageToken;
  } while (pageToken);

  const lista = archivos();
  let subidos = 0, iguales = 0;
  for (const a of lista) {
    const buf = fs.readFileSync(a.local);
    const md5 = crypto.createHash('md5').update(buf).digest('base64');
    if (remotos.get(a.nombre) === md5) { iguales++; continue; }
    if (SOLO_REVISAR) { console.log('subiría', a.nombre); subidos++; continue; }
    // Subida multipart: datos + metadatos (tipo y caché larga) en una sola petición.
    const limite = 'rz' + crypto.randomBytes(8).toString('hex');
    const meta = JSON.stringify({ name: a.nombre, contentType: 'image/webp', cacheControl: 'public, max-age=31536000' });
    const cuerpo = Buffer.concat([
      Buffer.from(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${limite}\r\nContent-Type: image/webp\r\n\r\n`),
      buf,
      Buffer.from(`\r\n--${limite}--`),
    ]);
    await gcs.request({
      method: 'POST',
      path: `/upload/storage/v1/b/${BUCKET}/o`,
      queryParams: { uploadType: 'multipart' },
      headers: { 'Content-Type': `multipart/related; boundary=${limite}` },
      body: cuerpo,
    });
    subidos++;
    if (subidos % 25 === 0) console.log('…', subidos);
  }
  console.log(`${SOLO_REVISAR ? 'por subir' : 'subidos'}: ${subidos} · ya iguales: ${iguales} · total: ${lista.length}`);
})().catch((e) => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
