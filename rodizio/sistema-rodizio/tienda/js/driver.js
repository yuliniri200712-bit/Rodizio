/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   APP DE DOMICILIARIOS — punto de entrada
   =========================================================
   Página aparte del panel y de la app de clientes (no comparte
   estado con ninguna). Cualquiera puede crear una cuenta aquí con
   correo y contraseña, pero solo entra quien el dueño haya
   habilitado a mano en drivers/{uid}/access — igual que admins/{uid}
   en el panel, nunca se auto-otorga acceso desde la app.

   Qué hace en la vida real:
   - Ve solo los pedidos que el panel le asignó a ÉL (nunca los de
     otro domiciliario).
   - Al marcar "Recogí el pedido" empieza a mandar su ubicación en
     vivo (para que el cliente la vea en la app de Marketplace) hasta
     que marca "Entregado".
   - Recibe un aviso sonoro/visual cuando le llega una asignación
     nueva mientras tiene la app abierta, y (si se despliega la Cloud
     Function) una notificación push aunque la tenga cerrada.
   ========================================================= */

import { auth, db } from './firebase-config.js';
import * as authApi from './auth.js';
import * as notifications from './notifications.js';
import { logOnValueError, watchGlobalErrors } from './errors.js';
import { formatCOP, inicioDiaCO, fmtHoraCO, fmtFechaCO, urlFoto, normalizeText } from './data.js';
import { confirmDialog, pickReasonDialog, promptNumberDialog } from './confirm.js';
import {
  ref,
  get,
  onValue,
  update,
  serverTimestamp,
  push,
  query,
  orderByChild,
  equalTo,
  limitToLast,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js';

const $ = (id) => document.getElementById(id);

const SEEN_KEY = 'rodizio_driver_seen_orders';
// Cada cuánto, como mínimo, se escribe la ubicación en Firebase
// mientras el domiciliario va en camino — evita mandar una escritura
// por cada evento de GPS (puede disparar varias veces por segundo).
const LOCATION_MIN_INTERVAL_MS = 10000;
// Cuántos puntos del recorrido se guardan por pedido (los más
// recientes) — a 10s por punto, ~13 minutos de recorrido reciente.
// No es el viaje completo si dura más que eso, es a propósito para
// no dejar crecer el dato sin límite.
const TRAIL_MAX_POINTS = 80;
const HISTORY_LIMIT = 20;
// Radio (metros) alrededor del destino dentro del cual el pedido pasa
// solo a "llegado" (ver geofence en el callback de watchPosition). El
// domi igual tiene un botón "Llegué" manual por si el GPS no alcanza.
const LLEGADA_RADIO_M = 150;

const state = {
  currentUser: null,
  profile: { name: '', phone: '', available: false },
  orders: [],
  filter: 'recoger', // 'recoger' | 'camino' | 'historial'
  seenOrderIds: loadSeenOrderIds(),
  newCount: 0,
  ordersSearch: '',
};

let unsubOrders = null;
let unsubProfile = null;
let unsubCashHistory = null;
let hasLoadedOrdersOnce = false;

// Rastreo de ubicación: UN solo watchPosition del dispositivo (es el
// mismo domiciliario, la misma moto/bici), pero la posición se manda
// a TODOS los pedidos que tenga "en camino" al mismo tiempo — así
// puede llevar dos pedidos por la misma ruta y ambos clientes (y el
// panel) ven su ubicación en vivo, no solo el primero.
let geoWatchId = null;
let lastLocationWriteAt = 0;
// orderId -> true una vez que ya se marcó "llegado" (automático o manual),
// para no re-escribir el estado en cada tick del GPS.
const llegadoMarcado = {};
// orderId -> [{lat, lng, at}, …] — recorrido reciente en memoria,
// capado por TRAIL_MAX_POINTS antes de mandarlo a Firebase.
const localTrails = {};

function init() {
  watchGlobalErrors('domiciliario');
  registerServiceWorker();
  hideSplashWhenReady();
  bindGateEvents();
  bindTabEvents();
  bindProfileEvents();
  bindAccountDrawerEvents();
  bindOrdersListEvents();

  authApi.onAuthChange(async (user) => {
    detachSubscriptions();
    state.currentUser = user;

    if (!user) {
      showGate('signed-out');
      return;
    }

    $('btn-driver-signout').hidden = false;

    let hasAccess = false;
    try {
      const snap = await get(ref(db, `drivers/${user.uid}/access`));
      hasAccess = snap.val() === true;
    } catch (err) {
      console.error('No se pudo verificar el acceso de domiciliario:', err);
    }

    if (!hasAccess) {
      $('driver-gate-not-driver-text').textContent =
        `La cuenta ${user.email} inició sesión pero el restaurante todavía no te habilitó como domiciliario. Avísale al dueño para que te dé acceso.`;
      showGate('not-driver');
      return;
    }

    showGate('main');
    subscribeProfile(user.uid);
    subscribeOrders(user.uid);
    // Bug real corregido: antes no se guardaba el "unsubscribe" de esto,
    // así que detachSubscriptions() nunca lo cerraba — cada inicio/cierre
    // de sesión (ej. una tablet compartida entre domiciliarios) dejaba un
    // listener de Firebase más abierto para siempre.
    unsubCashHistory = subscribeCashHistory(user.uid);
    updatePushButtonState();
  });
}

function detachSubscriptions() {
  if (unsubOrders) unsubOrders();
  if (unsubProfile) unsubProfile();
  if (unsubCashHistory) unsubCashHistory();
  unsubOrders = null;
  unsubProfile = null;
  unsubCashHistory = null;
  hasLoadedOrdersOnce = false;
  stopTracking();
}

/* ---------- Acceso (correo y contraseña) ---------- */
let authMode = 'signin';

function setAuthMode(mode) {
  authMode = mode;
  const isRegister = authMode === 'register';
  $('driver-auth-subtitle').textContent = isRegister
    ? 'Crea tu cuenta. Después, el dueño del restaurante debe habilitarte como domiciliario.'
    : 'Inicia sesión con tu correo y contraseña de domiciliario.';
  $('btn-driver-auth-submit').textContent = isRegister ? 'Crear cuenta' : 'Iniciar sesión';
  $('btn-driver-toggle-mode').textContent = isRegister ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate';
  $('driver-password').autocomplete = isRegister ? 'new-password' : 'current-password';
  $('btn-driver-forgot').hidden = isRegister;
  $('driver-consent-row').hidden = !isRegister;
}

function bindGateEvents() {
  $('driver-auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('driver-email').value.trim();
    const password = $('driver-password').value;
    const submitBtn = $('btn-driver-auth-submit');
    submitBtn.disabled = true;

    if (authMode === 'register' && !$('driver-consent-checkbox').checked) {
      showToast('Debes aceptar la política de tratamiento de datos para crear tu cuenta');
      submitBtn.disabled = false;
      return;
    }

    try {
      if (authMode === 'register') {
        await authApi.registerWithEmail(email, password);
        await authApi.recordConsent('domiciliario');
        await authApi.signOutUser();
        setAuthMode('signin');
        $('driver-auth-form').reset();
        showToast('Cuenta creada. Pídele al dueño que te habilite, luego inicia sesión.');
      } else {
        await authApi.signInWithEmail(email, password);
      }
    } catch (err) {
      showToast(err.message || 'No se pudo continuar');
    } finally {
      submitBtn.disabled = false;
    }
  });

  $('btn-driver-toggle-mode').addEventListener('click', () => {
    setAuthMode(authMode === 'signin' ? 'register' : 'signin');
  });

  $('btn-driver-forgot').addEventListener('click', async () => {
    const email = $('driver-email').value.trim();
    if (!email) {
      showToast('Escribe tu correo arriba primero');
      return;
    }
    try {
      await authApi.resetPassword(email);
      showToast('Te enviamos un correo para restablecer tu contraseña');
    } catch (err) {
      showToast(err.message || 'No se pudo enviar el correo');
    }
  });

  $('btn-driver-signout').addEventListener('click', async () => {
    if (!(await confirmDialog('¿Seguro que quieres cerrar sesión?'))) return;
    authApi.signOutUser();
  });
  $('btn-driver-signout-2').addEventListener('click', () => authApi.signOutUser());
}

