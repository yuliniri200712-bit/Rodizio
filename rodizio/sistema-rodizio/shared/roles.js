/* Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) */
/* Rodizio — shared/roles.js
   Responsable ÚNICAMENTE de autorización (roles y permisos), leyendo el
   perfil del trabajador desde /trabajadores/{uid} en RTDB. NO contiene
   lógica de login (eso vive en shared/auth.js) ni de pedidos.

   rolesPermitidos vs. rolActivo (sección 11 del plan):
   - rolesPermitidos: lo asigna el administrador, vive en RTDB, no lo
     puede tocar el propio trabajador.
   - rolActivo: la función que está usando ESA sesión ahora mismo. Se
     guarda en sessionStorage (se borra solo al cerrar la pestaña) para
     que sobreviva la navegación del login raíz hacia la app de cada
     rol — nunca se persiste de forma permanente ni toca rolesPermitidos.

   Script clásico (sin type="module"), igual que firebase.js/util.js —
   depende de dbGet() de shared/firebase.js, así que ese script debe
   cargarse ANTES que este en el <head>/<body> de cada app. */

// rolActivo vive en sessionStorage (no en una variable en memoria):
// necesita sobrevivir la navegación de una página HTML a otra —por
// ejemplo, del login raíz a mesero-app/— pero sigue sin ser permanente,
// se borra solo al cerrar la pestaña/navegador, y nunca modifica
// rolesPermitidos (que solo vive en RTDB, bajo control del admin).
const KEY_ROL_ACTIVO = "rodizio_rol_activo";

/** Lee el perfil completo del trabajador desde /trabajadores/{uid}. */
async function getWorkerProfile(uid) {
  return dbGet(`/trabajadores/${uid}`);
}

// rolesPermitidos pasó de array (["admin"]) a MAPA ({"admin": true}) en la
// Fase 5 de la fusión — la regla de RTDB de /trabajadores necesita el mapa
// (un array en RTDB se guarda como {0:"admin"} y hasChild('admin') falla).
// Estos helpers aceptan las dos formas por compatibilidad con datos viejos.
function rolesComoArray(rp) {
  if (Array.isArray(rp)) return rp.slice();
  if (rp && typeof rp === "object") return Object.keys(rp).filter((k) => rp[k] === true);
  return [];
}

/** Devuelve el arreglo de roles que el administrador le asignó (o [] si no tiene). */
async function getRolesPermitidos(uid) {
  const perfil = await getWorkerProfile(uid);
  return rolesComoArray(perfil && perfil.rolesPermitidos);
}

/** Fija el rol activo de ESTA sesión (sessionStorage, no persiste entre pestañas). */
function setActiveRole(rol) {
  try { sessionStorage.setItem(KEY_ROL_ACTIVO, rol); } catch (e) {}
}

function getActiveRole() {
  try { return sessionStorage.getItem(KEY_ROL_ACTIVO); } catch (e) { return null; }
}

/** ¿El trabajador tiene ese rol entre los permitidos? (acepta mapa o array) */
function hasRole(perfil, rol) {
  return !!(perfil && rolesComoArray(perfil.rolesPermitidos).includes(rol));
}

// Qué puede hacer cada rol — según la sección 12 del plan. Panel-admin,
// panel de caja, etc. usan esto para decidir qué mostrar/permitir, pero
// OJO: esto es solo para la interfaz. La protección real tiene que
// venir de las reglas de Firebase (sección 13/34 del plan) — nunca
// confiar solamente en esto para autorizar una operación sensible.
const PERMISOS = {
  admin: ["dashboard", "trabajadores", "mesas", "productos", "categorias", "inventario", "pedidos", "ventas", "caja", "reportes", "configuracion", "qr"],
  mesero: ["mesas", "pedidos_pendientes", "confirmar_pedido", "seguimiento_productos", "entrega_productos", "solicitudes_clientes", "solicitudes_cuenta"],
  cajero: ["caja", "cobros", "ventas", "historial", "cierre_caja"],
  cocinero: ["pedidos_confirmados", "preparacion", "marcar_listo", "vista_por_mesa"]
};

/** ¿El trabajador tiene ese permiso, considerando TODOS sus rolesPermitidos (no solo el activo)? */
function hasPermission(perfil, permiso) {
  if (!perfil) return false;
  return rolesComoArray(perfil.rolesPermitidos).some(rol => (PERMISOS[rol] || []).includes(permiso));
}

window.getWorkerProfile = getWorkerProfile;
window.getRolesPermitidos = getRolesPermitidos;
window.setActiveRole = setActiveRole;
window.getActiveRole = getActiveRole;
window.hasRole = hasRole;
window.hasPermission = hasPermission;
window.PERMISOS = PERMISOS;
