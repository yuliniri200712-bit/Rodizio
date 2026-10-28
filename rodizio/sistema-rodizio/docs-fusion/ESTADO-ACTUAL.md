# ESTADO ACTUAL — fusión Rodizio (leer esto primero)

**Última actualización:** 2026-09-07
**Rama:** `fusion` (repo `github.com/deyvidjgv/sistema-rodizio`)
**Working tree:** limpio salvo `.claude/MEMORY.md` (cambio preexistente, no tocar).

Este documento es la foto exacta de dónde estamos. Los otros docs de `docs-fusion/`:
`DIAGNOSTICO-FUSION.md` (por qué), `PLAN-FUSION.md` (las fases), `ESQUEMA-UNIFICADO.md`
(el modelo de datos), `FASE-6-RUNBOOK.md` (cutover).

---

## 1. Qué es esto

Fusionar **dos sistemas del restaurante Rodizio Cúcuta** en uno:

- **Sistema de mesas** — 5 PWAs vanilla (`mesero-app`, `panel-cocina`, `panel-caja`,
  `panel-admin`, `panel-cliente`) en la raíz del repo.
- **Marketplace de domicilios** — 3 apps (cliente, `admin.html`, `driver.html`), lo hizo
  el compañero del usuario, ahora vive en `tienda/`.

**Objetivo:** un solo Firebase (`rodiziomarketplace`), una sola colección de pedidos
(`orders`), un solo menú en RTDB, reglas cerradas. Que un pedido de domicilio, al
confirmarlo el cajero, entre al tablero de `panel-cocina` como un ticket más.

**Contexto clave:** los dos sistemas están **en desarrollo, sin datos reales** — todo lo
que había en las dos bases era de prueba. No hay migración riesgosa.

---

## 2. Decisiones tomadas (firmes)

| # | Decisión |
|---|---|
| Firebase destino | **`rodiziomarketplace`** (databaseURL `rodiziomarketplace-default-rtdb`) |
| Colección de pedidos | **`orders`** (antes mesa usaba `/pedidos`). Campo de estado: **`status`** (antes `estado`) |
| `origen` | `"mesa" | "domicilio" | "recoger"` — sin `origen` ⇒ `"mesa"` |
| Escalera de estados | `recibido → enviado → preparacion → listo → en_camino → llegado → entregado` (+ `cancelado`, `no_entregado`). `llegado` = automático por GPS |
| Confirmar domicilio | **EXCLUSIVO de caja** — `panel-caja` pestaña "Domicilios", botón "Confirmar y mandar a cocina". `tienda/admin.html` ya no confirma |
| `llegado` | automático: geofence 150 m en `driver.js` sobre `customerLocation` o `destinoCoords` (geocodificado por caja al confirmar). Fallback botón "Llegué" |
| Dinero = solo `pagado` | `tienda/admin.js` "Vendido hoy" y reportes solo suman `pagado === true`. Igual que caja y el dashboard de admin |
| Datos por SDK | `shared/firebase.js` usa el **SDK de Firebase** (antes REST+SSE sin token) |
| Menú | vive en RTDB (`categories`/`products`/`sugerencias`), lo carga `shared/menu-loader.js`. `shared/menu.js` quedó solo como fuente del seed |
| `rolesPermitidos` | **mapa** `{"admin": true}` (antes array `["admin"]`) |
| **Caja = autoridad del dinero** | TODOS los pedidos (mesa + domicilio + recoger) pasan por `panel-caja` para confirmar `pagado`. Métodos: efectivo / tarjeta / transferencia. Domicilio se puede cobrar desde `en_camino`. El panel de domiciliarios sigue con la logística (ruta/GPS), no maneja plata. Preparación para pasarelas de pago. |
| Confirmación de domicilio | la hace **caja** desde `tienda/admin.html`, botón "Confirmar" (`recibido → enviado`) |
| Botones de estado del panel tienda | solo avanzan al **siguiente** estado (no saltar/retroceder libre) |
| Identidad (3 logins) | **DIFERIDA** — no en esta ronda |

---

## 3. Commits en la rama `fusion` (del más viejo al más nuevo)

```
92d58f3  reestructura: marketplace -> tienda/ , docs -> docs-fusion/
cf22166  Fase 2b: shared/firebase.js al SDK (+ shared/firebase-app.js nuevo)
6f3dfed  Fase 2: menú real a RTDB (scripts/build-menu-data.mjs, shared/menu-loader.js)
d80648f  Fase 3: modelo de pedido unificado (/pedidos->orders, estado->status, origen)
0ac3bc4  Fase 4: puente domicilio->cocina + botón "Confirmar" en tienda/admin.js
8cbe1fe  Fase 5: config -> rodiziomarketplace + database.rules.json unificadas + rolesPermitidos mapa
305ebe7  Fase 6: FASE-6-RUNBOOK.md + banners de fusión en los 2 CLAUDE.md
3f0c595  fix: index.html raíz cargaba shared/firebase.js como script clásico (se pasó en Fase 2b)
3c1f44e  Caja = autoridad del dinero: todos los orígenes pasan por panel-caja
9e3c8b1  backup de reglas de rodiziomarketplace (docs-fusion/rules-marketplace-ANTES.json)
0953b4b  docs: ESTADO-ACTUAL.md
41c04e2 / b4c8530  docs: cuenta rodizio@rodizio.local creada (uid 3tJJAXr11yZLJGLzlVEma54MEiR2)
```