function showGate(which) {
  $('driver-gate-signed-out').hidden = which !== 'signed-out';
  $('driver-gate-not-driver').hidden = which !== 'not-driver';
  $('driver-main').hidden = which !== 'main';
  $('btn-driver-signout').hidden = which === 'signed-out';
  // El botón de cuenta (cajón con perfil/seguridad/cierre de turno) solo
  // tiene sentido con acceso completo — la campana de avisos la maneja
  // aparte updatePushButtonState() (necesita saber si el navegador
  // soporta push antes de decidir si se muestra).
  $('btn-driver-account').hidden = which !== 'main';
  if (which !== 'main') closeAccountDrawer();
  if (which === 'signed-out') $('driver-auth-form').reset();
  // Recién acá se sabe de verdad qué pantalla mostrar (sesión restaurada
  // o no) — ver hideSplash() más abajo, antes esto se hacía con un
  // timer fijo sin relación con Firebase Auth y por eso se alcanzaba a
  // ver el login un instante aunque la sesión ya estuviera activa.
  hideSplash();
}

/* ---------- Perfil y disponibilidad ---------- */
function subscribeProfile(uid) {
  unsubProfile = onValue(
    ref(db, `drivers/${uid}`),
    (snapshot) => {
      const value = snapshot.val() || {};
      state.profile = { name: value.name || '', phone: value.phone || '', available: !!value.available };
      renderProfileForm();
    },
    logOnValueError('driver:profile')
  );
}

function renderProfileForm() {
  $('driver-name').value = state.profile.name;
  $('driver-phone').value = state.profile.phone;

  $('driver-greeting-name').textContent = state.profile.name || state.currentUser?.email || 'Domiciliario';

  const pill = $('driver-status-pill');
  pill.classList.toggle('is-available', state.profile.available);
  pill.setAttribute('aria-checked', String(state.profile.available));
  pill.setAttribute(
    'aria-label',
    state.profile.available
      ? 'Disponible, toca para dejar de recibir pedidos'
      : 'No disponible, toca para recibir pedidos'
  );
  $('driver-status-pill-label').textContent = state.profile.available ? 'Disponible' : 'No disponible';
}

function bindProfileEvents() {
  $('btn-driver-save-profile').addEventListener('click', async () => {
    const uid = state.currentUser?.uid;
    if (!uid) return;
    const name = $('driver-name').value.trim();
    const phone = $('driver-phone').value.trim();
    try {
      await update(ref(db, `drivers/${uid}`), { name, phone });
      await syncActiveOrdersDriverInfo(uid, name, phone);
      showToast('Datos guardados');
    } catch (err) {
      showToast(err.message || 'No se pudo guardar');
    }
  });

  $('btn-driver-change-password').addEventListener('click', async () => {
    const currentPassword = $('driver-current-password').value;
    const newPassword = $('driver-new-password').value;
    if (!currentPassword || !newPassword) {
      showToast('Completa las dos contraseñas');
      return;
    }
    if (newPassword.length < 6) {
      showToast('La nueva contraseña debe tener mínimo 6 caracteres');
      return;
    }
    const btn = $('btn-driver-change-password');
    btn.disabled = true;
    try {
      await authApi.changePassword(currentPassword, newPassword);
      $('driver-current-password').value = '';
      $('driver-new-password').value = '';
      showToast('Contraseña actualizada');
    } catch (err) {
      showToast(err.message || 'No se pudo cambiar la contraseña');
    } finally {
      btn.disabled = false;
    }
  });

  $('driver-status-pill').addEventListener('click', async () => {
    const uid = state.currentUser?.uid;
    if (!uid) return;
    const next = !state.profile.available;
    try {
      await update(ref(db, `drivers/${uid}`), { available: next });
      showToast(next ? 'Ahora estás disponible' : 'Ya no estás disponible');
    } catch (err) {
      showToast(err.message || 'No se pudo actualizar');
    }
  });

  $('btn-driver-enable-push').addEventListener('click', handleEnablePush);

  $('btn-driver-close-shift').addEventListener('click', handleCloseShift);
}

/* Antes, editar el nombre/teléfono acá no tocaba los pedidos donde ya
   quedó denormalizado (orders/{id}/driverName-driverPhone, copiados
   una sola vez por admin.js al asignar) — un cliente o el panel
   seguían viendo el dato viejo hasta que un admin reasignaba a mano.
   Se corrige parcheando, con un solo update() multi-path, cualquier
   pedido de este domiciliario que todavía no esté en un estado
   terminal (puede haber varios a la vez). */
async function syncActiveOrdersDriverInfo(uid, name, phone) {
  const patches = {};
  state.orders
    .filter((o) => o.driverId === uid && !['entregado', 'cancelado', 'no_entregado'].includes(o.status))
    .forEach((o) => {
      patches[`orders/${o.id}/driverName`] = name;
      patches[`orders/${o.id}/driverPhone`] = phone;
    });
  if (Object.keys(patches).length > 0) await update(ref(db), patches);
}

/* ---------- Cajón de cuenta (perfil / seguridad / cierre de turno) ----------
   Mismo patrón que ui.toggleSheet() en la app de clientes (driver.js
   no importa ui.js — son apps separadas — así que se repite acá en
   vez de compartirlo). */
function openAccountDrawer() {
  const drawer = $('account-drawer');
  drawer.hidden = false;
  requestAnimationFrame(() => drawer.classList.add('is-open'));
  $('overlay').classList.add('is-open');
}

function closeAccountDrawer() {
  const drawer = $('account-drawer');
  if (!drawer || drawer.hidden) return;
  drawer.classList.remove('is-open');
  $('overlay')?.classList.remove('is-open');
  setTimeout(() => {
    drawer.hidden = true;
  }, 250);
}

function bindAccountDrawerEvents() {
  $('btn-driver-account').addEventListener('click', openAccountDrawer);
  $('btn-close-account-drawer').addEventListener('click', closeAccountDrawer);
  $('overlay').addEventListener('click', closeAccountDrawer);
}

/* ---------- Cierre de turno / rendición de efectivo ----------
   Como no hay pasarela de pago activa, todo pedido a domicilio se
   paga en efectivo contra-entrega — lo que el domiciliario debería
   tener encima es la suma de lo que ha entregado y todavía no ha
   "rendido" (order.cashSettled). Al cerrar turno, se marcan esos
   pedidos como rendidos y se guarda un registro en
   cashSettlements/{id} para que el dueño lo revise en el panel. */
