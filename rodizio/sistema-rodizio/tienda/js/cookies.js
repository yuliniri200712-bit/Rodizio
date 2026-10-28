/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   AVISO DE COOKIES — Analytics solo con permiso
   =========================================================
   Lo necesario para que la tienda funcione (carrito, sesión, idioma)
   vive en el celular y no pide permiso. Google Analytics sí: deja
   cookies _ga de un tercero, así que solo arranca si el cliente toca
   "Aceptar". Antes se iniciaba siempre al cargar la página.

   La decisión se guarda en localStorage (CLAVE). privacidad.html#cliente
   tiene el botón para cambiarla: borra esta clave y las cookies _ga, y
   el aviso vuelve a salir en la siguiente visita. Si el navegador no deja
   usar localStorage, la decisión vale solo para esta visita.
   ========================================================= */

import { iniciarAnalytics } from './firebase-config.js';

const CLAVE = 'rodizio_cookies'; // 'aceptadas' | 'rechazadas'
let decisionSesion = null;

function decision() {
  try {
    return localStorage.getItem(CLAVE) || decisionSesion;
  } catch {
    return decisionSesion;
  }
}

export function analiticaPermitida() {
  return decision() === 'aceptadas';
}

function guardar(valor, aviso) {
  decisionSesion = valor;
  try {
    localStorage.setItem(CLAVE, valor);
  } catch {
    // Sin localStorage: queda solo en memoria, el aviso vuelve la próxima vez.
  }
  aviso.hidden = true;
  if (valor === 'aceptadas') iniciarAnalytics();
}

export function iniciarAvisoCookies() {
  const aviso = document.getElementById('cookie-banner');
  if (!aviso) return;
  const actual = decision();
  if (actual === 'aceptadas') {
    iniciarAnalytics();
    return;
  }
  if (actual === 'rechazadas') return;
  aviso.querySelector('[data-cookies="aceptar"]').addEventListener('click', () => guardar('aceptadas', aviso));
  aviso.querySelector('[data-cookies="rechazar"]').addEventListener('click', () => guardar('rechazadas', aviso));
  aviso.hidden = false;
}