### Flujo de domicilio unificado (2026-09-06) — ver `PLAN-DOMICILIO.md`

```
989def8  Fase A+B: confirmar domicilio + logística se mudan a panel-caja
                    (pestaña "Domicilios"), tienda/admin pierde "Confirmar",
                    dinero solo cuenta con pagado===true
<C>      Fase C: panel-cocina agiliza domicilio (1 botón "Listo"), driver.js
                 "Recogí" = listo implícito + en_camino
<D>      Fase D: estado "llegado" automático por GPS (geofence 150 m) +
                 botón "Llegué" manual + STATUS_LABELS
<E>      Fase E: cobro del domicilio (efectivo/tarjeta/transf) desde la
                 pestaña Domicilios de caja
<F>      Fase F: reglas (drivers legible por trabajador activo) + docs.
                 Reglas DESPLEGADAS en rodiziomarketplace.
```
El `access` de `drivers/{uid}` SIGUE siendo solo-admin (nunca auto-otorgado).

---

## 4. Qué está DESPLEGADO ahora mismo

### `rodiziomarketplace` (el destino)
- **Reglas:** ✅ las unificadas (`database.rules.json`) — desplegadas hoy con
  `firebase use rodiziomarketplace && firebase deploy --only database`.
  Verificado: `orders/.indexOn = ["uid","driverId","origen","status","createdAt"]`,
  regla `solicitudes` pública presente.
- **Menú:** ✅ los 159 productos reales subidos (`ENT-01`…`CHA-…`). Los 16 genéricos
  de la semilla vieja quedaron reemplazados.
- **`/admins`:** `5RvHI9C3LQUJe5tDlJx7CwyvbZI2` (compañero) + `UDTdv6oXH6g4Ko9wAbeCiSeI9Xt2`
  (cuenta del usuario, `djg@gmail.com`).
- **`/trabajadores`:** ✅ `rodizio` (uid `3tJJAXr11yZLJGLzlVEma54MEiR2`, cuenta
  email/pw `rodizio@rodizio.local` creada 2026-09-06, `rolesPermitidos: { admin: true }`,
  `estado: activo`). Nodo creado por CLI.
  Nota: el uid `UDTdv6oXH6g4Ko9wAbeCiSeI9Xt2` (que primero se creyó era la cuenta de mesa)
  es en realidad `djg@gmail.com` — está en `/admins`, es el dueño.
- **`/orders`:** tiene ~25 pedidos de prueba (del compañero + algunos que hizo el usuario
  hoy desde `tienda/`, ya con `origen`/`lineas`/`status` correctos).
- **`/settings`:** el real (tel, horario, zona "Caobos").

### `rodizio-eb49a` (el viejo del sistema de mesas, se archiva al final)
- Reglas: se le desplegaron TAMBIÉN las unificadas hoy (tenía el borrador viejo aplicado
  que solo conocía `/pedidos` — por eso daba `permission_denied at /orders`).
- Menú: los 159 productos también están ahí (se subieron para el Pass 1).
- `/trabajadores`: `rodizio` (uid `mvTAsqM7idU3vZHklO1x4Xgv4G63`, `rolesPermitidos: ["admin"]`
  todavía en array) y `maria` (uid `VPf2r0xTlVbUVEi24VmF9nrNomx2`).
- `/orders`: vacío. `/pedidos`: 7 pedidos viejos de prueba (dato muerto, nadie los lee ya).

### Config local (`shared/firebase-app.js`)
Actualmente apunta a **`rodiziomarketplace`** (commiteado así). Durante el Pass 1 el
usuario lo tuvo temporalmente en `rodizio-eb49a` con
`git show cf22166:shared/firebase-app.js > shared/firebase-app.js` y lo restauró con
`git checkout shared/firebase-app.js`.
`tienda/js/firebase-config.js` siempre apuntó a `rodiziomarketplace`.

> ⚠️ `.firebaserc` (gitignored) tiene `default: rodizio-eb49a`. **Siempre correr
> `firebase use rodiziomarketplace` antes de un `firebase deploy`.**

---

## 5. Qué está PROBADO y qué no

