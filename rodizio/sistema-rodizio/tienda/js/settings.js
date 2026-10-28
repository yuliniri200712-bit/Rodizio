/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   CONFIGURACIÓN DEL NEGOCIO — nodo "settings" en Realtime Database
   =========================================================
   Un solo objeto con lo que el dueño puede ajustar sin tocar
   código: si está abierto, pedido mínimo a domicilio, teléfono
   de contacto, y las zonas de cobertura (con su costo de
   domicilio cada una). Lo lee toda la app; lo escribe solo el
   panel (admin.js, y solo el rol "dueno").
   ========================================================= */

import { db } from './firebase-config.js';
import { logOnValueError } from './errors.js';
import { ref, onValue, set } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js';

import { DEFAULT_SETTINGS } from './reglas-pedido.js';

// Horario, zonas y valores por defecto viven en reglas-pedido.js (lo
// comparte con la Cloud Function crearPedido) — se re-exportan acá para
// que app.js/ui.js/admin.js sigan importándolos de settings.js como antes.
export {
  DEFAULT_SETTINGS,
  DAY_KEYS,
  DAY_LABELS,
  nowInColombia,
  getScheduleStatus,
  matchZone,
  MENSAJE_DOMICILIOS_PAUSADOS,
} from './reglas-pedido.js';

export function onSettingsChange(callback) {
  return onValue(
    ref(db, 'settings'),
    (snapshot) => {
      const value = snapshot.val();
      callback(value ? { ...DEFAULT_SETTINGS, ...value } : { ...DEFAULT_SETTINGS });
    },
    logOnValueError('settings')
  );
}

export function saveSettings(settings) {
  return set(ref(db, 'settings'), settings);
}

/* Un solo campo, al instante (botones "Detener pedidos" / "Pausar
   domicilios"): no pisa lo que otro admin esté editando en el resto. */
export function guardarCampo(campo, valor) {
  return set(ref(db, `settings/${campo}`), valor);
}
