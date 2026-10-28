# Contexto del proyecto — Rodízio Cúcuta (tienda/)

Marketplace de domicilios: `index.html` (clientes), `admin.html` (panel de
domicilios), `driver.html` (domiciliarios). HTML/CSS/JS puro, sin build ni
frameworks, sobre el Firebase **real** `rodiziomarketplace` con **Realtime
Database** (no Firestore — se migró a pedido del usuario; no reintroducir
imports de `firebase-firestore.js`).

Vive dentro del repo del sistema de mesas y comparte su Firebase: leer
`../CLAUDE.md` primero. Estado, decisiones y lo que sigue (pasarela, dominio):
`../docs-fusion/PLAN-MAESTRO.md`. Rondas de ajustes y bugs ya resueltos, con su
porqué: `docs/historial-cambios.md` — leerlo antes de tocar CSS, el panel o la
app de domiciliarios.

## Lo que cambió con la fusión

- **`orders` es compartida** con los pedidos de mesa; `origen`
  (`"mesa" | "domicilio" | "recoger"`, sin `origen` ⇒ mesa) los distingue.
  `admin.js` y `driver.js` filtran los de mesa fuera de sus vistas.
- Escalera de estados: `recibido → enviado → preparacion → listo → en_camino →
  llegado → entregado` (+ `cancelado`, `no_entregado`). La confirmación
  `recibido → enviado` la hace el cajero en `panel-caja` (pestaña Domicilios).
  `llegado` lo marca `driver.js` por geofence GPS (o a mano) y cuenta como
  entrega en curso.
- Los pedidos los crea **solo** la Cloud Function `crearPedido`; la lógica de
  negocio está en `js/reglas-pedido.js` (copia generada en `functions/lib/`,
  no editarla). Pruebas: `cd functions && npm test` antes de tocar eso, las
  reglas de `orders` o `crearPedido`.
- Reglas RTDB: `../database.rules.json`. Las de `js/firebase-config.js` son
  historia.
- Pago en línea (AAvance): el pedido espera en `pagosPendientes` y solo entra
  a `orders` (con `pagado: true`, `metodoPago: 'en_linea'`) cuando el servidor
  confirma con la API de AAvance. Detalle en `../docs-fusion/PLAN-PASARELA-PAGO.md`.
  La ApiKey está en Secret Manager; nunca en `.env` (choca con el secreto al
  desplegar) ni en el navegador.
- Fotos del menú en Firebase Storage (ver `../CLAUDE.md`), vía `urlFoto()` en
  `js/data.js`.

## Trampas de estructura y pruebas

- `sw.js` DEBE quedarse en la raíz de `tienda/` (scope `/`), y se registra con
  la ruta absoluta `/sw.js`, no `./sw.js`.
- Probar con `npm start` (servidor propio) o el entorno local de
  `../scripts/entorno-local.mjs`; **nunca** con `file://` (los módulos ES no
  cargan). Revisar antes si ya hay algo en el puerto 8080 y matar `node.exe`
  huérfanos; parar el servidor al terminar.