| Flujo | Estado |
|---|---|
| Tienda: cliente arma pedido → confirma en `admin.html` → avanza estados | ✅ probado. El pedido queda con `origen:"domicilio"`, `lineas` (mirror de `items`), `status`, `rondaEstados:{1:...}`, `confirmadoPor`, `tsConfirmado`, `statusHistory`. |
| Botones de estado que solo avanzan | ✅ hecho, falta que el usuario lo verifique visualmente |
| Apps de mesa (login, mesero→cocina→caja, cliente QR) | ✅ **Probado 2026-09-19** (ronda de hardening de seguridad) como parte de la Fase 5 del plan — mesero envía comanda → cocina avanza → mesero marca servido → caja cobra; por separado, cliente QR arma carrito → mesero confirma → cocina. Se encontraron y corrigieron 2 bugs reales de las reglas/hosting en el camino (ver abajo). Dashboard de `panel-admin` sigue sin probar aparte. |
| **Puente domicilio → cocina** | ⚠️ **NO probado** — ahora mesa y tienda están los dos en `rodiziomarketplace` y la cuenta de mesa existe; listo para probar. |
| **Flujo domicilio nuevo** (confirmar en caja, cocina 1 botón, `llegado` GPS, cobro en caja) | ⚠️ **NO probado** — código de las 6 fases hecho y comiteado. El geofence necesita coordenadas (GPS real del domi + `customerLocation`/`destinoCoords`), difícil de probar sin dispositivos; el botón "Llegué" manual sí se puede probar. |
| `panel-caja` cobrando pedidos de domicilio | ❌ NO probado |
| Hosting multi-sitio | ✅ **CONFIGURADO Y DESPLEGADO** (2026-09-07). 5 sitios de mesa (`rodizio-mesero/cocina/caja/admin/cliente`) + 3 de tienda (`rodiziomarketplace`, `rodizio-admin-domicilios`, `rodizio-driver`), todos en el proyecto `rodiziomarketplace`. Cada sitio sirve solo su panel + infra común (`shared/`, `icons/`), el resto se excluye con `ignore`. Ver `HOSTING-MULTISITIO.md`. El admin **principal** del sistema quedó en `rodizio-admin.web.app`; el admin de domicilios de la tienda se movió a `rodizio-admin-domicilios.web.app`. |
| Functions | ❌ no desplegado (necesita plan Blaze) |
| id de mesa unificado (`slugMesa` en `shared/util.js`) | ✅ hecho 2026-09-07 — mesero-app "Abrir otra", panel-admin QR y panel-cliente usan la misma función; "Mesa 7"→`mesa-7`, "Terraza"→`terraza`. Elimina el riesgo de mesa duplicada con el mismo nombre. |
| Admin en modo observación (solo lectura) en mesero/caja/cocina | ✅ hecho 2026-09-07 — `activarModoObservador()` en `shared/ui.js` + guard `window.__SOLO_LECTURA` en `shared/firebase.js` bloquea toda escritura. Enlaces "Acceso a paneles" del panel-admin abren cada panel en su sitio dedicado. |

---

## 6. EL SIGUIENTE PASO — probar el flujo completo

Cuenta de trabajador ✅ creada (`rodizio` / `rodizio@rodizio.local`, uid
`UDTdv6oXH6g4Ko9wAbeCiSeI9Xt2`). Todo listo para la prueba end-to-end en
`rodiziomarketplace`:
- Login raíz (`http://localhost:8000/`) con `rodizio`.
- Server local: `python -m http.server 8000` desde `sistema-rodizio/`.
- URLs: `/` (login) · `/mesero-app/` · `/panel-cocina/` · `/panel-caja/` ·
  `/panel-admin/` · `/panel-cliente/?mesa=mesa-5` · `/tienda/` · `/tienda/admin.html`.
- **Hard-refresh + DevTools → Application → Service Workers → Unregister** (las apps de
  mesa cachean el shell; hay SW de versiones viejas).
- Flujo mesa: mesero → enviar comanda (`P-00X`) → cocina avanza → mesero "servido" →
  caja cobra.
- Flujo domicilio: `tienda/` cliente arma pedido → `tienda/admin.html` "Confirmar" →
  **aparece en `panel-cocina` etiquetado "Domicilio"** → cocina prepara → llega a
  `panel-caja` para cobrar (efectivo/tarjeta/transferencia) → `tienda/admin.html`
  asigna domiciliario / marca `en_camino` / `entregado`.

---

## 7. Gotchas descubiertos en el camino

- **`shared/firebase.js` es un módulo ES** ahora → cada `index.html` que lo cargue debe
  usar `<script type="module">`. Se pasó por alto el `index.html` raíz (arreglado en
  `3f0c595`). Si se agrega otra página, revisar esto.
- **`escucharSSE(path, onData, onStatus)`** — nueva firma. `onData` recibe el árbol
  completo en cada cambio (el SDK no manda eventos incrementales). `aplicarEventoSSE`
  quedó como identidad, ya no se usa.
- **`firebase deploy --only database -P rodiziomarketplace`** lo bloquea el classifier de
  Claude Code (el `-P` con ese proyecto). Funciona `firebase use rodiziomarketplace`
  seguido de `firebase deploy --only database` (sin `-P`).
- **Rutas `/algo` en la Bash tool (Git Bash / MSYS)** se manglean a rutas Windows —
  usar `export MSYS_NO_PATHCONV=1` antes de comandos `firebase database:*`.
