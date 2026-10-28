/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   ANALÍTICA — Firebase Analytics
   =========================================================
   Un solo punto de entrada (track) para no repetir el manejo
   de "puede que Analytics no esté disponible" en cada archivo.
   Sin permiso del aviso de cookies (cookies.js) no hace nada; si
   falla o no está soportado, tampoco — nunca rompe la experiencia
   del cliente por esto.
   ========================================================= */

import { iniciarAnalytics } from './firebase-config.js';
import { analiticaPermitida } from './cookies.js';

export async function track(eventName, params) {
  if (!analiticaPermitida()) return;
  try {
    const ga = await iniciarAnalytics();
    if (ga) ga.logEvent(ga.analytics, eventName, params);
  } catch {
    // Silencioso a propósito: la analítica nunca debe romper la app.
  }
}