function unsettledDeliveredOrders() {
  return state.orders.filter((o) => o.status === 'entregado' && !o.cashSettled);
}

// Lo pagado en línea ya llegó a la cuenta del negocio: no se rinde en efectivo.
function efectivoEsperado(pedidos) {
  return pedidos.reduce((sum, o) => sum + (o.metodoPago === 'en_linea' ? 0 : o.total || 0), 0);
}

function renderCashCard() {
  const summary = $('driver-cash-summary');
  const field = $('driver-cash-field');
  const btn = $('btn-driver-close-shift');

  // Un domiciliario puede llevar varios pedidos a la vez — no tiene
  // sentido dejarlo cerrar turno (y quedar "no disponible") mientras
  // todavía tiene una entrega en camino/llegando. Antes esto no se
  // revisaba en absoluto.
  const active = activeDeliveries();
  if (active.length > 0) {
    summary.innerHTML = `Tienes ${active.length} entrega${active.length === 1 ? '' : 's'} en curso — termínala${active.length === 1 ? '' : 's'} antes de cerrar turno.`;
    field.hidden = true;
    btn.disabled = true;
    return;
  }

  const pending = unsettledDeliveredOrders();
  const expected = efectivoEsperado(pending);

  if (pending.length === 0) {
    summary.innerHTML = 'Sin pedidos pendientes por rendir.';
    field.hidden = true;
    btn.disabled = true;
    return;
  }
  summary.innerHTML = `Debes tener en efectivo: <strong>${formatCOP(expected)}</strong> (${pending.length} pedido${pending.length === 1 ? '' : 's'} entregado${pending.length === 1 ? '' : 's'} sin rendir).`;
  field.hidden = false;
  btn.disabled = false;
}

/* Historial de cierres propios — antes solo se podía consultar
   pidiéndoselo al dueño; ahora cada domiciliario ve sus últimos
   cierres con la misma query por driverId que ya usa "orders". */
function subscribeCashHistory(uid) {
  return onValue(
    query(ref(db, 'cashSettlements'), orderByChild('driverId'), equalTo(uid)),
    (snapshot) => {
      const value = snapshot.val() || {};
      const settlements = Object.values(value).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
      renderCashHistory(settlements);
    },
    logOnValueError('driver:cashHistory')
  );
}

function renderCashHistory(settlements) {
  const container = $('driver-cash-history-list');
  if (!container) return;
  if (settlements.length === 0) {
    container.innerHTML = `<p class="admin-hint">Sin cierres registrados todavía.</p>`;
    return;
  }
  container.innerHTML = settlements
    .map((s) => {
      const diff = s.difference || 0;
      const diffLabel = diff === 0 ? 'cuadrado' : diff > 0 ? `${formatCOP(diff)} de más` : `${formatCOP(Math.abs(diff))} de menos`;
      const time = s.closedAt ? new Date(s.closedAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '';
      return `<div class="driver-cash-history-row">${time} — <strong>${formatCOP(s.actualCash || 0)}</strong> entregados (${diffLabel}), ${s.ordersCount || 0} pedidos</div>`;
    })
    .join('');
}

async function handleCloseShift() {
  const uid = state.currentUser?.uid;
  if (!uid) return;
  // Defensa extra por si el botón quedó habilitado por una carrera de
  // repintados — renderCashCard() ya debería haberlo deshabilitado.
  if (activeDeliveries().length > 0) {
    showToast('Termina tus entregas en curso antes de cerrar turno');
    return;
  }
  const pending = unsettledDeliveredOrders();
  if (pending.length === 0) return;
  const expected = efectivoEsperado(pending);
  const actualRaw = $('driver-cash-actual').value;
  const actual = Number(actualRaw);
  if (actualRaw === '' || Number.isNaN(actual) || actual < 0) {
    showToast('Escribe cuánto efectivo vas a entregar');
    return;
  }
  const difference = actual - expected;
  const ok = await confirmDialog(
    difference === 0
      ? `Vas a rendir ${formatCOP(actual)}, exacto a lo esperado. ¿Confirmar cierre de turno?`
      : `Vas a rendir ${formatCOP(actual)} (esperado ${formatCOP(expected)}, diferencia ${formatCOP(Math.abs(difference))} ${difference > 0 ? 'de más' : 'de menos'}). ¿Confirmar cierre de turno?`,
    { confirmLabel: 'Sí, cerrar turno', cancelLabel: 'Revisar' }
  );
  if (!ok) return;

  // Mismo remate "premium" que el checkout del cliente: spinner
  // mientras confirma contra Firebase, check verde antes de limpiar
  // el formulario — este botón (a diferencia de los de la lista de
  // pedidos) se queda en pantalla después de la acción, así que el
  // check sí llega a verse completo. `renderCashCard` (llamada por la
  // suscripción en vivo a `orders` apenas confirma el cierre) solo
  // toca `disabled`, nunca el texto — por eso es seguro restaurar la
  // etiqueta original en el `finally` sin pelear contra ese repintado.
  const btn = $('btn-driver-close-shift');
  const btnLabel = btn.textContent;
  btn.classList.add('is-loading');
  try {
    const updates = {};
    pending.forEach((o) => {
      updates[`orders/${o.id}/cashSettled`] = true;
    });
    await update(ref(db), updates);
    await push(ref(db, 'cashSettlements'), {
      driverId: uid,
      driverName: state.profile.name || state.currentUser?.email || 'domiciliario',
      expectedCash: expected,
      actualCash: actual,
      difference,
      ordersCount: pending.length,
      closedAt: serverTimestamp(),
    });
    await update(ref(db, `drivers/${uid}`), { available: false });
    $('driver-cash-actual').value = '';

    btn.classList.remove('is-loading');
    btn.classList.add('is-success');
    btn.textContent = '¡Turno cerrado!';
    await new Promise((resolve) => setTimeout(resolve, 650));

    showToast('Cierre de turno guardado. ¡Buen trabajo!');
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el cierre de turno');
  } finally {
    btn.classList.remove('is-loading', 'is-success');
    btn.textContent = btnLabel;
  }
}

/* Antes vivía dentro de la tarjeta de perfil con un <span> de texto al
   lado ("Activar avisos de pedidos nuevos" / "Avisos activados" / …) —
   ahora es un ícono suelto en el header (junto a "Cerrar sesión"), sin
   espacio para texto, así que el estado se comunica con `aria-label`/
   `title` (accesible igual) y la clase `is-enabled` (color del ícono). */
async function updatePushButtonState() {
  const btn = $('btn-driver-enable-push');
  const supported = await notifications.isPushSupported();
  if (!supported) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  const permission = notifications.getPermissionState();
  if (permission === 'granted') {
    btn.classList.add('is-enabled');
    btn.disabled = true;
    btn.title = 'Avisos activados';
    btn.setAttribute('aria-label', 'Avisos de pedidos activados');
  } else if (permission === 'denied') {
    btn.classList.remove('is-enabled');
    btn.disabled = true;
    btn.title = 'Avisos bloqueados — actívalos desde el navegador';
    btn.setAttribute('aria-label', 'Avisos bloqueados — actívalos desde el navegador');
  } else {
    btn.classList.remove('is-enabled');
    btn.disabled = false;
    btn.title = 'Activar avisos de pedidos nuevos';
    btn.setAttribute('aria-label', 'Activar avisos de pedidos nuevos');
  }
}

async function handleEnablePush() {
  const btn = $('btn-driver-enable-push');
  btn.disabled = true;
  try {
    await notifications.enablePushNotifications('drivers');
    showToast('¡Avisos activados!');
  } catch (err) {
    showToast(err.message || 'No se pudieron activar los avisos');
  } finally {
    updatePushButtonState();
  }
}

/* ---------- Pedidos asignados ---------- */
// Subtítulo bajo el saludo según la pestaña (rediseño 2026-10-24).
const TAB_SUBTITLES = {
  recoger: 'Aquí puedes ver y gestionar tus entregas asignadas.',
  camino: 'Gestiona tus entregas en curso.',
  historial: 'Consulta el historial de tus entregas.',
};

function bindTabEvents() {
  document.querySelectorAll('#driver-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      document.querySelectorAll('#driver-tabs button').forEach((b) => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      if (state.filter === 'recoger') {
        state.newCount = 0;
        updateBadge();
      }
      const sub = $('driver-greeting-sub');
      if (sub) sub.textContent = TAB_SUBTITLES[state.filter] || '';
      renderOrders();
    });
  });

  // Buscador de la pestaña actual (solo filtra lo que se ve).
  $('driver-orders-search')?.addEventListener('input', (e) => {
    state.ordersSearch = e.target.value;
    renderOrders();
  });

  // Logo del header -> "Inicio" (Para recoger), mismo patrón que
  // #btn-brand-home en la tienda de clientes y en el panel de admin.
  const brandHome = $('btn-brand-home');
  if (brandHome) {
    const goHome = () => {
      document.querySelector('#driver-tabs button[data-filter="recoger"]')?.click();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    brandHome.addEventListener('click', goHome);
    brandHome.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goHome();
      }
    });
  }
}