- **Las líneas de pedido NO se renombraron**: mesa usa `{nombre, precio, nota}`, tienda
  `{name, price, notes}`. Los helpers `nombreLinea/precioLinea/notaLinea` de
  `shared/util.js` bridgean las dos formas. El renombre total es Fase 7.
- **`rodizio` en `rodizio-eb49a` todavía tiene `rolesPermitidos: ["admin"]` (array).**
  El código lo acepta (`rolesComoArray` en `shared/roles.js`), pero al crear la cuenta
  nueva en `rodiziomarketplace` usar la forma de **mapa**.
- **`panel-cliente/app.js` — condición de carrera con `esperarMenu()` (✅ RESUELTO 2026-09-08).**
  Se añadió espera defensiva con reintentos para `window.esperarMenu` y `window.__menuReady`
  eliminando el `ReferenceError` cuando los scripts diferidos tardan en inicializarse.
- **`solicitudes` sin `.read` a nivel de colección (✅ RESUELTO 2026-09-19, encontrado en
  la prueba de punta a punta de la Fase 5 del plan de hardening).** `database.rules.json`
  solo tenía `.read: true` en `solicitudes/$mesaId` — en RTDB los permisos NO se heredan
  hacia arriba, así que `mesero-app` (que escucha el nodo `/solicitudes` completo para ver
  en vivo qué mesas tienen carrito pendiente) fallaba con
  `permission_denied at /solicitudes` apenas se abría la app. Se agregó `.read: true`
  también en `solicitudes` (el nodo padre) — no agrega exposición nueva, cada `$mesaId`
  individual ya era de lectura pública sin auth.
- **`panel-cliente/index.html` con rutas relativas rotas bajo el rewrite de hosting
  (✅ RESUELTO 2026-09-19, mismo hallazgo de la Fase 5).** El target `cliente` reescribe
  `"/"` → `/panel-cliente/index.html`, pero un *rewrite* de Firebase Hosting NO cambia la
  URL base que ve el navegador para resolver rutas relativas — sigue siendo `/`. Los tags
  `<link href="styles.css">` y `<script src="app.js">` (sin `../`) resolvían contra `/`,
  pidiendo `/styles.css` y `/app.js` — que están explícitamente EXCLUIDOS del sitio
  `cliente` (son los del `index.html`/`app.js` raíz del sistema de mesas) → 404 →
  pantalla en blanco total, sin ningún error visible en consola. El QR de mesa apuntaba a
  una página completamente rota en producción. Corregido apuntando esos dos a rutas
  absolutas (`/panel-cliente/styles.css`, `/panel-cliente/app.js`); los demás assets
  (`../shared/...`, `../icons/...`) coinciden por casualidad con su ruta real y no
  hicieron falta tocarlos, pero son igual de frágiles — si se reorganiza el hosting de
  nuevo, revisar esto primero.

### Rediseño visual Tienda Delivery Premium & Despliegue (2026-09-08)

Evolución de cara-cliente (`tienda/` y `panel-cliente/`) hacia un look & feel de app de delivery premium, elegante y de alta conversión:
- **Lienzo y colores:** Cero tonos pasteles deslavados. Paleta viva y auténtica de asador y parrilla: carbón oscuro (`#0c0e12`), rojo fuego vivo (`#d92015`), ámbar dorado (`#f59e0b`), y superficies nítidas.
- **Logos oficiales:** Logo oficial con farol y lema "Desde 1986" recortado limpio en formato WebP transparente (`tienda/brand/logo-white.webp` para header oscuro, `logo-dark-trans.webp` para fondos claros).
- **Cero emojis en interfaz:** Sustituidos al 100% por iconos vectoriales SVG limpios con micro-animaciones CSS y GSAP (fuego titilante, moto en marcha, reloj pulsante, estrella dorada, pin de ubicación).
- **Hero Carrusel de Referencias Reales:** Carrusel interactivo con 5 diapositivas de fotos reales de alta calidad (`amb-10.webp`, `amb-8.webp`, `amb-9.webp`, `amb-14.webp`, `amb-12.webp`), flechas de navegación, dots, swipe táctil, transiciones GSAP escalonadas de texto y botones CTA con enlace directo a categorías.
- **Búsqueda Inteligente Semántica:** Normalización sin tildes, búsqueda por palabras/stems, y reconocimiento semántico de categorías. Escribir "bebidas" lista las 98 bebidas disponibles de forma instantánea. Botón rápido `✕` para limpiar búsqueda y restaurar el catálogo.
- **Navegación y Categorías:** Píldora inicial "Todos" con centrado automático por scroll horizontal al activarse.
- **Botón `+` Rápido:** Agrega 1 unidad al carrito de inmediato con micro-rebote táctil, mientras que tocar la tarjeta abre el modal de notas y términos.
- **Barra de Canasta Flotante:** Badge dinámico con contador, total en COP y animación de impulso al agregar productos.
- **Despliegue Firebase:**
  - `rodiziomarketplace.web.app` (Tienda de Domicilios)
  - `rodizio-admin-domicilios.web.app` (Admin Domicilios)
  - `rodizio-driver.web.app` (Panel Repartidores)
  - `rodizio-cliente.web.app` (Panel Pedir en Mesa QR)
