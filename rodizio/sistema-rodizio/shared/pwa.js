/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
// En el entorno local de pruebas (scripts/entorno-local.mjs) el service
// worker solo estorba: sirve CSS/JS viejos de su caché mientras se edita.
// Ahí se quita el que hubiera y no se registra ninguno.
const ES_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
if (ES_LOCAL && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
} else if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}