/* Repinta la lista agrupando ráfagas cercanas en una sola — mismo
   problema y misma solución que admin.js (scheduleRenderOrders): cada
   ~10s con una entrega en curso, el propio GPS de este domiciliario
   reescribe driverLocation/driverTrail en "orders" (ver watchPosition
   más abajo), lo que vuelve a disparar ESTE MISMO onValue. Sin agrupar,
   toda la lista de pedidos se reconstruía por completo (innerHTML +
   reenganchar cada botón) cada 10 segundos mientras se hacía una
   entrega — el "se demora mucho" más probable de esta app. */
let renderOrdersTimer = null;
function scheduleRenderOrders() {
  if (renderOrdersTimer) return;
  renderOrdersTimer = setTimeout(() => {
    renderOrdersTimer = null;
    renderOrders();
  }, 400);
}

// Acotado — antes no tenía límite y un domiciliario con meses de
// antigüedad iba a ir descargando su historial completo de pedidos en
// cada inicio de sesión (antes de que el HISTORY_LIMIT de renderHistory
// recortara lo que se muestra, ya se había bajado todo igual).
const DRIVER_ORDERS_QUERY_LIMIT = 200;

function subscribeOrders(uid) {
  const ordersQuery = query(
    ref(db, 'orders'),
    orderByChild('driverId'),
    equalTo(uid),
    limitToLast(DRIVER_ORDERS_QUERY_LIMIT)
  );
  unsubOrders = onValue(
    ordersQuery,
    (snapshot) => {
    const value = snapshot.val() || {};
    const orders = Object.entries(value).map(([id, data]) => ({ id, ...data }));

    if (hasLoadedOrdersOnce) {
      const newOnes = orders.filter(
        (o) => !state.seenOrderIds.has(o.id) && ['recibido', 'enviado', 'preparacion', 'listo'].includes(o.status || 'recibido')
      );
      if (newOnes.length > 0) {
        newOnes.forEach((o) => state.seenOrderIds.add(o.id));
        saveSeenOrderIds(state.seenOrderIds);
        state.newCount += newOnes.length;
        updateBadge();
        playNewOrderSound();
        showToast(newOnes.length === 1 ? 'Te asignaron un pedido nuevo para recoger' : `Te asignaron ${newOnes.length} pedidos nuevos`);
      }
    } else {
      orders.forEach((o) => state.seenOrderIds.add(o.id));
      saveSeenOrderIds(state.seenOrderIds);
      hasLoadedOrdersOnce = true;
    }

    state.orders = orders.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    resumeTrackingIfNeeded();
    scheduleRenderOrders();
    },
    logOnValueError('driver:orders')
  );
}

function activeDeliveries() {
  // "llegado" sigue siendo una entrega en curso: el domi sigue con el
  // pedido y sigue compartiendo su ubicación hasta marcar "Entregado".
  return state.orders.filter((o) => ['en_camino', 'llegado'].includes(o.status));
}

// Distancia en metros entre dos {lat,lng} (Haversine) — para el geofence
// de "llegado". No necesita precisión de topógrafo, solo saber si el domi
// ya está a ~una cuadra del destino.
function distanciaMetros(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad((b.lng ?? b.lon) - (a.lng ?? a.lon));
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Destino contra el cual medir: la ubicación exacta que compartió el
// cliente si existe, o la que geocodificó caja al confirmar (destinoCoords).
function destinoDe(order) {
  if (order.customerLocation && order.customerLocation.lat != null) return order.customerLocation;
  if (order.destinoCoords && order.destinoCoords.lat != null) return order.destinoCoords;
  return null;
}

// Repetido en cada acción sobre un pedido (recoger/entregar/no
// entregado/llegado/devolver) — quién hizo el cambio, para el registro.
function driverEmail() {
  return state.currentUser?.email || 'domiciliario';
}

// Registro en orders/{id}/statusHistory — mismo patrón repetido 6 veces
// en las acciones de esta app (recoger, entregar, no entregado, llegado,
// devolver asignación); nunca bloquea la acción si falla (.catch vacío,
// es solo un registro histórico, ver comentario en tienda/CLAUDE.md).
function pushStatusHistory(orderId, status, note) {
  return push(ref(db, `orders/${orderId}/statusHistory`), {
    status,
    byEmail: driverEmail(),
    at: serverTimestamp(),
    ...(note ? { note } : {}),
  }).catch(() => {});
}

/* Marca un pedido como "llegado" (una sola vez). Lo llama el geofence del
   GPS automáticamente, y el botón "Llegué" manualmente. No corta el
   rastreo — eso pasa recién con "Entregado". */
async function marcarLlegado(orderId, auto) {
  if (llegadoMarcado[orderId]) return;
  const order = state.orders.find((o) => o.id === orderId);
  if (!order || order.status !== 'en_camino') return;
  llegadoMarcado[orderId] = true;
  try {
    await update(ref(db, `orders/${orderId}`), { status: 'llegado', rondaEstados: { 1: 'llegado' }, tsCambio: Date.now() });
    pushStatusHistory(orderId, 'llegado', auto ? 'automático por GPS' : 'manual');
    if (auto) showToast('Estás llegando al destino — marca "Entregado" cuando entregues el pedido');
  } catch (err) {
    llegadoMarcado[orderId] = false;
    if (!auto) showToast(err.message || 'No se pudo actualizar el pedido');
  }
}

/* Si la app se cerró/recargó mientras algún pedido seguía "en
   camino", retoma el envío de ubicación solo — el domiciliario no
   tiene que presionar nada de nuevo. Si ya no queda ningún pedido en
   camino asignado a él (los entregó todos, se los reasignaron,
   etc.), apaga el rastreo del todo. */
function resumeTrackingIfNeeded() {
  const hasActive = activeDeliveries().length > 0;
  if (hasActive && geoWatchId === null) {
    startTracking();
  } else if (!hasActive && geoWatchId !== null) {
    stopTracking();
  }
}

function ordersForFilter() {
  if (state.filter === 'recoger') {
    return state.orders.filter((o) => ['recibido', 'enviado', 'preparacion', 'listo'].includes(o.status || 'recibido'));
  }
  if (state.filter === 'camino') {
    return state.orders.filter((o) => ['en_camino', 'llegado'].includes(o.status));
  }
  return state.orders
    .filter((o) => ['entregado', 'cancelado', 'no_entregado'].includes(o.status))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, HISTORY_LIMIT);
}