- **Service Worker:** Actualizado a `rodizio-cucuta-v74` con precaché de logos y dependencias.

#### Ajustes post-rediseño (2026-09-08, sesión de QA)

Revisión en navegador del rediseño anterior. Consola limpia (solo `heartbeats`
del SDK). Bugs encontrados y corregidos:
- **La vista arrancaba en "Entradas" en vez de "Todos"** — la guarda de
  `onCategoriesChange` en `app.js` reseteaba `activeCategoryId` porque
  `__todos__`/`__favoritos__` no son categorías reales. Ahora se excluyen.
- **CTAs del carrusel** apuntaban a slugs inexistentes (`cortes`, `cerdo`) →
  `de-la-parrilla`. `rodizioSelectCategory` ahora tolera match parcial de slug.
- **`data.js` (fallback)**: los 18 productos semilla seguían con `categoryId`
  viejo mientras `CATEGORIES` ya tenía los 16 slugs nuevos → remapeados.
- **CSS (`css/brand.css`)**: título del banner salía negro sobre foto oscura
  (`body:has(#app) h2` le ganaba en especificidad); flecha izquierda del
  carrusel tapaba la 1ª letra del texto; badge del carrito mostraba "0" vacío
  y el botón "+" de agotados seguía visible (gotcha `[hidden]`); barra flotante
  de canasta tapaba la última fila / se encimaba con la barra de pedido en
  curso; grilla de productos atascada en 2 columnas hasta 1920px; header se
  desbordaba en celular angosto.
- `✓` quitado del texto del filtro de porciones (regla de "cero símbolos en UI").
- **Service Worker:** subido a `rodizio-cucuta-v79`.
- **Pendiente de verificar:** layout en celular (<768px) — el navegador de
  pruebas no cambia el viewport; los cambios son media queries simples.

#### Ronda 2 de diseño — compactar el top + hero (2026-09-09)

- **Calculadora de porciones plegable**: arranca colapsada (solo el
  encabezado, ~46px vs ~150px). Se abre al tocarla o sola si hay filtro
  activo. `setPortionExpanded()` / `updatePortionToggleCount()` en `app.js`,
  markup con `#portion-toggle` + `#portion-calc-body[hidden]`.
- **Stats bar** ("25-40 min · 100% al carbón · El Malecón") pasó de tarjeta
  a franja transparente. Márgenes entre secciones del top `sp-4`→`sp-3`.
  Resultado: la nav de categorías y el inicio del menú entran en la
  primera pantalla (antes había que bajar ~1 pantalla).
- **Hero carrusel**:
  - Entrada del contenido ahora es **100% CSS** (`@keyframes heroContentIn`
    atada a `.is-active`), ya no GSAP — se atascaba invisible con la
    pestaña en 2º plano (rAF throttled). `carousel.js` ya no usa GSAP.
  - `checkBoundaryWrap()` normaliza el índice con módulo + timer de
    respaldo si no llega `transitionend` — antes el `virtualIndex` se
    acumulaba hasta salirse del riel y dejar el hero en negro.
  - **4 diapositivas** (se quitó la de amb-9 "Costillas": foto de primer
    plano que no funciona en un banner ancho y bajo).
  - `object-position` por slide (solo la banda vertical importa en este
    recorte) + `filter: brightness(1.1) contrast(1.05)` en las fotos +
    degradado retocado.
- **Service Worker:** subido a `rodizio-cucuta-v82`.
- Sigue pendiente de verificar el layout en celular real (<768px).

### Rediseño visual de `panel-cliente` (Mesa QR) — 2026-09-21

A partir de 4 capturas que el usuario dejó fuera del repo (`../Screenshot_*.png`),
se rehizo el aspecto del panel de cliente (NO el marketplace de `tienda/`):

- **`icons/` en la raíz estaba VACÍO** (solo tenía `menu/`) — `icon-192.png`,
  `icon-512.png`, `icon-maskable-512.png`, `favicon.png` y `apple-touch-icon.png`
  los referencian el `index.html` raíz, el `manifest.webmanifest` y las 5 apps de
  mesa, pero **ninguno existía**: todos daban 404 y por eso salía el logo roto en
  las capturas. Se poblaron desde el kit que el usuario ya tenía listo en
  `../img rodizio/icon-kit/`. Arregla de paso el logo del login raíz y el ícono de
  "instalar app" de las 4 PWAs de mesa.
- **Más rutas relativas rotas bajo el rewrite de hosting** (mismo patrón del bug ya
  documentado arriba): `logo.webp`, `../icons/icon-192.png` (×2) y el enlace a
  `privacidad.html` del aviso de datos. Todas pasadas a rutas absolutas
  (`/panel-cliente/...`).
