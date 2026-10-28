/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* Rodizio — shared/firebase-app.js
   Inicializa Firebase UNA sola vez y expone app/auth/db para que
   shared/auth.js y shared/firebase.js compartan la misma instancia
   (antes cada uno hacía su propio initializeApp / no usaba SDK).

   Módulo ES — se carga con <script type="module">.

   Fase 5 de la fusión: apunta al proyecto `rodiziomarketplace` (el mismo
   que la tienda, ver tienda/js/firebase-config.js — mismos valores).
   Las reglas de RTDB de ese proyecto son CERRADAS: las apps de mesa
   funcionan porque el SDK adjunta el token de Firebase Auth solo tras
   el login. `panel-cliente` (sin login) solo lee el menú público y
   escribe en `/solicitudes` (regla pública acotada).

   Antes de que las apps de mesa sean usables acá hay que recrear las
   cuentas de `/trabajadores` en el Auth de rodiziomarketplace (Fase 6). */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getDatabase, connectDatabaseEmulator } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

const configProduccion = {
  apiKey: "AIzaSyBTxf2ntMPTkYR5f45LMJC82bfexYAgtqI",
  authDomain: "rodiziomarketplace.firebaseapp.com",
  databaseURL: "https://rodiziomarketplace-default-rtdb.firebaseio.com",
  projectId: "rodiziomarketplace",
  storageBucket: "rodiziomarketplace.firebasestorage.app",
  messagingSenderId: "224063551054",
  appId: "1:224063551054:web:e8af60826b45b56a02b51f",
  measurementId: "G-F4GLH9C0LJ",
};

/* MODO LOCAL — abierto desde localhost/127.0.0.1, TODO va a los emuladores
   de Firebase (proyecto falso demo-rodizio, ver firebase.test.json y
   scripts/entorno-local.mjs): usuarios, base de datos y funciones de
   prueba. Nunca toca producción. Fuera de localhost no cambia nada. */
export const MODO_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

export const firebaseConfig = MODO_LOCAL
  ? {
      ...configProduccion,
      projectId: "demo-rodizio",
      authDomain: "demo-rodizio.firebaseapp.com",
      // ns "demo-rodizio": el que usa el emulador de functions (CLI 13) para
      // el databaseURL por defecto — así app y crearPedido ven la misma base.
      databaseURL: "https://demo-rodizio.firebaseio.com",
    }
  : configProduccion;

/* Conecta un Auth al emulador en modo local (una sola vez por instancia:
   el SDK falla si se llama dos veces). La usa también authSecundaria()
   de shared/auth.js. */
const authsConectados = new WeakSet();
export function prepararAuth(a) {
  if (MODO_LOCAL && !authsConectados.has(a)) {
    connectAuthEmulator(a, "http://127.0.0.1:9099", { disableWarnings: true });
    authsConectados.add(a);
  }
  return a;
}

export const app = initializeApp(firebaseConfig);
export const auth = prepararAuth(getAuth(app));
export const db = getDatabase(app);
if (MODO_LOCAL) connectDatabaseEmulator(db, "127.0.0.1", 9000);
