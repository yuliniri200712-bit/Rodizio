/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* =========================================================
   AUTENTICACIÓN — inicio de sesión con Google
   =========================================================
   Envuelve Firebase Auth + Realtime Database para que el
   resto de la app solo hable con funciones simples:
   signIn(), signOutUser(), onAuthChange(), placeOrder(),
   onMyOrdersChange().
   ========================================================= */

import { auth, googleProvider, db, functions, httpsCallable } from './firebase-config.js';
import { logOnValueError } from './errors.js';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {
  ref,
  push,
  set,
  update,
  get,
  remove,
  onValue,
  query,
  orderByChild,
  equalTo,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js';

export async function signIn() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error('Error al iniciar sesión con Google:', error);
    throw mapAuthError(error);
  }
}

/* ---------- Registro de consentimiento (tratamiento de datos) ----------
   Deja constancia de que la persona aceptó la política de datos antes
   de crear su cuenta o iniciar sesión (app.js/admin.js/driver.js ya
   bloquean el botón hasta que marque la casilla — esto es la prueba
   de auditoría, no el bloqueo en sí). Nunca debe poder romper el
   flujo de login si falla: es solo un registro. */
export async function recordConsent(scope) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await set(ref(db, `consents/${user.uid}`), {
      accepted: true,
      scope,
      at: serverTimestamp(),
    });
  } catch (err) {
    console.warn('No se pudo registrar el consentimiento:', err);
  }
}

/* ---------- Correo y contraseña (panel de administración) ---------- */
export async function registerWithEmail(email, password) {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error) {
    console.error('Error al crear la cuenta:', error);
    throw mapAuthError(error);
  }
}

export async function signInWithEmail(email, password) {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    throw mapAuthError(error);
  }
}

export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    console.error('Error al enviar el correo de recuperación:', error);
    throw mapAuthError(error);
  }
}

/* Cambio de contraseña en caliente (ya con sesión iniciada) — distinto
   de resetPassword() de arriba, que manda un correo. Firebase exige
   reautenticar con la contraseña actual antes de dejar poner una
   nueva (updatePassword falla con "requires-recent-login" si la
   sesión ya lleva un rato abierta y se intenta sin esto). */
export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error('No hay una sesión activa.');
  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
  } catch (error) {
    console.error('Error al cambiar la contraseña:', error);
    throw mapAuthError(error);
  }
}

export function signOutUser() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/* ⚠️ La Cloud Function createPaymentSession se retiró (2026-10-05) y se
   reescribe en la Fase 3 de docs-fusion/PLAN-MAESTRO.md. Esto solo se
   llama si settings/pagoEnLinea === true — no prenderlo antes. */
/* Pago en línea: el servidor (crearPagoEnLinea) arma el pedido con los
   precios reales, lo guarda aparte hasta que se pague y devuelve los
   campos del formulario de AAvance con SU total. El pedido entra a
   `orders` solo cuando el servidor confirma el pago con AAvance
   (verificarPagoEnLinea o el webhook). Errores igual que placeOrder. */
export async function initPaymentSession(order) {
  const user = auth.currentUser;
  if (!user) throw new Error('Debes iniciar sesión para confirmar el pedido.');

  const crearPagoEnLinea = httpsCallable(functions, 'crearPagoEnLinea');
  const { data } = await crearPagoEnLinea(datosPedido(order));
  return data;
}

// Devuelve { estado: 'pagado' | 'pendiente' | 'rechazado' | 'monto_no_coincide' | 'no_existe', orderId? }
export async function verificarPagoEnLinea(orderNumber) {
  const verificar = httpsCallable(functions, 'verificarPagoEnLinea');
  const { data } = await verificar({ orderNumber });
  return data;
}

function datosPedido(order) {
  return {
    items: (order.items || []).map(({ id, qty, notes }) => ({ id, qty, notes: notes || '' })),
    deliveryMode: order.deliveryMode,
    address: order.address,
    customerLocation: order.customerLocation,
    reference: order.reference,
    phone: order.phone,
    scheduledFor: order.scheduledFor ? order.scheduledFor.getTime() : null,
    mayorDeEdad: order.mayorDeEdad === true,
    totalEsperado: order.total,
  };
}

/* El pedido lo crea la Cloud Function `crearPedido`
   (functions/index.js) — el navegador ya NO escribe en `orders`
   (database.rules.json se lo prohíbe desde 2026-10-05). Solo se manda
   QUÉ se quiere: de cada línea van id, cantidad y nota; precios,
   nombres, envío y total los pone el servidor con los datos reales,
   y también descuenta el inventario.

   `totalEsperado` = lo que el cliente vio en pantalla. Si el servidor
   calcula otro (cambió un precio con el carrito ya armado), rechaza con
   error.code === 'functions/aborted' y error.details trae los precios
   vigentes — app.js actualiza el carrito y pide confirmar de nuevo.
   Devuelve { orderId, subtotal, shipping, total }. */
export async function placeOrder(order) {
  const user = auth.currentUser;
  if (!user) throw new Error('Debes iniciar sesión para confirmar el pedido.');

  const crearPedido = httpsCallable(functions, 'crearPedido');
  const { data } = await crearPedido(datosPedido(order));
  return data;
}