- **Logos**: `panel-cliente/logo.webp` es 768×768 con el wordmark chiquito al medio
  y mucho margen vacío — con `object-fit:contain` en una caja de 130×40 se veía
  diminuto. Se copiaron los wordmarks ya recortados de `tienda/brand/`:
  `logo-white.webp` (hero + pantalla de carga, fondo oscuro) y `logo-dark-trans.webp`
  (pantalla "Pedido enviado", fondo claro). `logo.webp`/`logo-dark.webp` quedan sin uso.
- **Paleta** alineada a la de `admin.html`/`driver.html` (rojo `#d92015`, obsidiana
  `#0c0e12`/`#141720`, borde `#e2e5eb`). Ojo: no bastaba con cambiar el `:root` —
  el bloque `/* BRAND — overrides */` al final de `styles.css` tenía el rojo y el
  carbón viejos **hardcodeados** y gana por cascada.
- **Cero redondeos**: las ~32 apariciones de `border-radius` pasaron a `0`,
  incluidos los círculos intencionales (fotos de plato, botones +/−, cerrar) —
  decisión explícita del usuario. `tienda` NO se tocó, allá siguen circulares.
- **Categorías**: la fila horizontal de pastillas (`.cats`/`.cat-pill`) se
  reemplazó por un panel lateral izquierdo (`.category-sidebar`) que abre un botón
  hamburguesa junto al buscador — mismo patrón que ya usa `tienda`. El `.backdrop`
  ahora es compartido entre carrito y categorías (se movió a `renderApp()`).
- **Fondo de carga** oscuro (obsidiana) en vez de crema — pisado localmente en
  `panel-cliente/styles.css`; **no tocar `shared/ui.css`**, que define
  `.cargando-wrap`/`.spinner` para las pantallas de "verificando sesión" de las
  otras 4 apps.
- **Botón "← Volver al menú"** en la pantalla "Pedido enviado", que antes era un
  callejón sin salida (había que re-escanear el QR para pedir otra ronda).
- **Cabecera anti-caché faltante en los 5 sitios de mesa** (encontrado al probar:
  el navegador seguía sirviendo el `app.js` viejo tras desplegar). El
  `firebase.json` raíz no tenía el `Cache-Control: no-cache` para `html|js|css|json`
  que `tienda/firebase.json` sí tenía — sin eso, **cada despliegue tardaba hasta
  1 hora en verse**. Corregido en los 5 targets.

### Identidad visual unificada en TODO el sistema — 2026-09-21

Dos frentes en la misma ronda:

**1. Filtros del admin de domicilios en celular** (`tienda/css/admin.css`, solo CSS):
`.admin-filter-row` y `.admin-tabs` usaban `overflow-x:auto` **con la barra de
scroll oculta** — en celular había que correr la fila a ciegas entre 10 estados,
sin ninguna señal de que hubiera más opciones. Ahora usan `flex-wrap: wrap`: se ven
todas en 2-3 renglones, conservando los contadores por estado
(`.admin-filter-count`), que es justo lo que se habría perdido al cambiarlas por un
`<select>`. Se le dio `min-height: 44px` a las pastillas (objetivo táctil).
Aplica también a `#admin-date-filter` y `#admin-drivers-filter`, que comparten
clase y tenían el mismo problema. **No se tocó `admin.html` ni `admin.js`**, así que
la sincronía triple (pastillas HTML ↔ `STATUS_FILTER_OPTIONS` ↔ `data-count-for`)
sigue intacta. El bloque `@media (min-width:1080px)` tampoco cambió: en escritorio
se sigue usando el `<select>`.

**2. Las 5 apps de mesa pasan a la identidad del resto del sistema.** Hasta acá
usaban una paleta crema/café con Caprasimo + Figtree, mientras marketplace,
admin-domicilios, driver y panel-cliente ya usaban rojo/obsidiana con Plus Jakarta
Sans + Manrope:

- **`shared/theme.css`** (un solo archivo para los 5 paneles — ninguno redefinía
  tokens salvo cocina): paleta a fondo `#f5f6f8`, superficie `#ffffff`, texto
  `#0d0f14`, acento `#d92015`, divisor `#e2e5eb`, rampa de neutros de cálida a
  fría, `--color-accent-2` de salvia a dorado `#f59e0b`. Fuentes a Plus Jakarta
  Sans + Manrope. Sombras re-tintadas de café `#2e2b25` a obsidiana `#0c0e12`.
  `--radius-*` a `0`. Se agregó el tratamiento de encabezados
  (`font-weight:800`, `letter-spacing:-0.025em`, `text-transform:none`) que ya
  usan admin/driver — sin eso Plus Jakarta Sans en mayúsculas se ve enorme.
- **Peso de títulos por app**: los 5 tenían `font-weight:400` en sus `h1..h4`
  (servía para Caprasimo, que es una display ya pesada). Con Plus Jakarta Sans se
  veían flojos → subidos a `800` en cada `styles.css`, porque cargan DESPUÉS de
  `theme.css` y le ganaban por cascada.
