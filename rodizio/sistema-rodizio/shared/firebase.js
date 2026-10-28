/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* Rodizio — shared/firebase.js
   Capa de datos sobre Firebase Realtime Database usando el SDK oficial.

   Antes hablaba con la REST API + EventSource SIN SDK y SIN token, lo
   que solo funcionaba con las reglas de RTDB abiertas. Se migró al SDK
   (Fase 2b de la fusión) para poder operar con reglas cerradas
   (`auth != null`) sin tener que adjuntar y renovar el ID token a mano.

   Sigue exponiendo las MISMAS funciones de siempre en `window`
   (`dbGet`, `dbSet`, `dbPush`, `dbUpdate`, `dbDelete`, `escucharSSE`,
   `aplicarEventoSSE`, `siguienteCodigo`) para que los scripts clásicos
   (util.js, roles.js, cada app.js) las llamen igual que antes.

   Este archivo AHORA es un módulo ES: cada index.html lo carga con
   <script type="module" src="../shared/firebase.js">. Los consumidores
   que puedan ejecutarse antes de que el módulo termine deben esperar
   con `await esperarFirebase()` (ver shared/util.js). */

import { db } from "./firebase-app.js";
import {
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

// Modo observación: si una app marcó `window.__SOLO_LECTURA` (lo hace
// mesero-app/panel-caja/panel-cocina cuando entra un admin — ver
// shared/ui.js `activarModoObservador`), TODA escritura se vuelve no-op
// y se avisa con un toast. Las lecturas (dbGet/escucharSSE) no se tocan.
function _soloLectura() {
  if (!window.__SOLO_LECTURA) return false;
  try { window.__avisoSoloLectura && window.__avisoSoloLectura(); } catch (e) {}
  return true;
}

async function dbGet(path) {
  const snap = await get(ref(db, path));
  return snap.exists() ? snap.val() : null;
}

async function dbSet(path, data) {
  if (_soloLectura()) return;
  await set(ref(db, path), data);
}

async function dbUpdate(path, data) {
  if (_soloLectura()) return;
  await update(ref(db, path), data);
}

async function dbDelete(path) {
  if (_soloLectura()) return;
  await remove(ref(db, path));
}

async function dbPush(path, data) {
  if (_soloLectura()) return null;
  const r = push(ref(db, path));
  await set(r, data);
  return r.key;
}

// ───────── Tiempo real ─────────
// Escucha una ruta completa (p. ej. "/pedidos"). Llama a onData(valor)
// con el árbol completo en CADA cambio (el SDK ya no manda eventos
// incrementales como el SSE de antes). onStatus(bool) es opcional, para
// el indicador de conexión. Devuelve { close } — igual que antes se
// devolvía un EventSource con .close().
function escucharSSE(path, onData, onStatus) {
  let primera = true;
  const unsub = onValue(
    ref(db, path),
    (snap) => {
      if (primera && typeof onStatus === "function") {
        onStatus(true);
        primera = false;
      }
      onData(snap.val());
    },
    (err) => {
      console.error("escucharSSE", path, err);
      if (typeof onStatus === "function") onStatus(false);
    }
  );
  return { close: unsub };
}

// Compat hacia atrás. Antes aplicaba un evento SSE incremental sobre el
// árbol local; con el SDK cada callback ya trae el árbol completo, así
// que esto solo normaliza null -> {}. Se mantiene para no romper
// llamadas viejas que todavía hagan `x = aplicarEventoSSE(x, t, data)`.
function aplicarEventoSSE(_arbol, _tipo, data) {
  return data == null ? {} : data;
}

// ───────── Correlativo diario de pedidos ─────────
// P-001 (mesa) / D-001 (domicilio) — un solo contador por día para todo
// el local. runTransaction hace la operación atómica de verdad (antes
// era una aproximación con ETag condicional, ver historial).
async function siguienteCodigo(prefijo) {
  if (_soloLectura()) return null;
  // El día del contador es el día de COLOMBIA, no UTC ni el del navegador:
  // con toISOString() (UTC) el correlativo se reiniciaba a las 7 p.m. hora
  // de Cúcuta. Colombia es UTC-5 fijo, sin horario de verano.
  const ahoraCO = new Date(Date.now() - 5 * 3600000);
  const hoy = ahoraCO.getUTCFullYear() + "-" +
    String(ahoraCO.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(ahoraCO.getUTCDate()).padStart(2, "0");
  const pfx = prefijo || "P";
  try {
    const res = await runTransaction(ref(db, `contadores/${hoy}`), (actual) =>
      (typeof actual === "number" ? actual : 0) + 1
    );
    if (res.committed && typeof res.snapshot.val() === "number") {
      return pfx + "-" + String(res.snapshot.val()).padStart(3, "0");
    }
  } catch (e) {
    console.error("siguienteCodigo", e);
  }
  return pfx + "-" + String(Date.now()).slice(-4);
}

window.dbGet = dbGet;
window.dbSet = dbSet;
window.dbUpdate = dbUpdate;
window.dbDelete = dbDelete;
window.dbPush = dbPush;
window.escucharSSE = escucharSSE;
window.aplicarEventoSSE = aplicarEventoSSE;
window.siguienteCodigo = siguienteCodigo;