/* Números reales del día — no hay nada inventado, se calculan de
   los mismos pedidos que ya trae la suscripción por driverId. */
function renderQuickStats() {
  const el = $('driver-quick-stats');
  if (!el) return;

  const startToday = inicioDiaCO();
  const deliveredTodayOrders = state.orders.filter(
    (o) => o.status === 'entregado' && (o.createdAt || 0) >= startToday
  );
  const deliveredToday = deliveredTodayOrders.length;
  const pending = state.orders.filter((o) => ['recibido', 'enviado', 'preparacion', 'listo', 'en_camino', 'llegado'].includes(o.status || 'recibido')).length;
  const tipsToday = deliveredTodayOrders.reduce((sum, o) => sum + (o.tipAmount || 0), 0);
  // Rediseño 2026-10-24: comparación con ayer y total de la semana,
  // de los mismos pedidos (últimos 200 de este domiciliario).
  const startYesterday = startToday - 86400000;
  const startWeek = startToday - 6 * 86400000;
  const deliveredYesterday = state.orders.filter(
    (o) => o.status === 'entregado' && (o.createdAt || 0) >= startYesterday && (o.createdAt || 0) < startToday
  ).length;
  const deliveredWeek = state.orders.filter((o) => o.status === 'entregado' && (o.createdAt || 0) >= startWeek).length;
  const diff = deliveredToday - deliveredYesterday;
  const trend =
    diff > 0 ? `<span class="driver-stat-trend is-up">↑ ${diff} más que ayer</span>`
    : diff < 0 ? `<span class="driver-stat-trend">${Math.abs(diff)} menos que ayer</span>`
    : `<span class="driver-stat-trend">Igual que ayer</span>`;
  const icon = (path) => `<span class="driver-stat-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`;

  el.innerHTML = `
    <div class="driver-quick-stat is-red">
      ${icon('<path d="M20 7L9 18l-5-5"/>')}
      <div><span class="driver-quick-stat-value">${deliveredToday}</span><span class="driver-quick-stat-label">Entregados hoy</span>${trend}</div>
    </div>
    <div class="driver-quick-stat is-amber">
      ${icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')}
      <div><span class="driver-quick-stat-value">${pending}</span><span class="driver-quick-stat-label">Pendientes</span><span class="driver-stat-trend">Asignados a ti</span></div>
    </div>
    <div class="driver-quick-stat is-green">
      ${icon('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>')}
      <div><span class="driver-quick-stat-value">${formatCOP(tipsToday)}</span><span class="driver-quick-stat-label">Propinas hoy</span><span class="driver-stat-trend">De tus entregas</span></div>
    </div>
    <div class="driver-quick-stat is-blue">
      ${icon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>')}
      <div><span class="driver-quick-stat-value">${deliveredWeek}</span><span class="driver-quick-stat-label">Entregas</span><span class="driver-stat-trend">Últimos 7 días</span></div>
    </div>
  `;

  const count = (id, n) => {
    const c = $(id);
    if (c) {
      c.textContent = String(n);
      c.hidden = n === 0;
    }
  };
  count('driver-count-recoger', state.orders.filter((o) => ['recibido', 'enviado', 'preparacion', 'listo'].includes(o.status || 'recibido')).length);
  count('driver-count-camino', activeDeliveries().length);
}

/* Buscador (rediseño 2026-10-24): cliente, dirección, código o
   producto, sin acentos ni mayúsculas. */
function applyOrdersSearch(orders) {
  const term = normalizeText(state.ordersSearch);
  if (!term) return orders;
  return orders.filter((o) =>
    normalizeText(
      `${o.customerName || ''} ${o.address || ''} ${o.codigo || ''} ${(o.items || []).map((i) => i.name).join(' ')}`
    ).includes(term)
  );
}

function updateBadge() {
  const badge = $('driver-badge-recoger');
  badge.hidden = state.newCount === 0;
  badge.textContent = state.newCount > 9 ? '9+' : String(state.newCount);
}

function renderOrders() {
  renderQuickStats();
  renderCashCard();
  const container = $('driver-orders-list');
  const all = ordersForFilter();
  const orders = applyOrdersSearch(all);
  container.dataset.view = state.filter;

  if (orders.length === 0) {
    const emptyMsg = all.length
      ? { title: 'Ningún pedido coincide con la búsqueda', text: 'Prueba con otro nombre, dirección o producto.' }
      : {
          recoger: { title: 'No tienes pedidos para recoger', text: 'Cuando te asignen uno, aparecerá aquí con aviso y sonido.' },
          camino: { title: 'No tienes pedidos en camino', text: 'Al recoger un pedido, pasa a esta pestaña.' },
          historial: { title: 'Todavía no hay entregas', text: 'Aquí verás tus pedidos entregados, cancelados o no entregados.' },
        }[state.filter];
    container.innerHTML = `<div class="driver-empty"><strong>${emptyMsg.title}</strong><span>${emptyMsg.text}</span></div>`;
    return;
  }

  const multiHint =
    state.filter === 'camino' && orders.length > 1
      ? `<p class="driver-multi-hint">Llevas ${orders.length} pedidos activos por la misma ruta — tu ubicación se comparte con los ${orders.length}.</p>`
      : '';

  if (state.filter === 'historial') {
    container.innerHTML = renderHistoryList(orders);
    return;
  }
  container.innerHTML = multiHint + orders.map((order) => renderOrderCard(order)).join('');
}

/* Un solo listener delegado, enganchado UNA vez (ver init()) en vez de
   re-buscar y re-enganchar 5 grupos de botones en cada repintado —
   mismo criterio que bindOrdersListEvents en admin.js. */
function bindOrdersListEvents() {
  const container = $('driver-orders-list');
  if (!container) return;
  container.addEventListener('click', (e) => {
    const pickupBtn = e.target.closest('.driver-pickup-btn');
    if (pickupBtn) return handlePickup(pickupBtn.dataset.orderId, pickupBtn);

    const deliverBtn = e.target.closest('.driver-deliver-btn');
    if (deliverBtn) return handleDeliver(deliverBtn.dataset.orderId, deliverBtn);

    const arrivedBtn = e.target.closest('.driver-arrived-btn');
    if (arrivedBtn) {
      arrivedBtn.classList.add('is-loading');
      marcarLlegado(arrivedBtn.dataset.orderId, false).finally(() => arrivedBtn.classList.remove('is-loading'));
      return;
    }

    const failBtn = e.target.closest('.driver-fail-btn');
    if (failBtn) return handleDeliveryFailed(failBtn.dataset.orderId, failBtn);

    const rejectBtn = e.target.closest('.driver-reject-btn');
    if (rejectBtn) return handleRejectAssignment(rejectBtn.dataset.orderId, rejectBtn);
  });
}

