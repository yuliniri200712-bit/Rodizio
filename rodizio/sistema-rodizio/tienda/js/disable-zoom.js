/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   BLOQUEO DE ZOOM — también en iOS Safari
   =========================================================
   El <meta viewport> (maximum-scale=1, user-scalable=no) en las 3
   apps ya bloquea el zoom en Android/desktop, pero iOS Safari lo
   ignora a propósito desde iOS 10 (decisión de accesibilidad de
   Apple: nunca deja que una página desactive el pellizco-zoom solo
   con el viewport). Para bloquearlo también ahí hace falta interceptar
   los gestos a mano. Script clásico (no módulo) para que corra apenas
   carga, sin depender de que termine el resto del bundle.

   A propósito, ver tienda/CLAUDE.md: esto también bloquea el zoom de
   accesibilidad para baja visión — el usuario lo pidió así, no es un
   descuido. */
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('gestureend', (e) => e.preventDefault());

// Doble-tap-para-zoom de iOS Safari no dispara los eventos "gesture*"
// (esos son solo para pellizco con 2 dedos) — se detecta aparte por
// tiempo entre dos "touchend" seguidos.
let lastTouchEnd = 0;
// Un toque sobre un campo, botón o enlace NUNCA se cancela: cancelar el
// "touchend" le quita el clic, y con él el foco. Antes, tocar el
// textarea de la nota (o el "+" dos veces rápido) justo después de
// otro toque no hacía nada. El doble-tap-zoom de esos controles ya lo
// evita "touch-action: manipulation" (base.css).
const CONTROL = 'input, textarea, select, button, a, label, summary, [role="button"], [contenteditable]';
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    const esControl = e.target instanceof Element && e.target.closest(CONTROL);
    if (!esControl && now - lastTouchEnd <= 300) {
      e.preventDefault();
    }
    lastTouchEnd = now;
  },
  { passive: false }
);