/* El cliente puede cancelar su propio pedido (lo permiten las
   reglas de RTDB porque es el dueño del pedido) — app.js solo deja
   mostrar el botón mientras el pedido sigue "recibido" y no han
   pasado más de unos minutos, para que no se pueda cancelar algo
   que la cocina ya está preparando. */
export async function cancelOrder(orderId) {
  const user = auth.currentUser;
  if (!user) throw new Error('Debes iniciar sesión.');
  await set(ref(db, `orders/${orderId}/status`), 'cancelado');
}

/* Se suscribe a los pedidos del usuario y llama a callback cada
   vez que cambian en Realtime Database (nuevo pedido, cambio de
   estado…). Devuelve una función para cancelar la suscripción.
   RTDB solo permite ordenar por un campo en la consulta, así
   que el orden por fecha (más reciente primero) se hace aquí. */
export function onMyOrdersChange(callback) {
  const user = auth.currentUser;
  if (!user) {
    callback([]);
    return () => {};
  }

  const ordersQuery = query(ref(db, 'orders'), orderByChild('uid'), equalTo(user.uid));
  return onValue(
    ordersQuery,
    (snapshot) => {
      const value = snapshot.val() || {};
      const orders = Object.entries(value).map(([id, data]) => ({ id, ...data }));
      orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      callback(orders);
    },
    logOnValueError('auth:myOrders')
  );
}

/* ---------- Direcciones guardadas ---------- */
export async function saveAddress({ address, reference, label }) {
  const user = auth.currentUser;
  if (!user) throw new Error('Debes iniciar sesión para guardar una dirección.');

  const newRef = push(ref(db, `users/${user.uid}/addresses`));
  await set(newRef, { address, reference: reference || '', label: label || '', createdAt: serverTimestamp() });
  return newRef.key;
}

export function onMyAddressesChange(callback) {
  const user = auth.currentUser;
  if (!user) {
    callback([]);
    return () => {};
  }
  return onValue(
    ref(db, `users/${user.uid}/addresses`),
    (snapshot) => {
      const value = snapshot.val() || {};
      const addresses = Object.entries(value)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      callback(addresses);
    },
    logOnValueError('auth:myAddresses')
  );
}

export function deleteAddress(addressId) {
  const user = auth.currentUser;
  if (!user) return Promise.resolve();
  return remove(ref(db, `users/${user.uid}/addresses/${addressId}`));
}

/* ---------- Inventario (lo escribe el panel de admin) ---------- */
/* outOfStock/{productId} ya no es solo "existe = agotado": ahora
   también puede guardar cuántas unidades quedan (número > 0), para
   que el cajero vea "quedan 3" sin tener que marcarlo agotado todavía.
   Para el cliente solo importa si de verdad está agotado: eso es
   `true` (agotado a mano) o `0` (se acabó el conteo). */
export function onOutOfStockChange(callback) {
  return onValue(
    ref(db, 'outOfStock'),
    (snapshot) => {
      const value = snapshot.val() || {};
      const outIds = Object.entries(value)
        .filter(([, v]) => v === true || v === 0)
        .map(([id]) => id);
      callback(new Set(outIds));
    },
    logOnValueError('auth:outOfStock')
  );
}

/* ---------- Clientes bloqueados ---------- */
/* Un cliente con muchas cancelaciones o pedidos no reclamados puede
   quedar marcado por el dueño (ver admin.js) — esto se revisa antes
   de dejarlo confirmar un pedido nuevo. No bloquea nada más de la
   cuenta (puede seguir viendo el menú, favoritos, etc.). */
export async function isCurrentUserBlocked() {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const snap = await get(ref(db, `customerFlags/${user.uid}`));
    const val = snap.val();
    return val && val.blocked ? val : null;
  } catch {
    return null;
  }
}

function mapAuthError(error) {
  const messages = {
    'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de terminar.',
    'auth/cancelled-popup-request': 'Ya había una ventana de inicio de sesión abierta.',
    'auth/network-request-failed': 'Revisa tu conexión a internet e intenta de nuevo.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Inicia sesión en vez de crear una nueva.',
    'auth/invalid-email': 'Ese correo no es válido.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/missing-password': 'Escribe una contraseña.',
    // user-not-found y wrong-password comparten mensaje a propósito — devolver
    // mensajes distintos permite enumerar qué correos tienen cuenta (admin/driver
    // son login con correo/contraseña, no Google). Mismo mensaje también lo usa
    // resetPassword() más abajo, por eso no menciona "contraseña" — debe servir
    // tanto para login como para "olvidé mi contraseña".
    'auth/user-not-found': 'No pudimos verificar esos datos. Revisa el correo e intenta de nuevo.',
    'auth/wrong-password': 'No pudimos verificar esos datos. Revisa el correo e intenta de nuevo.',
    'auth/invalid-credential': 'No pudimos verificar esos datos. Revisa el correo e intenta de nuevo.',
    'auth/too-many-requests': 'Demasiados intentos. Espera un momento e intenta de nuevo.',
  };
  return new Error(messages[error.code] || 'No se pudo iniciar sesión. Intenta de nuevo.');
}