/* Tarjeta de pedido (rediseño 2026-10-24, con referencias del usuario).
   Los botones de acción conservan sus clases y data-order-id — el
   listener delegado de bindOrdersListEvents() no cambia. */
const PIN_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0112 2.5a7 7 0 017 7C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const PHONE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"/></svg>';
const MAP_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zM8 2v16M16 6v16"/></svg>';

function orderCodeOf(order) {
  return order.codigo || '#' + (order.id || '').replace(/[^A-Za-z0-9]/g, '').slice(-5).toUpperCase();
}

function mapsUrlOf(order) {
  // Si el cliente compartió su ubicación exacta al hacer el pedido
  // (botón "usar mi ubicación" en el checkout), navega directo a esas
  // coordenadas — más preciso que la dirección escrita a mano.
  const destination = order.customerLocation
    ? `${order.customerLocation.lat},${order.customerLocation.lng}`
    : order.address || 'sin dirección';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/* Línea de tiempo con las horas reales de statusHistory (lo mismo que
   ya se guarda en cada acción): confirmado → recogido → llegó → entregado. */
function renderTimeline(order) {
  const history = order.statusHistory ? Object.values(order.statusHistory) : [];
  const firstAt = (...ids) => {
    const hit = history.filter((h) => ids.includes(h.status) && h.at).sort((a, b) => a.at - b.at)[0];
    return hit ? hit.at : null;
  };
  const status = order.status || 'recibido';
  const order4 = ['confirmado', 'en_camino', 'llegado', 'entregado'];
  const reached = {
    confirmado: true,
    en_camino: ['en_camino', 'llegado', 'entregado', 'no_entregado'].includes(status),
    llegado: ['llegado', 'entregado'].includes(status),
    entregado: status === 'entregado',
  };
  const steps = [
    { id: 'confirmado', label: 'Pedido confirmado', at: firstAt('enviado') || order.createdAt },
    { id: 'en_camino', label: 'Recogido · en camino', at: firstAt('en_camino') },
    { id: 'llegado', label: 'Llegando al destino', at: firstAt('llegado') },
    { id: 'entregado', label: 'Entregado', at: firstAt('entregado') },
  ];
  const current = [...order4].reverse().find((id) => reached[id]);
  return `<ol class="driver-timeline">${steps
    .map(
      (s) => `<li class="${reached[s.id] ? 'is-done' : ''}${s.id === current && status !== 'entregado' ? ' is-current' : ''}">
        <span class="driver-timeline-dot" aria-hidden="true"></span>
        <span><strong>${s.label}</strong><small>${reached[s.id] && s.at ? fmtHoraCO(s.at) : '—'}</small></span>
      </li>`
    )
    .join('')}</ol>`;
}

function renderOrderCard(order) {
  const status = order.status || 'recibido';
  const items = order.items || [];
  const itemsListHtml = items
    .map(
      (item) => `
      <div class="driver-order-item-row">
        ${
          item.image
            ? `<img class="driver-order-item-thumb" src="${escapeHtml(urlFoto(item.image))}" alt="" onerror="this.style.visibility='hidden'" />`
            : `<span class="driver-order-item-thumb driver-order-item-thumb-empty"></span>`
        }
        <span>${item.qty}× ${escapeHtml(item.name)}${item.notes ? `<em>${escapeHtml(item.notes)}</em>` : ''}</span>
      </div>`
    )
    .join('');
  const phoneDigits = (order.phone || '').replace(/[^\d+]/g, '');
  const address = order.address || 'sin dirección';
  const mapsUrl = mapsUrlOf(order);
  const isTracking = ['en_camino', 'llegado'].includes(status) && geoWatchId !== null;
  const isEnCurso = ['en_camino', 'llegado'].includes(status);
  const minutes = order.createdAt ? Math.floor((Date.now() - order.createdAt) / 60000) : 0;
  const ageTone = order.scheduledFor ? 'is-scheduled' : minutes >= 60 ? 'is-old' : minutes >= 30 ? 'is-warn' : 'is-new';
  const chip = order.scheduledFor
    ? `<span class="driver-order-chip ${ageTone}">Programado ${fmtHoraCO(order.scheduledFor)}</span>`
    : `<span class="driver-order-chip ${ageTone}">${timeAgo(order.createdAt)}</span>`;
  const paidOnline = order.metodoPago === 'en_linea';

  let actionHtml = '';
  if (['recibido', 'enviado', 'preparacion', 'listo'].includes(status)) {
    actionHtml = `
      <button type="button" class="driver-primary-btn driver-pickup-btn" data-order-id="${order.id}">Recogí el pedido — salir a domicilio</button>
      <button type="button" class="driver-secondary-btn driver-reject-btn" data-order-id="${order.id}">No puedo tomar este pedido</button>`;
  } else if (isEnCurso) {
    const llegoChip =
      status === 'llegado'
        ? `<div class="driver-tracking-indicator"><span class="driver-tracking-dot"></span> Llegaste al destino — entrega el pedido y marca "Entregado"</div>`
        : '';
    const btnLlegue =
      status === 'en_camino'
        ? `<button type="button" class="driver-secondary-btn driver-arrived-btn" data-order-id="${order.id}">Llegué al destino</button>`
        : '';
    actionHtml = `
      <button type="button" class="driver-primary-btn driver-deliver-btn" data-order-id="${order.id}">Marcar como entregado</button>
      <div class="driver-secondary-row">
        ${btnLlegue}
        <button type="button" class="driver-secondary-btn driver-fail-btn" data-order-id="${order.id}">No se pudo entregar</button>
      </div>
      ${llegoChip}
      ${
        isTracking
          ? `<div class="driver-tracking-indicator"><span class="driver-tracking-dot"></span> Compartiendo tu ubicación en vivo</div>`
          : `<div class="driver-tracking-indicator is-off">Activa tu ubicación para compartirla con el cliente</div>`
      }`;
  }

  return `
    <article class="driver-order${isTracking ? ' is-tracking' : ''}${isEnCurso ? ' is-en-curso' : ''}">
      <header class="driver-order-head">
        ${isEnCurso ? `<span class="driver-order-status">${status === 'llegado' ? 'Llegando' : 'En camino'}</span>` : chip}
        <span class="driver-order-code">${escapeHtml(orderCodeOf(order))}</span>
        ${isEnCurso ? `<span class="driver-order-age">${timeAgo(order.createdAt)}</span>` : ''}
        <span class="driver-order-total">
          <span class="price">${formatCOP(order.total || 0)}</span>
          ${paidOnline ? '<span class="driver-paid-chip">Pagado en línea · no cobrar</span>' : ''}
        </span>
      </header>
      <div class="driver-order-main">
        ${isEnCurso ? renderTimeline(order) : ''}
        <div class="driver-order-info">
          <span class="driver-order-customer">${escapeHtml(order.customerName || 'Cliente')}</span>
          ${phoneDigits && isEnCurso ? `<span class="driver-order-phone">${PHONE_SVG}${escapeHtml(order.phone)}</span>` : ''}
          <div class="driver-order-address">${PIN_SVG}<span>${escapeHtml(address)}${order.reference ? ' · ' + escapeHtml(order.reference) : ''}${order.customerLocation ? ' <span class="driver-precise-badge">Ubicación exacta</span>' : ''}</span></div>
          <div class="driver-order-items">${itemsListHtml}</div>
          ${order.internalNote ? `<div class="driver-order-note">Nota del restaurante: ${escapeHtml(order.internalNote)}</div>` : ''}
        </div>
      </div>
      <div class="driver-order-actions">
        ${phoneDigits ? `<a class="driver-action-btn driver-call-btn" href="tel:${phoneDigits}">${PHONE_SVG}Llamar cliente</a>` : ''}
        <a class="driver-action-btn driver-map-btn" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">${MAP_SVG}Abrir en Maps</a>
      </div>
      ${actionHtml}
    </article>
  `;
}

/* Historial (rediseño 2026-10-24): filas compactas tipo tabla; al
   tocar una se despliega el detalle (productos, horas, dirección). */
function renderHistoryList(orders) {
  const statusChip = (s, reason) =>
    s === 'entregado'
      ? '<span class="driver-hist-status is-ok">Entregado</span>'
      : s === 'cancelado'
        ? '<span class="driver-hist-status is-bad">Cancelado</span>'
        : `<span class="driver-hist-status is-warn" title="${escapeHtml(reason || '')}">No entregado</span>`;
  const initials = (name) =>
    escapeHtml(
      (name || 'Cliente')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0] || '')
        .join('')
        .toUpperCase()
    );
  return `
    <div class="driver-history">
      <div class="driver-hist-row driver-hist-head" aria-hidden="true">
        <span>Pedido</span><span>Cliente</span><span>Dirección</span><span>Total</span><span>Estado</span><span>Fecha</span>
      </div>
      ${orders
        .map((o) => {
          const s = o.status || 'recibido';
          return `
      <details class="driver-hist-item">
        <summary class="driver-hist-row">
          <span class="driver-hist-code">${escapeHtml(orderCodeOf(o))}</span>
          <span class="driver-hist-customer"><span class="driver-hist-avatar" aria-hidden="true">${initials(o.customerName)}</span>${escapeHtml(o.customerName || 'Cliente')}</span>
          <span class="driver-hist-address">${escapeHtml(o.address || '—')}</span>
          <span class="driver-hist-total">${formatCOP(o.total || 0)}</span>
          ${statusChip(s, o.deliveryFailureReason)}
          <span class="driver-hist-date">${o.createdAt ? `${fmtFechaCO(o.createdAt, { day: '2-digit', month: '2-digit' })} · ${fmtHoraCO(o.createdAt)}` : '—'}</span>
        </summary>
        <div class="driver-hist-detail">
          ${s === 'no_entregado' && o.deliveryFailureReason ? `<p class="driver-hist-reason">Motivo: ${escapeHtml(o.deliveryFailureReason)}</p>` : ''}
          ${s === 'cancelado' ? '' : renderTimeline(o)}
          <div class="driver-hist-products">
            ${(o.items || []).map((i) => `<div><span>${i.qty}× ${escapeHtml(i.name)}</span>${i.price ? `<span>${formatCOP(i.price * (i.qty || 1))}</span>` : ''}</div>`).join('')}
            ${o.tipAmount ? `<div class="is-tip"><span>Propina</span><span>${formatCOP(o.tipAmount)}</span></div>` : ''}
          </div>
          <p class="driver-hist-full-address">${PIN_SVG}<span>${escapeHtml(o.address || '—')}${o.reference ? ' · ' + escapeHtml(o.reference) : ''}</span></p>
        </div>
      </details>`;
        })
        .join('')}
    </div>`;
}