- El navegador de pruebas falla a veces al registrar el service worker ("An
  unknown error occurred when fetching the script") y con `screenshot`/`zoom`:
  es del entorno, no de la app. Verificar con `javascript_tool`.
- Al cambiar algo precacheado, subir `CACHE_NAME` en `sw.js`.

## Gotchas que ya mordieron

- **`[hidden]` vs `display`:** si una regla le pone `display` a algo que se
  oculta con `hidden`, le gana a `[hidden]{display:none}` y queda visible.
  Escribirla como `#id:not([hidden])` o agregar `.clase[hidden]{display:none}`
  (ya pasó con `.admin-gate`, `.closed-banner`, `.checkbox-field`,
  `.active-order-bar`, `.btn`, `.segmented`).
- **Especificidad de `body:has(#app)`:** las reglas de `brand.css` llevan ese
  prefijo y cuenta como id; una regla nueva sin él pierde (pasó con títulos
  `h2`/`h3` y con `.search-row-top`).
- **Reglas RTDB con lectura "todo vs. solo lo mío":** un `.read` en `$hijo` no
  aplica cuando se lee el nodo padre completo; usar reglas por query
  (`query.orderByChild == 'uid' && query.equalTo == auth.uid`).
- **Varias apps en el mismo origen comparten sesión de Firebase Auth** si usan
  el mismo nombre de app: cada página tiene el suyo (`appNameForThisPage()`,
  detecta la página por su contenedor raíz, no por `location.pathname`, porque
  Hosting sirve `admin.html` como `/admin`).
- **`outOfStock/{id}` no es binario:** un número son unidades restantes;
  agotado es `true` o `0`. Cualquier lector nuevo debe filtrar igual.
- **Todo `onValue` lleva `logOnValueError(contexto)`** como tercer argumento
  (`js/errors.js`), o los fallos de suscripción mueren en silencio.
- **Listas que se repintan con cada `onValue` frecuente** (pedidos, inventario
  en `admin.js`): agrupar repintados y preservar el foco/cursor de lo que se
  esté escribiendo, como `scheduleRenderOrders` + `captureFocusedNoteDraft`.
- `privacidad.html` tiene tres secciones distintas a propósito (`#cliente`,
  `#panel`, `#domiciliario`): si se agrega o quita una función que toque datos
  personales, actualizar su sección en el mismo cambio. `overflow-anchor:
  none` + salto en `document.fonts.ready` arreglan el salto a la sección; no
  quitarlos. No reintroducir la fecha de "última revisión".
- `confirm.js` reemplaza `window.confirm/prompt`; su overlay va por encima de
  todo a propósito (`z-index` del modal + 100).

## Seguridad — reglas que no se deben romper

- `admins/{uid}` y `drivers/{uid}/access` **solo** los escribe el dueño a mano
  en la consola. Nunca una forma de auto-otorgarse admin o acceso desde la app,
  ni pedir una Service Account para atajos.
- `admins/{uid}` puede ser `true` (legado = dueño), `"dueno"` o `"cajero"`:
  reglas de "cualquier admin" comparan `.exists()`; las de solo dueño (menú,
  configuración) `=== true || === 'dueno'`.
- Login del panel y de domiciliarios: correo/contraseña, separado del login de
  clientes (Google). No fusionarlos.
- `firebaseConfig` y `VAPID_KEY` ya tienen valores reales: no volver a poner
  placeholders.
- **App Check** (vuelto a pedir por el usuario el 2026-10-13): reCAPTCHA
  Enterprise, solo en la app de clientes (`js/firebase-config.js`). Se exige
  solo en las funciones de pedido/pago (`enforceAppCheck`); **nunca** aplicarlo
  a Realtime Database ni Authentication en la consola: los paneles de mesas y
  el QR no lo mandan y dejarían de funcionar.
- Todo texto libre que vaya a `innerHTML` pasa por `escapeHtml()`.
- `mapAuthError()` devuelve el mismo mensaje para "no existe la cuenta" y
  "contraseña incorrecta" (evita enumerar correos). No separarlos.
- No hay Content-Security-Policy a propósito: mal definido rompe Firebase,
  Google Fonts, Nominatim y ExcelJS. Pendiente, con calma.

## Decisiones del usuario (no revertir sin que lo pida)

- Se quitaron a pedido del usuario y no se reintroducen solos: reseñas de
  producto, cupones de descuento, foto de evidencia de entrega.
- La propina del domiciliario no suma al efectivo esperado del cierre de turno.
- "Reasignar a mitad de camino" reutiliza "No se pudo entregar" + "Reintentar
  entrega" del panel; no construir un flujo aparte.
- El ETA lo elige el cajero (15/30/45/60 con sugerencia por cola). La fórmula
  futura (tiempo de preparación por plato + Google Routes API) está anotada en
  `docs/historial-cambios.md`; no construirla sin que el usuario traiga el dato
  de preparación y decida pagar la API.
- El rastreo del domiciliario es la posición GPS cruda, sin servicio de rutas.
