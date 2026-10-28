/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* Rodizio — shared/auth.js
   Responsable ÚNICAMENTE de identidad y sesión (Firebase Authentication).
   NO contiene lógica de roles (ver shared/roles.js) ni de pedidos.

   Cada trabajador tiene un "usuario" simple (ej. "juanp"), no un correo
   real — Firebase Authentication solo entiende email+password, así que
   generamos un correo SINTÉTICO interno usuario@rodizio.local. Nunca se
   muestra, nunca se usa para nada fuera de autenticar contra Firebase.

   Este archivo SÍ requiere <script type="module" src="../shared/auth.js">
   (a diferencia de firebase.js/util.js, que son scripts clásicos) porque
   el SDK de Firebase se importa como módulo ES desde el CDN oficial.
   Al final, cada función se cuelga en `window` para que el resto del
   código (scripts clásicos, sin type="module") la pueda llamar igual
   que las de shared/firebase.js. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged as _onAuthStateChanged,
  createUserWithEmailAndPassword,
  updatePassword as _updatePassword
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

// La instancia de Firebase (app/auth/db) vive en shared/firebase-app.js
// para que este archivo y shared/firebase.js compartan la MISMA app.
import { app, auth, firebaseConfig, prepararAuth } from "./firebase-app.js";

// App de Firebase secundaria, SOLO para que el admin cree cuentas de
// otros trabajadores sin que eso le cierre su propia sesión (ver nota
// arriba — es una limitación conocida y documentada del SDK).
let appSecundaria = null;
function authSecundaria() {
  if (!appSecundaria) appSecundaria = initializeApp(firebaseConfig, "rodizio-admin-crea-cuentas");
  return prepararAuth(getAuth(appSecundaria));
}

function usuarioAEmail(usuario) {
  return usuario.trim().toLowerCase() + "@rodizio.local";
}

/** Inicia sesión con usuario + contraseña. Devuelve el objeto user de Firebase. */
async function login(usuario, password) {
  const cred = await signInWithEmailAndPassword(auth, usuarioAEmail(usuario), password);
  return cred.user;
}

async function logout() {
  await signOut(auth);
}

function getCurrentUser() {
  return auth.currentUser;
}

/** Se llama con onAuthStateChanged(user => { ... }). Devuelve la función para dejar de escuchar. */
function onAuthStateChanged(callback) {
  return _onAuthStateChanged(auth, callback);
}

/**
 * Solo la usa panel-admin. Crea la cuenta en Firebase Authentication
 * (vía la app secundaria, para no afectar la sesión del admin) y
 * devuelve el UID — el caller es responsable de guardar el perfil en
 * /trabajadores/{uid} usando dbSet() de shared/firebase.js.
 */
async function crearCuenta(usuario, password, nombre) {
  const authSec = authSecundaria();
  const cred = await createUserWithEmailAndPassword(authSec, usuarioAEmail(usuario), password);
  const uid = cred.user.uid;
  await signOut(authSec); // limpia la sesión de la app secundaria; no toca la del admin
  return uid;
}

/**
 * Cambia la contraseña del usuario CON SESIÓN ACTIVA (el propio
 * trabajador cambiando su propia contraseña). NO sirve para que el
 * admin resetee la de otro — ver limitación documentada en CLAUDE.md:
 * sin backend/Admin SDK, esa parte de la sección 36 del plan original
 * requiere hacerlo manualmente desde la consola de Firebase por ahora.
 */
async function restablecerPasswordPropia(nuevaPassword) {
  if (!auth.currentUser) throw new Error("No hay sesión activa.");
  await _updatePassword(auth.currentUser, nuevaPassword);
}

window.login = login;
window.logout = logout;
window.getCurrentUser = getCurrentUser;
window.onAuthStateChanged = onAuthStateChanged;
window.crearCuenta = crearCuenta;
window.restablecerPasswordPropia = restablecerPasswordPropia;