/* ---------- Acciones sobre un pedido ---------- */
async function handlePickup(orderId, btn) {
  // Solo el spinner de carga (sin el check de éxito de "Cerrar
  // turno"/checkout del cliente) — la tarjeta cambia de pestaña y
  // desaparece de esta lista apenas confirma Firebase, así que un
  // check con su propia pausa nunca llegaría a verse completo; el
  // spinner igual evita el doble toque mientras se confirma.
  btn?.classList.add('is-loading');
  try {
    const prev = (state.orders.find((o) => o.id === orderId) || {}).status || 'recibido';
    // El domi recogiendo el pedido ES la señal de que salió de cocina:
    // "listo" implícito + "en camino" en un solo toque. rondaEstados se
    // sincroniza para que panel-cocina no lo deje pegado en el tablero.
    await update(ref(db, `orders/${orderId}`), {
      status: 'en_camino',
      rondaEstados: { 1: 'en_camino' },
      tsCambio: Date.now(),
    });
    if (prev !== 'listo') {
      pushStatusHistory(orderId, 'listo', 'implícito al recoger');
    }
    pushStatusHistory(orderId, 'en_camino');
    // Sin contar este pedido: el SDK aplica la escritura local ANTES de que
    // el await termine, así que state.orders ya lo trae como en_camino (antes
    // se contaba dos veces: "llevas 2 pedidos activos" con uno solo).
    const otherActive = activeDeliveries().filter((o) => o.id !== orderId).length;
    showToast(
      otherActive > 0
        ? `Pedido en camino — llevas ${otherActive + 1} pedidos activos`
        : 'Pedido en camino — compartiendo tu ubicación'
    );
    startTracking();
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar el pedido');
    btn?.classList.remove('is-loading');
  }
}

/* Al entregar: además de cambiar el estado, se borra driverLocation
   y driverTrail de ESE pedido — así deja de compartirse su ubicación
   con ese cliente y con el panel de inmediato, sin depender solo de
   que la UI oculte una posición vieja. Los demás pedidos que siga
   llevando el domiciliario no se ven afectados. Antes de guardar se
   pregunta si le dieron propina (opcional, un toque para saltarla). */
async function finalizeDelivery(orderId, tipAmount, btn) {
  btn?.classList.add('is-loading');
  try {
    await update(ref(db, `orders/${orderId}`), {
      status: 'entregado',
      driverLocation: null,
      driverTrail: null,
      ...(tipAmount ? { tipAmount } : {}),
    });
    pushStatusHistory(orderId, 'entregado');
    showToast('¡Pedido entregado! Ya no compartes tu ubicación con ese cliente.');
    delete localTrails[orderId];
    delete llegadoMarcado[orderId];
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar el pedido');
    btn?.classList.remove('is-loading');
  }
}

async function handleDeliver(orderId, btn) {
  const tip = await promptNumberDialog('¿El cliente le dio propina? Escribe cuánto (opcional).', {
    skipLabel: 'Sin propina',
  });
  await finalizeDelivery(orderId, tip, btn);
}

const DELIVERY_FAILURE_REASONS = [
  'Cliente no contesta',
  'Dirección incorrecta o no la encontré',
  'Cliente rechazó el pedido',
  'Tuve un imprevisto y no puedo continuar (moto, accidente, etc.)',
  'Otro motivo',
];