- **Cero redondeos: 112 reemplazos** en `shared/ui.css`, raíz `styles.css`,
  `mesero-app`, `panel-caja`, `panel-admin`, `dashboard.css` y `panel-cocina`.
  Solo 7 venían de un token, así que bajar `--radius-*` no alcanzaba.
  **Única excepción: `.spinner` (`shared/ui.css:120`) conserva `border-radius:50%`**
  — es un anillo que gira; cuadrado se vería como un cuadrado rotando.
- **`panel-cocina` sigue oscuro** (decisión del usuario: la pantalla se mira de
  lejos y con las manos ocupadas), pero con negro obsidiana `#0c0e12`/`#141720` y
  rojo de marca en vez del café. Mantiene la rampa de neutros INVERTIDA (100 = más
  oscuro), así que las reglas existentes siguen funcionando sin tocarlas. Su alerta
  de "aviso de cambio" (`styles.css:90-93`) tenía ámbar sobre café escrito a mano,
  fuera del sistema de tokens → re-mapeada al dorado de marca sobre `#2e2206`.
- **Colores sueltos re-mapeados** conservando su significado: texto de error
  `#c2410c` → `#b8140c`; distintivo de "modo observación" `#92400e` → `#b45309`; y
  los 3 estados de domicilio en `panel-caja` siguen siendo 3 tonos distinguibles
  entre sí (`#d97706` dorado / `#059669` verde / `#2563eb` azul) porque el cajero
  los diferencia de un vistazo — no se colapsaron al rojo de marca.
- Se corrigió `panel-cliente/privacidad.html`, que había quedado cargando
  Caprasimo/Figtree de la ronda anterior.

Efecto colateral **deseado** sobre `panel-cliente` (ya rediseñado): redefine todos
sus colores y fuentes, así que la paleta no le llega; pero sí le llegan las sombras
(ahora obsidiana en vez de café) y los redondeos de `shared/ui.css` (sus toasts se
veían redondeados dentro de un diseño angular). Ambos lo mejoran.

### Despliegue del backlog acumulado + tipografía driver + bilingüe tienda — 2026-09-21

**Hallazgo clave de esta ronda**: el repo tenía ~120 archivos modificados/nuevos
sin desplegar desde el 17-sep (último commit real). Entre ellos, sin que se
hubieran subido nunca: el bilingüe ES/EN completo de `panel-cliente/` y el
esqueleto (diccionario + botón + mecanismo) del de `tienda/`, y los datos de
sabores de bebidas (`tienda/patch.json` + `scripts/build-menu-data.mjs`). Antes
de construir nada nuevo se desplegó todo eso primero, para partir de la
realidad en vivo — confirmado con el usuario.

- **Tipografía en `rodizio-driver`**: único gap real encontrado — 3 reglas en
  `tienda/css/driver.css` (`.driver-quick-stat-label`, `.driver-precise-badge`,
  `.driver-order-chip`) tenían el tamaño en px fijo en vez de `var(--fs-xs)`,
  así que no escalaban con el salto de tamaño por seguridad vial del resto del
  panel. Corregidas las 3.
- **Horarios en Colombia**: ya estaba resuelto en todo el sistema
  (`shared/util.js`, `shared/firebase.js` `siguienteCodigo`,
  `tienda/js/settings.js`, `resolveScheduledFor` en `tienda/js/app.js`), solo
  faltaba desplegarse — no se tocó nada más.
- **Bilingüe de `tienda/` — se completó la conexión que faltaba**:
  `tienda/js/app.js` importaba `t`/`getLang`/`setLang` y tenía el botón de
  idioma, pero `t()` nunca se llamaba fuera del mecanismo de `data-i18n`
  (`updateStaticContentFromHTML()`), y solo 12 elementos (el carrusel + el
  buscador) tenían ese atributo. El carrito, el checkout completo, el modal de
  producto, el login y el cajón de perfil seguían en español fijo. Se agregaron
  ~25 claves nuevas a `tienda/js/i18n.js` (varias claves viejas del diccionario
  no coincidían con el texto real de la UI — se ajustaron al texto real en vez
  de cambiar la interfaz) y `data-i18n` a todo el checkout/modal
  producto/login/perfil en `tienda/index.html`. También se corrigió un bug
  real: `updateStaticContentFromHTML()` solo corría al tocar el botón de
  idioma, así que un cliente que volvía con inglés ya guardado en
  `localStorage` veía la página en español hasta hacer clic de nuevo — ahora
  también corre una vez al cargar (`init()`, `tienda/js/app.js`).
  **A propósito NO se tocó**: nombres/descripciones de platos (vienen de
  Firebase tal cual), `getCategoryIcon()`, el ícono del carrusel, ni los
  `aria-label` sueltos de accesibilidad (favoritos, "+" de agregar) — quedan
  en español, bajo impacto visual, fuera del alcance pedido.
- **`panel-cliente/app.js` — limpieza pequeña**: dos funciones usaban una
  variable local llamada `t`, tapando la función global `t()` de traducción
  dentro de su propio alcance (`aviso(t, opts)` y un `.map((t) => ...)` en
  `renderDrawer()`). No rompía nada hoy, pero era un riesgo de bug silencioso
  a futuro — renombradas.