/* Cuando de verdad no se puede entregar (cliente no contesta,
   dirección mala, etc.) — un estado aparte de "entregado" y de
   "cancelado" (ese lo cancela el cliente antes de que salga a
   la calle), para que el panel sepa que el pedido ya salió, no
   llegó a su destino, y necesita decidir qué hacer (reintentar
   con otro domiciliario, reembolsar, etc.). Igual que al
   entregar, se deja de compartir la ubicación de inmediato. */
async function handleDeliveryFailed(orderId, btn) {
  const reason = await pickReasonDialog('¿Por qué no se pudo entregar este pedido?', DELIVERY_FAILURE_REASONS);
  if (!reason) return;
  btn?.classList.add('is-loading');
  try {
    await update(ref(db, `orders/${orderId}`), {
      status: 'no_entregado',
      driverLocation: null,
      driverTrail: null,
      deliveryFailureReason: reason,
      deliveryFailureAt: serverTimestamp(),
    });
    pushStatusHistory(orderId, 'no_entregado', reason);
    showToast('Pedido marcado como no entregado — el panel decide qué sigue.');
    delete localTrails[orderId];
    delete llegadoMarcado[orderId];
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar el pedido');
    btn?.classList.remove('is-loading');
  }
}

/* El domiciliario devuelve una asignación que no puede tomar (le
   queda muy lejos, ya lleva demasiados pedidos, se le dañó la
   moto, etc.) — se desasigna el pedido (vuelve a "Sin asignar" en
   el panel) en vez de quedar atascado esperando a que alguien más
   se dé cuenta. Se deja un rastro en statusHistory con el motivo,
   para que el panel entienda por qué volvió a aparecer sin
   domiciliario. */
async function handleRejectAssignment(orderId, btn) {
  const ok = await confirmDialog('¿Devolver este pedido para que el panel lo asigne a otro domiciliario?', {
    confirmLabel: 'Sí, devolver',
    cancelLabel: 'Seguir con él',
  });
  if (!ok) return;
  btn?.classList.add('is-loading');
  try {
    const driverLabel = state.profile.name || driverEmail();
    await update(ref(db, `orders/${orderId}`), { driverId: null, driverName: null, driverPhone: null });
    const currentStatus = (state.orders.find((o) => o.id === orderId) || {}).status || 'recibido';
    pushStatusHistory(orderId, currentStatus, `${driverLabel} devolvió la asignación`);
    showToast('Pedido devuelto — ya no aparece en tu lista.');
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar el pedido');
    btn?.classList.remove('is-loading');
  }
}

/* ---------- Rastreo de ubicación en vivo ---------- */
/* Un solo watchPosition para todo el dispositivo — en cada posición
   nueva, la reparte entre TODOS los pedidos que sigan "en camino" en
   ese momento (se relee state.orders, no una lista fija), y va
   acumulando el recorrido de cada uno por separado. Así, si el
   domiciliario lleva dos pedidos por la misma ruta, ambos clientes
   (y el panel) ven la posición y el recorrido actualizarse juntos. */
function startTracking() {
  if (geoWatchId !== null) return; // ya está corriendo

  if (!navigator.geolocation) {
    showToast('Tu navegador no soporta compartir ubicación');
    return;
  }

  lastLocationWriteAt = 0;
  geoWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const now = Date.now();
      if (now - lastLocationWriteAt < LOCATION_MIN_INTERVAL_MS) return;
      lastLocationWriteAt = now;
      const { latitude, longitude } = position.coords;
      const point = { lat: latitude, lng: longitude, at: now };

      activeDeliveries().forEach((order) => {
        const trail = localTrails[order.id] || (localTrails[order.id] = []);
        trail.push(point);
        if (trail.length > TRAIL_MAX_POINTS) trail.splice(0, trail.length - TRAIL_MAX_POINTS);

        update(ref(db, `orders/${order.id}`), {
          driverLocation: { lat: latitude, lng: longitude, updatedAt: serverTimestamp() },
          driverTrail: trail,
        }).catch(() => {});

        // Geofence: si el pedido va "en_camino" y el domi entró en el
        // radio del destino, pasa solo a "llegado" (una vez).
        if (order.status === 'en_camino' && !llegadoMarcado[order.id]) {
          const dest = destinoDe(order);
          if (dest && distanciaMetros({ lat: latitude, lng: longitude }, dest) <= LLEGADA_RADIO_M) {
            marcarLlegado(order.id, true);
          }
        }
      });
    },
    () => {
      showToast('No pudimos acceder a tu ubicación — actívala para que el cliente pueda seguir el pedido');
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
  renderOrders();
}

function stopTracking() {
  if (geoWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId);
  }
  geoWatchId = null;
}

/* ---------- Aviso de pedido nuevo asignado ---------- */
function loadSeenOrderIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveSeenOrderIds(ids) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage no disponible: no rompe la app, solo no recuerda.
  }
}

function playNewOrderSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const beep = (freq, startDelay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = ctx.currentTime + startDelay;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.35);
    };
    beep(880, 0);
    beep(1046, 0.18);
  } catch {
    // Sin soporte de Web Audio o bloqueado por el navegador: silencioso.
  }
}

/* ---------- PWA: instalar la app de domiciliarios aparte ---------- */
/* Mismo service worker de siempre (sw.js, scope raíz) — se registra
   también desde aquí (no basta con que otra página ya lo haya hecho)
   para que esta página en concreto sea instalable, junto con
   manifest-driver.json enlazado en driver.html (su propio start_url,
   para que abra esta app y no el menú de clientes ni el panel). */
function registerServiceWorker() {
  // En localhost (entorno de pruebas con emuladores) no: serviría CSS/JS
  // viejos de su caché mientras se edita. Ver scripts/entorno-local.mjs.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    navigator.serviceWorker?.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    return;
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('No se pudo registrar el service worker:', err);
      });
    });
  }
}

/* Antes el splash se ocultaba con un timer fijo (500ms tras "load"),
   sin relación con si Firebase Auth ya había confirmado la sesión —
   en una conexión lenta o un arranque en frío del SDK, esos 500ms se
   cumplían ANTES de que onAuthChange (ver init()) resolviera, así que
   se alcanzaba a ver la pantalla de login por un instante aunque la
   persona ya tuviera sesión iniciada, hasta que un repintado la
   reemplazaba por el panel real. Ahora hideSplash() la esconde recién
   dentro de showGate() — es decir, en el mismo momento en que ya se
   sabe qué pantalla mostrar de verdad. Se deja igual un límite de
   seguridad por si algo se cuelga (sin red, Firebase Auth nunca
   responde) para que el splash no quede pegado para siempre. */
let splashHidden = false;
function hideSplash() {
  if (splashHidden) return;
  splashHidden = true;
  $('splash')?.classList.add('is-hidden');
}

function hideSplashWhenReady() {
  window.addEventListener('load', () => {
    setTimeout(hideSplash, 4000);
  });
}

/* ---------- Utilidades ---------- */
function timeAgo(ms) {
  if (!ms) return '';
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (diffMin < 1) return 'justo ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  // Más de un día: "hace 169h 37min" no se entendía de un vistazo.
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
  }
  return `hace ${h}h ${m}min`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function showToast(message) {
  const toast = $('driver-toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('is-visible'), 2500);
}

init();