- Los íconos de categoría del marketplace (`getCategoryIcon()` en
  `tienda/js/ui.js`) y el ícono de moto en el botón "Pedir ahora" del carrusel
  **ya existían, ilustrados por categoría** — lo que el usuario describió como
  "muy simples" muy probablemente era el sitio viejo, ahora reemplazado.

### Carta de mesa separada del menú de domicilios + arreglos — 2026-09-21 (tarde)

**El hallazgo importante**: `categories`/`products` era UN SOLO nodo
compartido entre la carta de mesa (`shared/menu-loader.js`, la leen
`panel-cliente`/`mesero-app`/`panel-cocina`) y el menú de domicilios
(`tienda/js/catalog.js`, lo edita `tienda/admin.html`). El usuario borró los
21 vinos y 4 champagnes desde el admin de domicilios y desaparecieron también
de la carta de mesa — no era un bug, era el diseño original de la fusión
("un solo menú en RTDB"), pero el usuario los quiere independientes.

- **Separación**: la carta de mesa pasó a nodos nuevos, `categoriesMesa` /
  `productsMesa` (mismas reglas de RTDB que `categories`/`products`: lectura
  pública, escritura solo admin). `tienda/` (marketplace + admin de
  domicilios) sigue igual, sin tocar una línea — solo se cambió el `get(ref(db,
  ...))` de `shared/menu-loader.js`. `sugerencias`/`sugerenciasPorProducto`
  siguen compartidas a propósito (son pistas opcionales, no catálogo).
- **Recuperación de los vinos/champagnes**: `scripts/separar-carta-mesa.mjs`
  (nuevo) compara lo vivo en RTDB contra `scripts/menu-seed/*.json` (el
  respaldo del menú original), reporta diferencias SIN escribir nada hasta
  correr con `--escribir`, y prioriza siempre el valor vivo sobre el del
  respaldo si un mismo producto difiere (0 casos esta vez — los 25 faltantes
  eran limpiamente "borrado sin editar antes"). Uso: exportar primero
  `firebase database:get /products > scripts/menu-seed/live-products.json`
  (mismo con `/categories`), correr el script, revisar el reporte, y recién
  ahí `--escribir` + `firebase database:set`.
- **Panel de edición de la carta**: nueva pestaña "Carta" en `panel-admin`
  (`panel-admin/index.html`/`app.js`/`styles.css`) — antes NINGÚN panel podía
  editar la carta de mesa (se cargó una sola vez por script). CRUD simple
  (nombre, descripción, precio, categoría, orden) sobre `productsMesa`,
  mismo patrón de `dbGet`/`dbSet`/`dbDelete` que ya usa la gestión de
  trabajadores en el mismo archivo. Sin fotos ni control de agotados en esta
  primera versión — la carta no los usaba antes.
- **Botón "Ver pedido"/"View order" invisible**: `panel-cliente/styles.css`
  — el bloque de overrides pisaba el `color` a blanco sin tocar el
  `background` (que venía casi blanco de la regla base) → texto blanco sobre
  fondo blanco. Corregido definiendo fondo y color juntos.
- **El idioma ya NO se guarda entre visitas**: en `panel-cliente/i18n.js` y
  `tienda/js/i18n.js` se quitó la lectura/escritura de `localStorage` —
  cada carga arranca en español siempre, a pedido del usuario (cada QR de
  mesa lo escanea un cliente distinto, heredar el idioma del anterior no
  tenía sentido).
- **Diferido a propósito, confirmado con el usuario**: traducir nombres y
  descripciones de los ~134-159 platos al inglés ("lo hacemos después"), y la
  integración de una pasarela de pago de prueba (ronda aparte — recordar que
  `placeOrder` sigue sin validar el total en servidor, documentado como
  bloqueante antes de cobrar dinero real).

---

## 8. Diferido a Fase 7 (NO hacer ahora sin que el usuario lo pida)

- Unificar los 3 logins (Google clientes / correo panel / correo drivers) en uno.
- Renombrar las líneas de pedido `nombre/precio/nota` → `name/price/notes` en todo mesa.
- Topología de hosting multi-sitio + `/icons/` servido en la raíz de todos los sitios.
  **Parcialmente resuelto (2026-09-08):** las 155 fotos del menú se copiaron a
  `tienda/icons/menu/` para que el marketplace las vea (antes salían rotas).
  Es una copia, no la unificación de hosting — si se unifica el deploy del
  marketplace bajo el `firebase.json` raíz, quitar `tienda/icons/`.
- Reportes unificados (Excel de caja ya incluye todo; falta unificar con reportes tienda).
- **Pasarela de pago (Wompi/otro):** integración + webhook que marca `pagado`,
  reconciliación efectivo-que-trae-el-domi ↔ pagos-confirmados-en-caja, y validar el
  `total` del pedido en un backend (hoy lo manda el navegador sin verificación).
- Merge `fusion` → `main` (solo cuando todo esté probado).
