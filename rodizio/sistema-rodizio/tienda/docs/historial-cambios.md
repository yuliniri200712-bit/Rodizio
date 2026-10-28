# Historial de cambios — tienda (marketplace, admin de domicilios, domiciliario)

> Movido desde `tienda/CLAUDE.md` el 2026-10-05 para que no se cargue en cada
> sesión. Es historia: decisiones, bugs encontrados y cómo se resolvieron. Lo
> vigente (seguridad, arquitectura, cómo probar, pendientes) sigue en
> `tienda/CLAUDE.md`. Este archivo NO se publica (excluido en `tienda/firebase.json`).
## Estilo / diseño

- **Rojo de marca más puro (`--color-flame`/`--color-ember`)**: a
  pedido del usuario, se ajustó el acento principal de un rojo-
  anaranjado (`#d9502a`) a un rojo más intenso y menos anaranjado
  (`#d9342a`; `--color-flame-hover` `#c22a21`; `--color-ember`
  `#8a2016`) — manteniendo el fondo claro y el resto del diseño
  intactos, solo el tono. Como estas variables están centralizadas en
  `variables.css` y las 3 apps las comparten, el cambio se propagó
  solo. Lo que SÍ hubo que tocar a mano: varios archivos (`layout.css`,
  `components.css`, `admin.css`, `driver.css`, `animations.css`)
  repetían los mismos tonos como literales `rgba(...)` (para
  degradados/glows con transparencia, ej. el brillo del hero, el
  pulso del tab activo, el destello de pedido nuevo) en vez de
  referenciar la variable — sin actualizar esos literales el brillo
  se hubiera quedado con el rojo-anaranjado viejo aunque los botones
  ya usaran el rojo nuevo. Los tres literales que aparecían repetidos
  eran `rgba(232, 93, 44, ...)` (glow, ahora `232, 65, 44`),
  `rgba(217, 80, 42, ...)` (== flame exacto, ahora `217, 52, 42`) y
  `rgba(166, 47, 27, ...)` (== ember exacto, ahora `138, 32, 22`) — si
  se vuelve a ajustar este color en el futuro, buscar por esos tres
  triples de rgb además de por el nombre de la variable, no alcanza
  con editar solo `variables.css`. `--color-danger` (rojo de
  error/cancelar, `#b23434`) y `--color-gold` (dorado de precios) NO
  se tocaron — son colores semánticos aparte, no el acento de marca.
- **Header y barra inferior en rojo de marca** (a pedido del usuario,
  después del cambio de tono de arriba): antes casi negro
  (`rgba(23, 17, 14, ...)`) en las 3 apps — ahora `.app-header`
  (`layout.css`) usa un degradado `var(--color-flame)` →
  `var(--color-ember)`, y `.bottom-nav` usa `var(--color-ember)`
  sólido. Al cambiar el fondo de negro a rojo, varios elementos que
  dependían de ese fondo oscuro (no del tono) dejaron de contrastar y
  hubo que ajustarlos en el mismo cambio:
  - `.app-header .btn-danger-link` ("Cerrar sesión" del panel/
    domiciliarios, vive directo sobre la barra): era un coral
    (`#ff8a7a`) pensado para resaltar sobre negro — sobre el rojo
    nuevo se mezclaba con el fondo (ambos rojizos); pasó a blanco.
  - `.avatar-btn` (aro del ícono de cuenta): era `var(--color-flame)`
    — un aro del mismo rojo que ahora es el fondo del header
    desaparecía; pasó a un aro blanco translúcido.
  - `.bottom-nav-item` inactivo: era `var(--color-text-faint)` (gris
    cálido pensado para negro) — apagado sobre rojo; pasó a blanco
    translúcido (`rgba(255,255,255,0.65)`).
  - `.bottom-nav-item.is-active`: era `var(--color-flame)` — activo
    con el mismo rojo que ya es el fondo de la barra se volvía
    invisible. Se probó `var(--color-gold-soft)` ("brasa encendida")
    pero el usuario pidió dejarlo en **blanco puro** (`#fff`) — más
    simple y con más contraste contra el rojo y contra el blanco
    translúcido del texto inactivo.
  - `.bottom-nav-badge`: el aro que lo recorta (`box-shadow`) usaba
    `var(--color-bg)` (el crema de la página, tenía sentido cuando la
    barra era casi negra y el aro "recortaba" contra el fondo de la
    página) — pasó a `var(--color-ember)` para recortar contra la
    barra, que es lo que ahora tiene alrededor. El fondo del badge en
    sí (`var(--color-flame)`) NO se tocó, sigue siendo el mismo rojo
    de siempre (más claro que el `--color-ember` de la barra, por eso
    se sigue distinguiendo).
  Si se vuelve a tocar el color de fondo de `.app-header`/
  `.bottom-nav` en el futuro, revisar esta misma lista — son todos
  los elementos que asumen "fondo oscuro" en vez de leer el color
  real del fondo.
- **Animaciones "premium" (2 rondas, ambas hechas)**: se evaluó
  agregar más micro-interacciones para que la app se sienta menos
  genérica. Ronda 1 (cliente, mayor impacto visible) y ronda 2
  (panel/domiciliarios) — ambas completas.
  - **Entrada escalonada de la grilla de productos**: `.product-card`
    ya tenía la animación `rise-in` (`animations.css`), pero todas las
    tarjetas aparecían a la vez. Ahora `ui.js` (`renderMenu`) le pone
    a cada tarjeta un `--i` (índice continuo a través de TODA la
    grilla que se pinta en esa llamada, no reiniciado por categoría —
    para que la cascada se sienta como una sola secuencia) vía
    `card.style.setProperty('--i', cardIndex)`; el CSS usa
    `animation-delay: min(calc(var(--i, 0) * 35ms), 320ms)` — el
    `min()` evita que una categoría con muchos productos tarde
    segundos en terminar de aparecer completa.
  - **Botón "Confirmar pedido" con spinner + check animado**: antes
    solo cambiaba el texto a "Enviando pedido…". Ahora
    `handleConfirmOrder` (`app.js`) le agrega la clase `.is-loading`
    (spinner giratorio dibujado con `::before`, ver `components.css`)
    mientras espera la respuesta de Firebase, y al confirmar con
    éxito la cambia a `.is-success` (check verde animado) por 650ms
    ANTES de cerrar el drawer del carrito y mostrar el toast — ese
    remate visual antes de cualquier otra cosa es lo que lo hace
    sentir como una confirmación real, no solo un cambio de texto. Las
    clases `.btn.is-loading`/`.btn.is-success` son genéricas a
    propósito (no ligadas a "pedido"), pensadas para reusarse después
    en otras acciones de envío de las 3 apps (ej. cierre de turno del
    domiciliario, marcar "Entregado") si se pide esa segunda ronda.
  - **Sacudida del ícono de carrito al agregar un producto**: esta ya
    existía de antes (`ui.nudgeCartNav()`, clase `.is-nudging` en
    `#nav-carrito`) — se confirmó que sigue funcionando, no se tocó.
  - **Destello en pedido nuevo (panel)**: `admin.js` ya distinguía
    pedidos "nuevos" para el sonido/toast/badge (`state.seenOrderIds`)
    pero la tarjeta aparecía de golpe con el repintado agrupado. Se
    agregó `state.justArrivedOrderIds` (se llena junto con
    `seenOrderIds` al detectar pedidos nuevos, se vacía sola a los 2s
    con `setTimeout` — solo dura el primer repintado tras llegar) y
    `renderOrderCard` le pone la clase `.is-new-arrival` a esa
    tarjeta. **Ojo con dónde va el CSS de esto**: `admin.html` NO
    carga `css/animations.css` (solo `variables/base/layout/
    components/admin`), así que el keyframe `new-order-flash` vive en
    `admin.css`, no en `animations.css` — un intento inicial de
    ponerlo en `animations.css` no tuvo ningún efecto visible hasta
    que se movió. Antes de agregar una animación nueva al panel o a
    domiciliarios, confirmar primero qué hojas de estilo carga esa
    página (`admin.html`/`driver.html` no cargan `animations.css`).
  - **Spinner de carga en los botones de acción de domiciliarios**
    (Recogí el pedido / Marcar entregado / No se pudo entregar / No
    puedo tomar este pedido): mismo espíritu que el botón de
    confirmar pedido del cliente, pero SOLO el spinner, sin el check
    de éxito — la tarjeta del pedido cambia de pestaña y desaparece de
    la lista apenas Firebase confirma el cambio de estado, así que un
    check con su propia pausa de ~650ms nunca llegaría a verse
    completo (el elemento ya se destruyó por el repintado). El
    spinner solo evita el doble toque mientras se confirma. Estos
    botones usan sus propias clases (`.driver-primary-btn`/
    `.driver-secondary-btn`, no `.btn`) porque tienen su tamaño de
    toque propio (pensado para la calle) — por eso el CSS de
    `.is-loading` está duplicado en `driver.css` en vez de reusar
    `.btn.is-loading` de `components.css` directamente, aunque
    comparte la misma keyframe `btn-spin`.
  - **Spinner + check en "Cerrar turno"**: este sí lleva el ciclo
    completo (igual que "Confirmar pedido" del cliente) porque el
    botón se queda en pantalla después de la acción, a diferencia de
    los de arriba — el check de éxito ("¡Turno cerrado!") sí llega a
    verse completo antes de restaurar el texto original. Usa la clase
    `.btn` normal (`components.css`), no las clases propias de
    domiciliarios.
  - **Spinner en "Cancelar pedido" y "Bloquear/Desbloquear cliente"
    del panel** (detalle menor pendiente de la ronda 2, ya cerrado):
    mismo criterio que los botones de domiciliarios — solo spinner,
    sin check, porque la tarjeta del pedido se vuelve a pintar apenas
    Firebase confirma. Estos botones usan `.admin-block-btn` (no
    `.btn`), que por defecto es `display: block` — su variante
    `.is-loading` cambia a `display: flex` solo mientras carga, para
    centrar el spinner junto al texto sin afectar el layout normal.
- **Barra de búsqueda siempre visible**: ya no vive detrás de un
  botón de lupa que la mostraba/ocultaba — está fija justo debajo del
  hero (con un margen negativo para que "flote" sobre el borde
  inferior del hero, estilo pastilla elevada). El botón de lupa del
  header ahora solo hace scroll + foco hacia ella, no la
  muestra/oculta. Si se toca este flujo, recordar que
  `bindBottomNavEvents` (botón "Inicio") ya no pone `hidden` en
  `#search-bar` — ahora llama a `renderMenu()` directamente al limpiar
  la búsqueda (antes de este cambio, limpiar la búsqueda desde
  "Inicio" NO refrescaba la grilla si ya estaba filtrada — quedó
  corregido de paso).
- **Carrusel "Lo más pedido"** (`ui.renderFeaturedCarousel`, sección
  `#featured-section` en `index.html`): muestra en scroll horizontal
  los productos que tengan el campo `badge` puesto desde el panel
  (Menú → producto → "Insignia") — no es una lista curada aparte, así
  que un producto aparece ahí en el momento en que se le pone
  cualquier insignia (`Menú` → editar producto). Si ningún producto
  tiene insignia, la sección se oculta sola (nunca inventa
  destacados). Se repinta junto con `renderMenu()` en `app.js`, no
  tiene su propio ciclo de suscripción.
- Emojis: el usuario pidió explícitamente eliminar TODOS los emojis
  de la interfaz — se reemplazaron por íconos SVG inline. No
  reintroducir emojis en HTML/JS generado, ni en mensajes de la UI.
- Paleta clara tema "brasa/ceniza" (`variables.css`) — hubo una
  versión con modo oscuro/claro alternable (con botón en el header),
  el usuario pidió quitar el oscuro por completo y dejar un solo
  tema, sin botón para cambiarlo; no reintroducir `data-theme` ni
  `prefers-color-scheme`. Mobile-first con breakpoints de tablet
  (720px) y escritorio (1080px, 1440px, 1920px) en `layout.css` —
  desde la reorganización responsiva, `#app`/`#admin-app`/
  `#driver-app` ya no tienen ningún `max-width`/ancho tope, ocupan el
  100% real de la pantalla siempre (los drawers/modales siguen aparte,
  usan `--max-width`, fijo, NO crecen con la pantalla). Navegación
  principal = barra inferior fija (`bottom-nav`), no un menú de header
  tradicional.
- `sw.js`: subir el número de `CACHE_NAME` (`rodizio-cucuta-vN`)
  cada vez que se edite ese archivo o cualquier archivo listado en
  `APP_SHELL`, para que los navegadores con una versión vieja cacheada
  la reemplacen.

## Legibilidad — panel y app de domiciliarios

`admin.css` y `driver.css` sobreescriben localmente la escala de
tipografía y el color de texto "faint" con un bloque
`body:has(#admin-app) { ... }` / `body:has(#driver-app) { ... }` al
inicio del archivo — NO se tocó `variables.css` (eso afectaría
también a `index.html`, que no lo necesita). El truco de usar
`body:has(...)` en vez de `#admin-app { ... }` / `#driver-app { ... }`
directamente es a propósito: los diálogos de `confirm.js` se insertan
como hijos directos de `<body>` (fuera de esos contenedores), y con
`:has()` en el body los heredan igual — si solo estuviera en
`#admin-app`/`#driver-app`, el diálogo de confirmar quedaría con
letra chica ahí adentro.

- **Panel** (`admin.css`): +1px en `--fs-xs`/`--fs-sm`/`--fs-base`
  (pensado para "no forzar tanto la vista" en jornadas largas, no
  para leer de lejos) + `--color-text-faint` más claro. También se
  subieron a mano todos los `font-size: 10px/11px` sueltos que había
  en el archivo (etiquetas, chips, botones de ETA) a 12-13px — los
  del recibo de impresión (`.ticket-*`, dentro de `@media print`) se
  dejaron intactos a propósito, esos no los lee nadie en pantalla.
- **Domiciliarios** (`driver.css`): salto bastante más grande
  (`--fs-md` 18px→22px, `--fs-lg` 22px→28px, etc.) porque el caso de
  uso es literal seguridad vial — el celular montado en la moto,
  hay que poder leer de un vistazo mientras se conduce, no solo
  "más cómodo". También se subió el contraste de
  `--color-text-faint`/`--color-text-muted`, el color de
  `.driver-order-items` (antes "faint", ahora "muted"), y el tamaño
  de toque de `.driver-action-btn` (Llamar/Abrir en Maps) a
  `min-height: 48px` con más padding — pensado para tocar con
  guantes o sin mirar mucho la pantalla.

## Auditoría de lanzamiento a producción

Pasada completa antes de operar con clientes reales — esto es lo que
se encontró y se corrigió (no eran features nuevas, eran cosas que ya
debían estar bien):

- **`og:image`/`twitter:image` en `index.html` tenían el placeholder
  literal `TU-DOMINIO` sin reemplazar** — nunca se había actualizado
  después de publicar en Firebase Hosting. Corregido al dominio real
  (`rodiziomarketplace.web.app`); si se conecta un dominio propio más
  adelante, hay que volver a actualizar esto (y `og:url`).
- **Ícono solo en SVG** — `apple-touch-icon` en formato SVG no lo
  renderiza Safari/iOS al agregar a pantalla de inicio (a diferencia
  de Android, que sí soporta SVG en el manifest). Se encontró un
  `icon-512.png` ya generado pero sin usar en el proyecto; se conectó
  como `apple-touch-icon` en las 3 páginas y como ícono adicional
  (`purpose: "any maskable"`) en los 3 manifests — el SVG se queda
  como ícono principal para navegador/Android, el PNG cubre iOS.
- **`.gitignore` vacío** — lo creó el asistente de `firebase init`
  pero sin contenido. Se le agregó lo básico (`node_modules/`,
  `functions/node_modules/`, `.firebase/`, logs) para cuando el
  proyecto se conecte a un repositorio Git.
- **CSV de exportación de pedidos** (`exportOrdersCSV` en `admin.js`)
  no incluía propina — se agregó esa columna para que el dueño pueda
  cuadrar caja con un solo archivo. (En su momento también se agregó
  una columna de cupón/descuento, pero se quitó junto con todo el
  sistema de cupones — ver la nota en "Marketplace — mínimo,
  direcciones, ETA sugerido".)
- **Comanda impresa** (`printOrder`) tampoco mostraba propina —
  agregado, mismo criterio.
- **`functions/index.js`**: `STATUS_LABELS` no tenía texto para
  `no_entregado`/`cancelado` — sin desplegar todavía (sigue pendiente
  de plan Blaze), pero si se despliega sin este cambio esos dos
  estados mandarían un texto crudo poco claro en la notificación push.

## Búsqueda de pedidos, historial del domiciliario, pedido en curso, calificar domiciliario

Cuatro agregados más, pensados en el uso diario real de cada rol
(hubo un quinto, el sistema de reseñas — reseña por producto y muro
de reseñas — que se implementó y luego se quitó por completo a
pedido del usuario; no queda rastro en código, CSS ni reglas de RTDB):

- **Buscar pedido por nombre/teléfono** (`admin.js` →
  `applyOrderSearch`, usa `normalizeText` de `data.js`): input sobre los filtros
  de estado — busca sin acentos ni mayúsculas, se aplica ENCIMA del
  filtro activo (ej. "Todos" + "maría" busca entre todos los estados).
- **Historial de cierres propios del domiciliario** (`driver.js` →
  `subscribeCashHistory`): `<details>` plegable bajo la tarjeta de
  cierre de turno, con sus propios cierres anteriores. Necesitó
  ampliar la regla de `cashSettlements` para que un domiciliario
  pueda leer (antes solo podía escribir uno nuevo, nunca leer
  ninguno) — con query por `driverId`, mismo patrón que `orders`.
- **Barra de "pedido en curso"** (`#active-order-bar` en `index.html`,
  `ui.renderActiveOrderBar`): flota sobre la barra inferior mientras
  haya un pedido activo (ni entregado, cancelado, ni no_entregado).
  La suscripción a "mis pedidos" (`app.js` → `startOrdersTracking`)
  se movió de "solo mientras el drawer de perfil está abierto" a
  "toda la sesión mientras haya alguien logueado" — la alimentan
  tanto el drawer como esta barra, un solo listener para las dos.
  Tocar la barra abre el drawer de perfil (no duplica la vista).
- **Calificar al domiciliario** (`auth.js` → `rateDriver`,
  nodo `driverRatings/{orderId}`): esta SÍ se queda — es la
  calificación al domiciliario que hizo la entrega, un concepto
  aparte del sistema de reseñas de producto que se quitó. Un pedido
  solo se puede calificar una vez (la regla exige `!data.exists()`);
  al calificar, también se marca `orders/{id}/driverRatingSubmitted:
  true` para que el botón desaparezca sin tener que releer
  `driverRatings`. Reutiliza `pickReasonDialog` con opciones tipo
  "★★★☆☆ Regular" en vez de construir un selector de estrellas aparte.
  **Se detectó que quedó a medias**: el cliente sí podía calificar y
  el dato se guardaba bien en Firebase, pero nada lo leía de vuelta —
  ni el domiciliario ni el panel lo mostraban en ningún lado.
  Corregido agregando los dos lados que faltaban, ambos vía la misma
  query por `driverId` que ya usan `orders`/`cashSettlements`:
  - `driver.js` (`subscribeRatings`/`renderRatingSummary`): el propio
    domiciliario ve su promedio y cantidad de calificaciones
    (`★ 4.8 · 12 calificaciones`) bajo su nombre en el saludo
    (`#driver-rating-summary`, oculto si todavía no tiene ninguna).
  - `admin.js` (`subscribeDriverRatings`/`renderDriverRatingsList`):
    el dueño ve el promedio de CADA domiciliario habilitado en la
    pestaña Domiciliarios (bloque "Calificaciones", arriba de
    "Cierres de turno") — a diferencia del domiciliario, el dueño lee
    el nodo `driverRatings` completo (sin query, las reglas ya le dan
    acceso total) y agrega por `driverId` en el cliente.

El "4.8 · calificación" del hero (que estaba **hardcodeado** desde
antes) se quitó del todo junto con las reseñas, en vez de dejarlo
como un número fijo inventado — el hero de `index.html` volvió a
tener solo 2 datos (tiempo de entrega, ciudad), no 3.

## Reorganización del panel — menos confusión al buscar cosas

El panel había ido creciendo pestaña por pestaña y dos de ellas se
volvieron "cajón de sastre" (mezclaban cosas sin relación real entre
sí). Reorganizado así:

- **Nueva pestaña "Domiciliarios"** (`data-role="dueno"`, mismo
  patrón de visibilidad que Menú/Reportes/Configuración): antes los
  "Cierres de turno" vivían dentro de Reportes, pero un dueño
  buscando algo de un domiciliario no piensa en "Reportes" — piensa
  en "Domiciliarios". Sola por ahora (un solo bloque), pero ya con
  pestaña propia para cuando se agregue más (ej. lista de
  domiciliarios activos).
- **"Reportes" quedó solo con métricas de negocio de verdad**: Ventas,
  Productos más vendidos, Exportar CSV — se sacaron "Cierres de
  turno" (ver arriba) y "Errores recientes" (ver abajo), que no son
  reportes de negocio.
- **"Errores recientes" se movió a Configuración**, dentro de un
  `<details>` plegado por defecto llamado "Avanzado" — es una
  herramienta técnica de depuración, no algo que un cajero necesite
  ver a diario; sigue ahí para cuando haga falta, pero no compite
  visualmente con lo que sí se usa seguido.
- **Navegación rápida (`.admin-jump-nav`)** al inicio de
  Configuración: pastillas ancla (`<a href="#config-...">`) a cada
  una de sus secciones (Datos del negocio, Zonas, Avanzado — antes
  también "Cupones", quitada junto con todo ese sistema) — evita
  tener que desplazarse a ciegas. Usa anclas HTML
  normales + `scroll-behavior: smooth` (nuevo en `base.css`, global
  a las 3 apps) — no hace falta JS aparte para el salto.
- Al agregar `#tab-domiciliarios`, no olvidar que existe una regla
  de layout de escritorio (`admin.css`, `@media (min-width: 1080px)`)
  que lista los IDs de sección explícitamente para ubicarlos en la
  columna del contenido (`grid-column: 2`) — un tab nuevo que no se
  agregue a esa lista se ve roto solo en pantallas anchas, no en
  celular (así se me pasó la primera vez con este mismo cambio).

## Reorganización de marketplace y domiciliarios — mismo criterio que el panel

Mismo espíritu que la reorganización del panel: lo que se usa a
diario queda primero y bien separado, lo que se usa poco se pliega o
se etiqueta aparte, sin cambiar ninguna lógica de negocio.

- **Checkout del cliente** (`index.html` → `#checkout-view`): era un
  solo formulario largo sin secciones visuales (modo de entrega,
  dirección, teléfono, hora y total, todo seguido). Se le agregaron
  encabezados cortos (`.checkout-section-title`): "¿Cómo lo quieres?",
  "Datos de contacto", "¿Cuándo?", "Resumen" (había un cuarto,
  "¿Tienes un cupón?", quitado junto con el sistema de cupones) — y
  el resumen de totales quedó en una caja con borde propia
  (`.checkout-summary-box`) en vez de flotar suelto al final.
  Ningún campo cambió de sitio, solo se agruparon visualmente.
- **App de domiciliarios** (`driver.html`): el orden de arriba a
  abajo antes era Saludo → Mi perfil (nombre/teléfono) → Cierre de
  turno → Pedidos — es decir, lo que el domiciliario más necesita ver
  al abrir la app (sus pedidos) quedaba enterrado debajo de dos
  tarjetas que casi no se tocan en el día a día. Nuevo orden: Saludo
  → **Pedidos** (tabs + lista, ahora lo primero) → Cierre de turno
  (se revisa varias veces al día, se deja visible) → **Mi perfil**
  (ahora un `<details open>` con su propio título y flecha — se llena
  una sola vez, por eso es plegable, pero abierto por defecto la
  primera vez para que no falte quien no sepa que existe).

## Pestañas del panel rotas en celular/tablet

`.admin-tabs` reutiliza `.segmented` (components.css), pensado para
2-3 botones repartidos en partes iguales (`flex:1`) — con las 6
pestañas que tiene hoy el panel (Pedidos/Inventario/Menú/
Domiciliarios/Reportes/Configuración), eso las aplastaba y cortaba
"Configuración" fuera de la pantalla en celular y tablet (se veía
bien solo desde 1080px, donde ya pasa a barra lateral vertical).
Corregido en `admin.css`: por debajo de 1080px, `.admin-tabs` ya no
reparte en partes iguales — se desliza horizontal (`overflow-x:
auto`) con cada botón del ancho de su propio texto (`flex: none`,
`white-space: nowrap`), mismo patrón que `.admin-filter-row`. A
1080px+ se resetea a `overflow-x: visible` porque ahí la barra lateral
ya no necesita deslizarse (los botones se apilan verticales y ocupan
el ancho completo). Si se agrega una séptima pestaña algún día, esto
ya escala solo — no hace falta tocar nada más.

## Un solo tema — se quitó el modo oscuro (historial)

Hubo una etapa donde el proyecto tuvo modo oscuro/claro alternable
con un botón en el header (`js/theme.js`, `data-theme="light"` en
`<html>`, preferencia en `localStorage`) — el usuario pidió quitar el
oscuro por completo y dejar un único tema claro, sin botón para
cambiarlo. Se eliminó todo rastro: `js/theme.js` borrado, el botón
`#btn-theme-toggle` y el script inline anti-parpadeo quitados de las
3 páginas, y `css/variables.css` quedó con un solo bloque `:root`
(los valores que antes eran del modo claro, que es el que se
conservó) — nunca más un bloque `:root[data-theme='light']` aparte.
Los bloques `body:has(#admin-app)`/`body:has(#driver-app)` que
redefinían `--color-text-faint`/`--color-text-muted` por app (ver
"Legibilidad — panel y app de domiciliarios" más abajo) volvieron a
ser una sola regla incondicional cada uno, sin el prefijo de tema que
tenían antes. Si en el futuro se vuelve a pedir un modo oscuro, no
hay que reconstruirlo desde cero: el historial de git (o la versión
antes de este cambio) tiene la implementación completa ya resuelta,
incluidos varios gotchas de especificidad CSS que costó encontrar
(ver más abajo qué se aprendió de eso, aunque el código en sí ya no
esté).

**Lo que quedó permanentemente del trabajo de ese modo claro** (el
tema final, ahora el único): la paleta cálida clara actual en
`variables.css`, el degradado suave del hero/pantalla de acceso
(`--hero-glow-1/2` en vez de un rgba fijo directo en el selector —
el valor original pensado para fundirse en negro se veía como un
lavado salmón muy intenso sobre fondo claro), `--color-surface-raised`
sin ser blanco puro (menos salto duro contra el crema del fondo), y
sombras (`--shadow-card`/`--shadow-float`) más suaves. También quedó
la corrección de `.app-header .brand-name`/`.app-header
.btn-danger-link` en `layout.css`: la barra del header es oscura a
propósito (contraste de marca), así que ese texto no puede seguir
`var(--color-text)`/`var(--color-danger)` (pensados para el fondo
claro del resto del sitio) — se fijaron a un color claro/rojo propio
que se lea sobre esa barra oscura, sin tocar esas mismas clases fuera
del header.

## Responsivo — sin ancho tope, ocupa toda la pantalla real

Versión final de esto (dos vueltas): primero se intentó que
`#app`/`#admin-app`/`#driver-app` crecieran con la pantalla pero con
un tope fluido (`min(1600px, 92vw)`, etc.) — visualmente eso seguía
dejando una franja/sombra notoria a los lados en cualquier celular
grande, tablet o monitor (el usuario lo describió como "se ve
recortado" y "esa sombra a la derecha"). Se quitó el tope por
completo: **`#app`, `#admin-app` y `#driver-app` ya no tienen
`max-width`/`margin: auto` en ningún breakpoint — ocupan el 100% real
del ancho de pantalla siempre**, en celular, tablet, portátil y
monitor de escritorio por igual. Lo único que cambia con el ancho de
pantalla es cuántas columnas tiene cada grilla de tarjetas
(`.product-grid`, listas del panel, `#driver-orders-list` — hasta 5
columnas a partir de 1920px) y algunos paddings/tamaños de texto —
nunca un tope de ancho del shell completo. Drawers y modales siguen
sin crecer (`--max-width`, fijo, sin tocar) porque un panel de
carrito no debe verse como una página completa en un monitor grande;
tampoco se tocaron topes puntuales de tarjetas sueltas como
`.driver-profile-card`/`.driver-quick-stats`, esos son intencionales.

**Ya no existe `--app-width`** (se quitó de `variables.css`) — si en
el futuro hace falta centrar algo fijo dentro de un shell que ahora
es 100% ancho, no revivir ese patrón; usar un `max-width` puntual en
el elemento mismo, como ya se hace con `.driver-profile-card`.

**La "sombra a la derecha" que el usuario seguía viendo después de
esto (en celular Y en escritorio, hasta en incógnito) NO era el ancho
del shell** — para cuando se reportó, el `max-width` de arriba ya
estaba desplegado y confirmado sin overflow (`scrollWidth ===
innerWidth` probado en vivo contra el sitio real). La causa de
verdad: `base.css` tiene una regla `::-webkit-scrollbar` global (para
que la barra de scroll se vea delgada/discreta en vez de la del
sistema) que le ponía color al "thumb" (`--color-border`) pero nunca
al "track" (el riel de fondo) — sin eso, el navegador dibuja el track
con su gris/negro por defecto, pegado al borde derecho de TODA la
página, de arriba a abajo — mucho más notorio en modo claro contra el
fondo crema. Se corrigió agregando `::-webkit-scrollbar-track {
background: var(--color-bg); }` (se adapta solo con el tema) más el
equivalente de Firefox (`scrollbar-width: thin; scrollbar-color:
var(--color-border) var(--color-bg);` en `html`). Ojo para el futuro:
el navegador de pruebas (Claude Browser) no renderiza la barra de
scroll del sistema en las capturas de pantalla, así que este tipo de
bug es invisible en las pruebas automatizadas de este proyecto — hay
que pedirle una captura real al usuario o razonarlo por descarte
cuando el ancho/overflow ya está descartado mediante JS
(`document.documentElement.scrollWidth` vs `innerWidth`).

**La causa de fondo de verdad, la que sobrevivió a las dos correcciones
anteriores** (el usuario la siguió reportando después del fix de
ancho Y del fix de scrollbar-track): `.drawer` (carrito/perfil, en
`layout.css`) tenía `box-shadow: -12px 0 40px rgba(0,0,0,0.5)` puesto
de forma incondicional, no solo en `.drawer.is-open`. Aunque el
drawer cerrado está fuera de pantalla (`transform: translateX(100%)`,
por `right: 0` eso lo saca exactamente al ras del borde derecho del
viewport), un `box-shadow` con 40px de desenfoque igual pinta más
allá de la caja del elemento — ese desenfoque se colaba de vuelta
hacia adentro del viewport por el borde derecho, visible como una
franja oscura vertical en TODA la pantalla (carrito y perfil son
drawers, así que siempre hay uno "cerrado" montado en el DOM). Esto
pasaba en cualquier navegador/dispositivo, a diferencia de los dos
bugs anteriores (ancho del shell, color del track del scroll) — por
eso sobrevivía a ambos fixes y hasta al modo incógnito. Corregido
moviendo el `box-shadow` a `.drawer.is-open` únicamente (con
`box-shadow: none` en el estado base y una transición de
`box-shadow` agregada junto a la de `transform`, para que no aparezca
de golpe). Si se agrega otro drawer/panel deslizante en el futuro,
revisar esto de una vez: cualquier `box-shadow` con blur grande en un
elemento `position: fixed` que se "esconde" solo con `transform`
(nunca con `display`/`visibility`) puede filtrarse de vuelta al
viewport de la misma forma.

**De paso, un bug de overflow en el header que ya venía de antes**
(no de este cambio puntual, pero se notó al probar el responsivo): con
6 botones de ícono en el header (tema, llamar, WhatsApp, Instagram,
buscar, cuenta) más el nombre de marca, en un celular angosto (~375-
430px) el conjunto ya no cabía y el ícono de cuenta se salía del
header en vez de quedar recortado o deslizable. Causa raíz:
`.header-actions` es un hijo flex, y un hijo flex por defecto no se
encoge por debajo del ancho de su propio contenido (`min-width: auto`
implícito) — así que un `overflow-x: auto` puesto ahí sin más nunca
llegaba a activarse. Se corrigió con `min-width: 0` en
`.header-actions` (para que el overflow sí aplique, mismo patrón de
`.admin-tabs`/`.admin-filter-row`: scroll horizontal con scrollbar
oculta) más un `@media (max-width: 480px)` que esconde el texto de
marca (queda el logo solo) y achica un poco los botones — entre las
dos cosas, en la práctica ya no hace falta deslizar en un celular
normal. Cualquier botón nuevo que se agregue al header en el futuro
debe tenerse en cuenta contra este mismo límite.

## Comanda impresa y exportación a Excel — dos bugs reales encontrados

- **Comanda impresa con páginas en blanco de más**: el `@media print`
  (`admin.css`) ocultaba el resto del panel con
  `body * { visibility: hidden }` en vez de `display: none`.
  `visibility: hidden` NO saca el elemento del flujo del documento —
  `#admin-app` (con toda la lista de pedidos, modales, etc.) seguía
  ocupando su alto real aunque invisible, así que el navegador
  generaba tantas páginas en blanco como hiciera falta para "imprimir"
  ese alto vacío (una comanda de una sola página terminaba en 5+
  páginas). Corregido con `body > *:not(#print-ticket) { display:
  none !important; }` — eso sí saca todo lo demás del flujo, el
  documento impreso mide exactamente lo que mide la comanda. Si se
  agrega otra plantilla de impresión en el futuro (ej. un recibo para
  el cliente), aplicar el mismo patrón, nunca `visibility: hidden`
  para "ocultar" contenido que no debe ocupar espacio.
- **Logo de la comanda invisible en computador pero no en celular**:
  `printOrder` (`admin.js`) insertaba el `<img>` del logo con
  `innerHTML` y llamaba a `window.print()` en el mismo instante,
  síncrono — en computador, la vista previa de impresión de Chrome
  puede generarse antes de que el navegador termine de cargar esa
  imagen recién creada, y sale en blanco. En celular casi nunca pasa
  porque abrir la hoja de compartir/imprimir nativa ya toma más
  tiempo, de sobra para que cargue. Corregido haciendo `printOrder`
  `async` y esperando el evento `load` (o `error`, o un margen de
  800ms) del `<img class="ticket-logo">` antes de llamar a
  `window.print()`. Si se agrega otra imagen a la comanda, debe pasar
  por el mismo `await` antes de imprimir.
- **Exportación a Excel reescrita de cero**: `exportOrdersCSV` (ahora
  `exportOrdersXLSX`, `admin.js`) generaba un `.csv` crudo — sin
  formato de moneda, la columna de productos como un solo texto largo
  sin ajustar, sin nada de marca — que se veía "desordenado" al
  abrirlo en Excel. Ahora genera un `.xlsx` de verdad con **ExcelJS**
  (librería externa, cargada solo cuando se pulsa el botón —
  `loadExcelJS()` inyecta el script de `cdn.jsdelivr.net` una sola vez
  y cachea la promesa; no vale la pena sumarla al App Shell para algo
  que se usa una vez cada tanto). El archivo generado tiene: una
  franja roja de encabezado con el logo (`icon-512.png`, insertado
  como imagen real — el `.svg` del proyecto no sirve para esto,
  ExcelJS solo embebe PNG/JPEG/GIF) y el nombre del restaurante,
  columnas con ancho fijo pensado para el contenido de cada una,
  texto de productos con salto de línea dentro de la celda
  (`\n` + `wrapText: true`, no todo en una sola línea con `|` como
  antes), montos con formato de pesos colombianos (`"$"#,##0`), y la
  fila de encabezados de columna congelada (`views: [{state:'frozen',
  ySplit: 4}]`) para poder desplazarse por muchos pedidos sin perder
  de vista qué es cada columna. Si el logo no se puede leer por
  cualquier motivo, la exportación sigue sin él (nunca bloquea todo el
  archivo por eso). El botón (`#btn-export-orders-csv` — el id se dejó
  igual para no tocar CSS/HTML de más, aunque ya no exporta CSV) queda
  con `.is-loading` mientras genera el archivo, mismo patrón visual
  que el resto de acciones de envío del sistema.

## Ronda de ajustes (2026-09-17)

Lista larga de cambios pedidos por el usuario, hechos en la misma sesión:

- **Horario automático del negocio** (`js/settings.js` → `getScheduleStatus`,
  nuevos campos `useSchedule`/`manualOverride`/`weeklyHours` en `settings`):
  si `useSchedule` está prendido, "abierto/cerrado" se calcula solo contra
  el horario semanal configurado (pestaña Configuración → "Horario del
  negocio" en `admin.js`/`admin.html`), con mensaje automático de "abrimos
  [hoy/mañana/día] a las HH:MM". El dueño puede forzarlo con
  `manualOverride` ('open'/'closed') por encima del horario. Si
  `useSchedule` sigue apagado, el comportamiento es el de siempre
  (`isOpen` manual + `closingTime` opcional) — instalaciones que no toquen
  esto no notan ningún cambio. `app.js`/`ui.js` ya no leen `settings.isOpen`
  directo, todos pasan por `getScheduleStatus()` primero.
- **Sistema de calificaciones a domiciliarios ELIMINADO por completo**
  (a pedido del usuario, decisión explícita — no era un bug). Se quitó de
  las 3 apps: `auth.js` (`rateDriver`), `app.js`/`ui.js` (botón "Calificar"
  en el detalle del pedido del cliente), `driver.js` (resumen de estrellas
  propio) y `admin.js` (promedio por domiciliario en la pestaña
  Domiciliarios). El nodo `driverRatings` en RTDB queda huérfano (datos
  viejos, nada los lee ni los escribe ya) — no hay urgencia de borrarlo a
  mano, pero no reintroducir código que lo use sin que el usuario lo pida
  de nuevo.
- **Pestaña Domiciliarios reconstruida por completo** — antes era un
  bloque vacío sin filtros (`.admin-menu-section` a secas, tarjetas sin
  grid, por eso "se veían todas encima"). Ahora:
  - Grid explícito (`.admin-drivers-grid`, 1/2/3 columnas según ancho) +
    filtro por pastillas (Todos/Disponibles/No disponibles/Deshabilitados,
    `state.driversFilter`).
  - **El dueño ahora CREA la cuenta del domiciliario directo desde el
    panel** (`handleCreateDriver` en `admin.js`) — ya no hace falta que el
    domiciliario se autorregistre en `driver.html` y que el dueño le dé
    acceso a mano en la consola de Firebase. Usa el mismo patrón que
    `panel-admin` del sistema de mesas para esto (`authSecundaria()` en
    `shared/auth.js`): una app de Firebase SEGUNDA
    (`createDriverAuthAccount` en `firebase-config.js`, nombre de app
    `'admin-crea-domiciliarios'`) crea la cuenta de Authentication sin
    tocar la sesión del dueño, después se hace `signOut` de esa app
    secundaria. El perfil se crea con `access: true` de una vez.
  - Botón de WhatsApp (ícono SVG inline, `whatsappHref()` en `admin.js`)
    junto al teléfono de cada domiciliario — asume indicativo Colombia
    (57) si el teléfono no lo trae, igual que el resto del panel.
  - **`state.drivers` (para el selector "Domiciliario" de cada pedido)
    ahora solo incluye domiciliarios con `available: true`** (o el ya
    asignado a ESE pedido, para poder verlo/reasignar aunque se haya
    desconectado) — antes se podían asignar pedidos a alguien sin
    "Disponible" activado, corregido a pedido del usuario. `state.allDrivers`
    es la lista completa (incluye deshabilitados), solo para esta pestaña.
  - **⚠️ Requiere desplegar `database.rules.json` antes de usarse en
    producción** — se le agregaron reglas para que un admin dueño (no
    cajero) pueda escribir `name`/`phone`/`email`/`available`/`createdAt`
    bajo `drivers/{uid}` de OTRO uid (antes esos campos solo los podía
    escribir el propio domiciliario, `auth.uid === $uid` — necesario
    porque ahora el dueño crea el perfil completo desde el panel).
    `access` ya lo permitía. Desplegar con `firebase use rodiziomarketplace
    && firebase deploy --only database` antes de crear el primer
    domiciliario desde el panel nuevo, si no las escrituras van a fallar
    con "permission denied".
- **Reportes: filtro de fecha (desde/hasta) y de zona** (`admin.js` →
  `ordersInReportRange`/`zoneKeyForOrder`). La zona NO se guarda en el
  pedido — se recalcula al vuelo contra `order.address` y las zonas
  configuradas HOY (`settingsApi.matchZone`, mismo criterio que usa el
  checkout del cliente), así que funciona también sobre pedidos viejos sin
  tocar datos. Con el filtro activo aparece una tarjeta "Rango filtrado" y
  el top de productos usa ese rango en vez de los últimos 30 días fijos.
  El botón de exportar a Excel respeta el mismo filtro (exporta el rango
  en vez de "hoy" si hay algo puesto) — ver siguiente punto.
  **Limitación heredada sin resolver**: sigue aplicando sobre
  `state.orders`, que en el panel es `limitToLast(state.ordersLimit)` —
  un rango de fechas amplio en un local con mucho volumen podría no ver
  todos los pedidos de ese rango si no se ha pedido "Cargar pedidos
  anteriores" lo suficiente.
- **Excel de pedidos**: ahora también dice el teléfono del restaurante y
  "generado el [fecha]" en el encabezado, y agrega una fila de totales al
  final (solo lo `pagado === true`, mismo criterio que "Ventas").
- **Buscador de pedidos reordenado**: en la pestaña Pedidos, el campo de
  búsqueda por nombre/teléfono ahora va DEBAJO de los filtros de estado
  (antes iba arriba) — a pedido del usuario, quería la navegación de
  estados primero.
- **Zoom deshabilitado**: `maximum-scale=1, user-scalable=no` agregado al
  viewport de `index.html`, `admin.html` y `driver.html` (no se tocó
  `panel-cliente` ni las apps de mesa, esto es solo del marketplace). Ojo:
  esto también bloquea el zoom de accesibilidad para baja visión — el
  usuario lo pidió así a propósito, no es un descuido.
- **Menú (`shared/menu.js`, fuente única — regenerar con
  `node scripts/build-menu-data.mjs` y volver a subir con
  `firebase database:set` si se vuelve a tocar, ver `scripts/README.md`)**:
  - Categoría **"Licores" eliminada por completo** (15 productos, no solo
    ocultada) — a pedido explícito del usuario ("borrar", no "ocultar").
  - **Sin foto**: `COM-04` Porción de Chorizo y `PAR-09` Churrasco (se les
    quitó el campo `img`, quedan con el ícono genérico — el sistema ya
    soportaba productos sin foto). Ojo: `PAR-07` Bife Chorizo YA no tenía
    foto de antes; se interpretó que "la foto del chorizo" se refería a
    la Porción de Chorizo (COM-04), que sí tenía una. Si el usuario quería
    otra, es un cambio de una línea.
  - **Bebidas por sabor consolidadas en un solo producto** (antes cada
    sabor era un producto aparte): `BEB-05` "Coca-Cola Pet 400 ml" (antes
    +`BEB-06` Zero), `BEB-07` "Postobón 400 ml" (antes +`BEB-08` Uva),
    `BEB-21` "Soda Hatsu" (antes +`BEB-22/23/24`, 4 sabores),
    `BEB-29` "Té Hatsu" (antes +`BEB-30..34`, 6 sabores). Los ids borrados
    NO se reusan (quedan huecos en la numeración, es el patrón normal del
    archivo — no hace falta que sean consecutivos). Todas llevan la misma
    fórmula de descripción: se listan los sabores + "escribe el que
    prefieras en las notas del pedido. Si no tenemos ese sabor, te
    contactamos o puedes elegir otro" — mismo texto que ya tenían (ahora
    reforzado) `BEB-03` Jugos Naturales y `BEB-04` Frappes, que ya eran
    genéricas de antes. El precio de cada grupo consolidado era IGUAL
    entre sabores, así que no hubo que decidir qué precio dejar.
  - Menú **ya subido a las dos bases** (`rodiziomarketplace` y
    `rodizio-eb49a`) con `firebase database:set -f` sobre
    `/categories`, `/products`, `/sugerencias`, `/sugerenciasPorProducto`
    — no quedó pendiente de desplegar, a diferencia de las reglas de
    arriba.
  - **Pendiente del usuario, no implementado todavía**: consolidar el
    resto de bebidas con variantes de un mismo producto si las hay
    (revisar si quedó alguna) y la rotación automática de fotos del menú
    (14 fotos en `img rodizio/1.webp`…`14.webp`, fuera del repo — el
    usuario dijo que iba a revisar cuáles combinan con qué fechas antes
    de pedir la lógica de rotación).
- **Rediseño de navegación de la tienda cliente** (`tienda/index.html`,
  `js/app.js`, `js/ui.js`, `css/layout.css`, `css/brand.css`,
  `css/components.css`) — a partir de una imagen de referencia de OTRO
  restaurante que el usuario compartió (guardada fuera del repo, en
  `../img rodizio/` y `../referenci.png`, respecto a la raíz de
  `sistema-rodizio/`):
  - **Categorías pasaron de pastillas horizontales fijas a una barra
    lateral IZQUIERDA deslizable** (`#category-sidebar`, mismo patrón que
    `.drawer` de carrito/perfil pero con `transform: translateX(-100%)`
    en vez de hacia la derecha). Se abre con el nuevo botón hamburguesa
    (`#btn-category-menu`, ícono ☰) y se cierra con su botón X, tocando
    el `#overlay` compartido, o al elegir una categoría
    (`selectCategory()` en `app.js` ahora llama
    `ui.toggleSheet('category-sidebar', false)` al final).
    `ui.renderCategoryNav()` NO cambió su lógica — solo cambió el CSS de
    `.category-nav`/`.category-tab` (de fila horizontal con scroll a
    lista vertical de filas ícono+texto).
  - **Fotos de producto ahora circulares** (`.product-thumb`,
    `border-radius: 50%` en vez de 14px/`var(--radius-sm)`) — el
    contenedor ya era un cuadrado perfecto (96×96 en brand.css, 84×84 en
    components.css) así que el círculo queda perfecto, no ovalado.
    **Se aplicó el mismo cambio en `panel-cliente/styles.css`
    (`.plato-img`)**, que es la otra app donde el usuario notó fotos "no
    circulares" (antes `border-radius:17px`, un cuadrado redondeado).
  - **Nueva fila `.search-row`** arriba del buscador: botón hamburguesa
    (categorías) + buscador (`.search-bar`, ahora `flex:1` dentro de la
    fila en vez de ocupar todo el ancho) + botón de carrito nuevo
    (`#btn-search-cart`, mismo `openCartDrawer()` que ya usaba la barra
    inferior — es un segundo atajo, no reemplaza `#nav-carrito`). El
    badge del carrito (`renderCartBadge` en `ui.js`) ahora actualiza DOS
    badges (`#bottom-nav-cart-badge` y el nuevo `#search-row-cart-badge`).
  - **`sw.js` → `rodizio-cucuta-v83`** (bump por los cambios de CSS/JS/HTML
    de esta ronda).
  - **Lo que NO se tocó, a propósito**: los botones existentes del header
    (llamar, WhatsApp, Instagram, buscar-scroll, cuenta) — la referencia
    del usuario tenía un header más simple, pero reconstruir todo el
    header desde cero arriesgaba romper funciones que ya andaban bien sin
    poder probarlas visualmente en esta sesión (el usuario pidió no
    gastar en pruebas de navegador por cambios chicos). Si el resultado
    visual no calza con lo que el usuario tenía en mente, es la primera
    zona a revisar.
  - **Logo nuevo (`LOGOS-RODIZIO.png`, fondo negro sólido) e ícono
    (`iconos1.png`, tabla de tamaños) llegaron en esta ronda pero NO se
    conectaron todavía** — el usuario dijo en un mensaje anterior que él
    mismo iba a agregar esas imágenes; quedan en `../img rodizio/` fuera
    del repo hasta que se pida explícitamente reemplazar
    `brand/logo-white.webp`/los íconos actuales del manifest. Ojo: la
    tabla de `iconos1.png` incluye tamaños de Windows ICO/macOS ICNS/Apple
    Watch que NO aplican acá (esto es una PWA web, no una app nativa) —
    si se pide generar el set completo, solo hacen falta favicon,
    Android/PWA (192/512, con variante maskable) y apple-touch-icon (180).

## Segunda pasada de la ronda de ajustes (mismo día, 2026-09-17)

Se completó casi todo lo que había quedado pendiente de la ronda de
arriba, cada cosa en su propio commit sobre `fusion`:

- **Stepper del pedido simplificado** (`ui.js` → `ORDER_STEPS` +
  `stepIndexForStatus`): de 7 pasos a 3 (En preparación / Listo / En
  camino). Los estados sin paso propio se agrupan en el más cercano —
  ver el comentario junto a `ORDER_STEPS`.
- **Estilo "panel serio" del admin** (`admin.css`, bloque
  `body:has(#admin-app)` después de la de legibilidad): paleta gris
  pizarra + texto casi negro, tipografía del sistema en vez de
  Anton/Manrope, radios de borde chicos (`--radius-pill` incluido) y
  sombras sin tinte de color — todo vía variables de `variables.css`, no
  tocando cada regla. La app de clientes y de domiciliarios NO cambiaron
  (decisión explícita: el estilo serio es solo para admin).
- **Menú e Inventario con filtro** (`admin.js` →
  `filterProductsBy`/`renderCategoryFilterPills`, reutilizado por
  `renderProductsList` y `renderStockList`): antes las dos pestañas
  listaban los 130+ productos de un tirón. Ahora cada una tiene su propio
  buscador + pastillas de categoría (mismo patrón que ya usa
  `mesero-app`, que fue la referencia que pidió el usuario).
- **Logo nuevo conectado — solo en la pantalla de carga**
  (`tienda/brand/logo-splash.png`, copiado de
  `../img rodizio/LOGOS-RODIZIO.png`): esa imagen tiene fondo negro
  SÓLIDO (no transparente), así que NO sirve para el logo del header
  (necesita transparencia sobre el degradado) ni el del banner de error
  (fondo claro) — en los dos se vería como un rectángulo negro pegado.
  La pantalla de splash sí tiene fondo oscuro (`#0c0e12`), casi el mismo
  negro de la imagen, así que ahí encaja bien. Si más adelante se
  consigue una versión con fondo transparente del mismo logo, ahí sí
  se podría usar también en el header.

**Sigue bloqueado, no es algo que se pueda "solo hacer":**
- **Autorizar `djgv@gmail.com` como admin** en `rodiziomarketplace`
  — se necesita su UID de Firebase Authentication. Se intentó conseguirlo
  vía `firebase auth:export` pero el clasificador de seguridad de Claude
  Code lo bloqueó (exporta contraseñas hasheadas de TODOS los usuarios,
  con razón). Pedirle el UID al usuario (Console → Authentication →
  Users → buscar el correo → copiar UID) y hacer
  `set(ref(db, 'admins/{uid}'), true)` (o `'dueno'`/`'cajero'`) a mano.
- **Íconos del PWA en todos los formatos** (`../img rodizio/iconos1.png`
  trae una tabla de referencia con un logo placeholder "R", pero incluye
  categorías que no aplican a esta app — es una PWA web, no una app
  nativa, así que Windows ICO/macOS ICNS/Apple Watch sobran). Si se pide
  generar el set real a partir del logo de Rodizio, solo hacen falta:
  favicon (16/32), Android/PWA (192/512, con variante maskable) y
  apple-touch-icon (180).
- **Rotación automática de fotos del menú** (14 fotos en
  `../img rodizio/1.webp`…`14.webp`) — el usuario dijo que iba a revisar
  cuáles combinan con qué fechas antes de pedir la lógica.

## Ronda de ajustes 2026-09-18 (anotada primero a pedido del usuario, validada por chat punto por punto, y ya implementada — ver qué quedó pendiente al final)

1. **✅ HECHO — Botón ☰/buscador se perdía al hacer scroll**: causa real confirmada — `.search-row` (contiene el botón de categorías, el buscador y el carrito) nunca quedó con `position: sticky` de verdad al reorganizarse en la ronda del "rediseño de navegación" (solo `.app-header` se quedaba fijo). Se le agregó `position: sticky; top: var(--header-height)` en `brand.css`. "Simplificar las categorías" quedó SIN tocar — no se aclaró qué simplificar exactamente, pendiente si se vuelve a pedir con más detalle.
2. **✅ HECHO — Ocultar productos del marketplace** (distinto de "Agotado"): nuevo campo `products/{id}/hidden: true`. Botón "Ocultar"/"Mostrar" en la pestaña Inventario del panel (`admin.js` `renderStockList`, botón `.admin-stock-hide-btn`) — escribe directo con `update()`, `null` para quitarlo. Filtrado en las 3 vistas del cliente que leen `PRODUCTS` (`ui.js`: grilla por categoría/búsqueda, favoritos, carrusel de destacados) con `!p.hidden`. `outOfStock` sigue igual (muestra "Agotado" pero no lo saca del catálogo) — son dos conceptos separados a propósito.
3. **⏳ SIGUE PENDIENTE — `iconos1.png`**: el usuario confirmó que "sí hay algo ahí que quiere usar" pero no dijo qué — falta que aclare qué parte de esa tabla de tamaños (que solo tiene el placeholder "R", no el logo real) quiere que se recorte, o si en realidad se refiere a otra imagen.
4. **✅ HECHO — Buscador movido debajo del carrusel**: `.search-row` (con el botón ☰, buscador y carrito) se movió en `index.html` de justo antes del hero (`.marketplace-hero`) a justo después, antes de la barra de stats. Sigue sticky (ver punto 1), así que ahora "se pega" recién después de pasar el carrusel al hacer scroll — comportamiento esperado.
5. **✅ HECHO — Fotos de producto completas, no recortadas en círculo**: `.product-thumb` pasó de círculo 96×96 (`border-radius: 50%`, recortaba las esquinas de la foto cuadrada de 150×150) a cuadrado 76×76 con `border-radius: var(--radius-sm)` y `object-fit: contain` (nunca recorta). Reemplaza la decisión de "fotos circulares" de la ronda de rediseño anterior — el usuario confirmó el cambio explícitamente en este mensaje.
6. **✅ HECHO — Barra roja "Ver canasta" simplificada + barra inferior solo con sesión iniciada**: `#floating-cart-bar` pasó de franja ancha (texto + subtotal) a un botón circular flotante (52px, ícono de carrito + badge de cantidad), abajo a la derecha. Aparte, `#bottom-nav` (Inicio/Favoritos/Carrito/Perfil) ahora empieza `hidden` y solo se muestra cuando `auth.onAuthChange` confirma una sesión activa (`js/app.js`) — un visitante sin sesión sigue pudiendo entrar a iniciar sesión por el botón de cuenta del header. Tuvo el mismo gotcha de siempre con `[hidden]` (`.bottom-nav` ya trae su propio `display`, se le ganaba en la cascada) — se agregó `.bottom-nav[hidden] { display: none; }` en `layout.css`.
7. **✅ HECHO — Filtro "¿Para cuántas personas?" eliminado por completo**: se quitó el HTML (`#portion-calc`), toda la lógica en `app.js` (`bindPortionCalculator`, `setPortionPeople`, `renderPortionSuggestion`, etc.), `productMatchesPortion` en `ui.js`, los parámetros `portionFilterActive`/`portionPeople`/`onClearPortionFilter` de `ui.renderMenu`, y el CSS en `brand.css`/`components.css` (con cuidado de NO tocar `.qty-stepper`, que está mezclado en el mismo bloque de CSS pero lo usa también el modal de producto).
8. **✅ HECHO — Sin bordes redondeados en la tienda de clientes**: mismo criterio que ya se aplicó al panel de admin (`body:has(#admin-app)` en `admin.css`) pero ahora también en `body:has(#app)` (`brand.css`): `--radius-sm: 4px`, `--radius-md: 6px`, `--radius-lg: 8px`, `--radius-pill: 4px` — solo los radios, NO los colores/tipografía (esos siguen siendo los de marca, a diferencia del panel que además cambia a paleta gris).

**Bonus fix de paso (punto 6)**: al revisar el header se encontró que `brand.css` (`body:has(#app)`) redefine `--color-flame: #d92015` con su propio valor — DISTINTO del `#c8101f` que se fijó en `variables.css` en una ronda anterior de esta misma sesión. `variables.css` NO es la última palabra para `#app`: `brand.css` la pisa. No se tocó (no se pidió), pero queda anotado para la próxima vez que se ajuste el rojo de marca — hay que tocar los dos archivos o el cambio no se ve reflejado en la tienda de clientes.

**Pendiente real, no implementado**: solo el punto 3 (iconos1.png) y la parte de "simplificar categorías" del punto 1, ambos esperando que el usuario aclare qué quiere exactamente.

**Validación en navegador (Claude in Chrome) del punto 8**: el usuario pidió revisar visualmente en vez de que él describiera por escrito. Se encontró que el override de variables (`--radius-sm/md/lg/pill` en `body:has(#app)`, brand.css) NO alcanzaba varios elementos porque `brand.css` tiene un montón de `border-radius` con **valores literales en px** (999px, 24px, 20px, 18px, 12px) en vez de `var(--radius-*)` — a diferencia de `layout.css`/`components.css`, que sí usan las variables consistentemente. Se corrigieron los 8 casos encontrados (`.hero-banners-container`, `.hero-banner-cta`, `.category-tab` del sidebar, `.featured-card`, `.product-card`, `.drawer`/`.modal`, y los ~9 `999px` sueltos de pills/badges) reemplazándolos por `var(--radius-*)`. **Si se vuelve a tocar el redondeo de `#app` en el futuro, buscar `border-radius:\s*\d+px` en `brand.css` primero** — es fácil que la variable no alcance algo si sigue quedando algún literal.
También se confirmó (mismo método, DevTools vía JS) que `#bottom-nav` queda con `display: none` real (no solo el atributo `hidden`) y que las fotos de producto cargan bien (`complete: true`, 150×150) — una que se veía "en blanco" en la captura (Crema de Pollo) es una sopa clara fotografiada sobre fondo claro, no una imagen rota.

## Ronda de ajustes 2026-09-19 — panel de pedidos, paleta unificada, rediseño de la app de domiciliarios

**Panel de pedidos (`admin.js`/`admin.html`/`admin.css`)**:
- Etiquetas "Ver pedidos de:"/"Filtrar por estado del pedido:" arriba de las dos filas de filtros (antes no se entendía para qué eran).
- `.admin-status-buttons` (dentro de cada pedido) dejó de pintar los 7 estados de la escalera como botones (la mayoría deshabilitados, se veía como una fila larga sin poder tocar nada) — ahora solo un texto "Estado: X" + un único botón con la próxima acción disponible (`admin-status-next-btn`).
- `state.statusFilter` por defecto pasó de `'todos'` a `'recibido'` (la pastilla activa por defecto en `admin.html` también) — lo primero que ve el cajero al abrir el panel son los pedidos que necesitan confirmarse, no todo mezclado.

**Paleta de admin/driver unificada con la del marketplace (a pedido explícito del usuario, confirmado por AskUserQuestion — eligió "paleta completa", no solo el rojo)**: hasta ahora admin/driver heredaban la paleta cálida crema de `variables.css` sin tocar, mientras el marketplace (`index.html`) tiene su propia paleta bastante distinta en `brand.css` (`body:has(#app)`): fondo blanco/gris frío, rojo `#d92015` (vs. `#c8101f` de variables.css — esto resuelve de una vez el "bonus fix" anotado arriba, que quedó pendiente desde la ronda anterior), dorado más brillante, header obsidiana con borde rojo, tipografía de títulos "Plus Jakarta Sans". Se replicó el MISMO bloque de tokens (colores, `--font-display`, sombras) en `admin.css` con selector `body:has(#admin-app), body:has(#driver-app)` — mismo patrón que ya usa el proyecto, no se centralizó en `variables.css` a propósito (mismo criterio que ya se documentó para el rojo viejo: si se vuelve a ajustar, hay que tocar los dos archivos). También:
- Radio de bordes ("sin redondeo") ahora también aplica a driver.html (antes solo admin.html — driver se quedaba con los radios redondos de variables.css, inconsistente).
- Header de admin/driver pasó a obsidiana + borde rojo, igual que el marketplace (antes degradado rojo de punta a punta).
- Fuente de encabezados cambiada de Anton a Plus Jakarta Sans en `admin.html`/`driver.html` (`<link>` de Google Fonts actualizado en los dos).
- Se corrigieron literales `rgba(200, 16, 31, ...)`/`rgba(122, 10, 18, ...)` (el rojo VIEJO) sueltos en `components.css`, `layout.css`, `driver.css` y `animations.css` al RGB del rojo nuevo (`217, 32, 21`/`117, 10, 4`) — de paso corrige un desajuste mínimo que ya existía en el propio marketplace.
- `driver.css`: el contraste extra de texto para leer manejando (`--color-text-faint`/`--color-text-muted`) se re-tonalizó de cafés cálidos a grises fríos para no desentonar con el fondo nuevo.
- **Gotcha nuevo encontrado y corregido de una vez**: al agregar `font-weight:800; letter-spacing:-0.025em; text-transform:none;` a los h1-h4 de admin/driver (ver más abajo, "letra muy grande" del login), hubo que replicar TAMBIÉN el tratamiento `.notif-toggle.is-enabled` de `components.css` con el mismo prefijo `body:has(#admin-app)/body:has(#driver-app)` — un selector con `:has(#id)` cuenta como especificidad de ID, así que le ganaba a la regla de 2 clases de `components.css` y el ícono de la campana nunca se hubiera visto en rojo activado. Si se agrega otro estado (`.is-algo`) a un botón dentro de `.app-header` de admin/driver, revisar esto de una vez — cualquier regla que solo viva en un archivo compartido (`components.css`) sin el mismo prefijo `:has(#id)` pierde la pelea de especificidad contra las reglas ya puestas en `admin.css`.

**Rediseño de `driver.html`/`js/driver.js`/`css/driver.css`** (a pedido del usuario, confirmado por AskUserQuestion: cajón de cuenta aparte + bloquear cierre de turno con entregas activas):
- **Login**: causa real de "la letra se ve muy grande" — no era el tamaño en px (`--fs-xl` sin cambios), sino que `base.css` seguía poniendo mayúsculas + peso 400 + tracking abierto a los h1-h4 (pensado para Anton, condensada) — con Plus Jakarta Sans (ancha) esa combinación se veía enorme. Se corrigió con el mismo tratamiento que ya usa `brand.css` para `#app` (peso 800, sin mayúsculas, tracking cerrado) — aplica a TODOS los h1-h4 de admin/driver, no solo el login. Además se reemplazó el ícono genérico (`icon.svg` en un círculo) por el wordmark real (`brand/logo-dark-trans.webp`, ya usado en `index.html` sobre fondo claro) en el gate de "sin sesión" de admin.html Y driver.html (comparten el mismo markup) — el gate de "sin acceso" (candado) no se tocó.
- **Header**: se agregaron dos botones ícono (`.icon-btn`, 44px) antes de "Cerrar sesión": la campana de avisos (`#btn-driver-enable-push`, movida desde el fondo de la tarjeta de perfil — ahora sin texto, el estado se comunica con `aria-label`/`title` + la clase `is-enabled`) y un botón de cuenta nuevo (`#btn-driver-account`) que abre el cajón de cuenta.
- **Cajón de cuenta** (`#account-drawer`, nuevo — driver.html no tenía overlay/drawer antes, se agregó `<div class="overlay" id="overlay">`): agrupa 3 secciones que antes vivían sueltas en la página principal mezcladas con los pedidos — "Mi perfil" (nombre/teléfono, igual que antes), "Seguridad" (**nueva** — cambiar contraseña en caliente, `authApi.changePassword()` en `js/auth.js`: reautentica con la contraseña actual vía `reauthenticateWithCredential` y recién ahí `updatePassword`; distinto del botón "¿Olvidaste tu contraseña?" del login, que manda un correo) y "Cierre de turno" (igual que antes). `#driver-main` quedó solo con saludo/disponibilidad + stats + pestañas + lista de pedidos — el patrón de abrir/cerrar (`openAccountDrawer`/`closeAccountDrawer`) es el mismo que `ui.toggleSheet()` de la app de clientes, repetido a mano porque driver.js no importa `ui.js`.
- **Sincronía de nombre/teléfono en pedidos activos** (bug real corregido, no solo mejora cosmética): `orders/{id}/driverName`/`driverPhone` son una copia que `admin.js` (`handleAssignDriver`) toma UNA sola vez al asignar — antes, si el domiciliario editaba su nombre/teléfono después, los pedidos ya asignados se quedaban con el dato viejo para siempre (lo veían tanto el cliente como el panel) hasta que un admin reasignaba a mano. Se corrigió: al guardar el perfil, `driver.js` (`syncActiveOrdersDriverInfo`) ahora hace un `update()` multi-path que parchea `driverName`/`driverPhone` en cualquier pedido de ese domiciliario que no esté en un estado terminal (`entregado`/`cancelado`/`no_entregado`) — no hace falta tocar reglas de RTDB porque el domiciliario ya podía escribir el pedido completo donde `driverId === auth.uid`.
- **Cierre de turno bloqueado con entregas activas** (antes no se revisaba en absoluto — se podía cerrar turno a mitad de una entrega): `renderCashCard()` y `handleCloseShift()` ahora consultan `activeDeliveries()` (ya existía, pedidos `en_camino`/`llegado`) antes que `unsettledDeliveredOrders()` — con alguna entrega en curso, la tarjeta muestra "Termina tus entregas en curso antes de cerrar turno" y el botón queda deshabilitado. El modelo de datos de `cashSettlements` NO cambió (sigue siendo "1 cierre = N pedidos entregados sin rendir").
- Se limpiaron las reglas CSS muertas de `.driver-profile-card`/`.driver-section-summary` (era un `<details>`, ya no existe ese markup) — la nueva `.driver-account-section` (bloque simple con separador) las reemplaza.


---

<!-- Movido desde tienda/CLAUDE.md el 2026-10-07 (recorte del CLAUDE.md). -->
### Ronda de hardening de seguridad 2026-09-19

Plan riguroso pedido por el usuario después de contrastar un prompt de auditoría
de IA + un artículo de seguridad PWA contra el sistema real (auditoría con 3
agentes de exploración en paralelo). Se priorizaron brechas confirmadas y
explotables, no una lista genérica:

- **2 XSS reales corregidos, fuera de `tienda/`** (afectan la fusión con las
  apps de mesas, documentados acá porque comparten el mismo Firebase):
  `mesero-app/app.js` (banner de "pedidos listos") y `panel-caja/app.js`
  (`detalleCobrado()`, campo "Origen") insertaban `p.mesa` sin `escapeHtml()` en
  un `innerHTML`, a diferencia del resto de apariciones del mismo campo en esos
  archivos. Importaba más que un XSS normal: `p.mesa` puede venir de
  `panel-cliente` (sin login, público) vía `/solicitudes/{mesaId}.mesa` →
  `pedido.mesa` — un actor sin cuenta podía plantar un payload que se ejecutaba
  en la sesión autenticada del mesero o del cajero. Corregido envolviendo con
  `escapeHtml()`, igual que el resto de esos mismos archivos.
- **Cabeceras de seguridad agregadas a los 5 sitios de mesas** (`firebase.json`
  raíz) — antes solo los 3 sitios de `tienda/` las tenían. Además se agregó
  `Strict-Transport-Security` (HSTS) a los **8 sitios** (los 3 de tienda incluidos)
  — no existía en ninguno, se había asumido que sí.
- **Footgun de deploy resuelto**: `.firebaserc` (gitignored) tiene
  `default: rodizio-eb49a` (el proyecto viejo que se va a archivar). Se agregó
  un `package.json` en la raíz del repo (no existía) con scripts `deploy`/`deploy:db`
  que fuerzan `firebase use rodiziomarketplace` antes de desplegar, y un script
  `deploy` equivalente en `tienda/package.json` — para que el cambio de proyecto
  no dependa de que alguien recuerde leer `docs-fusion/ESTADO-ACTUAL.md`.
- **Enumeración de cuentas corregida**: `mapAuthError()` (`js/auth.js`) devolvía
  mensajes distintos para "no existe esa cuenta" vs. "contraseña incorrecta" —
  un atacante podía usar el login o el reset de contraseña de `admin.html`/
  `driver.html` para averiguar qué correos tienen cuenta. Ahora ambos casos (y
  `auth/invalid-credential`) devuelven el mismo mensaje genérico. Se dejó igual
  a propósito el mensaje de `auth/email-already-in-use` en registro — ese flujo
  es solo de clientes (login con Google), el riesgo de enumeración ahí es menor
  y perderlo empeora la UX del registro sin necesidad.
- **`errorLogs` ya no acepta payloads sin límite**: `database.rules.json` exigía
  `message`/`context` pero sin tope de tamaño — cualquiera con la URL de la base
  podía inflar la factura de Firebase escribiendo logs falsos enormes. Se agregó
  `.isString()` + `length <= 500` a ambos campos (confirmado que el único emisor,
  `js/errors.js`, ya trunca `message` a 300 y `context` siempre es un string
  corto fijo — el límite no rompe nada existente).
- **Notificaciones push de `notifyDriverAssigned` saneadas**: `order.customerName`/
  `order.address` se insertaban sin acotar en el cuerpo de la notificación FCM —
  no es inyección de código (FCM renderiza texto plano), pero sí un vector barato
  de suplantación visual. Se agregó un `sanitize()` local que quita saltos de
  línea y acota longitud (60/120 caracteres) antes de insertarlos.
- **Pendiente, fuera de este plan (documentado, no olvidado)**: activar "Email
  Enumeration Protection" en Firebase Console → Authentication → Settings (lo
  hace el usuario, no requiere código, refuerza el fix de arriba a nivel de
  Firebase Auth) y probar de punta a punta el flujo de mesas bajo las reglas ya
  cerradas (ver nota nueva en el `CLAUDE.md` raíz, limitación #1).
- `tienda/sw.js` subido a `rodizio-cucuta-v127` (cambió `js/auth.js`, que está
  precacheado); `mesero-app/sw.js` a `v30` y `panel-caja/sw.js` a `v21` (cambió
  su `app.js`, precacheado también).
- **Fase 5 (prueba de punta a punta) hecha el mismo día, con el usuario probando
  en su celular cocina/caja mientras esta sesión probaba mesero y el QR de
  cliente.** Confirmado sin errores: mesero envía comanda → cocina → mesero
  marca servido → caja cobra; y cliente QR arma carrito → mesero confirma →
  cocina. En el camino aparecieron 2 bugs reales de la fusión (no de esta ronda
  de hardening en sí, pero solo se vieron al probar bajo las reglas ya
  cerradas) — detalle completo en `docs-fusion/ESTADO-ACTUAL.md` (sección de
  gotchas): `solicitudes` sin `.read` a nivel de colección en
  `database.rules.json` (permission_denied apenas abría `mesero-app`), y
  `panel-cliente/index.html` con rutas relativas (`styles.css`/`app.js` sin
  `../`) que bajo el *rewrite* de hosting a `/panel-cliente/index.html`
  resolvían mal y dejaban el QR real de mesa en pantalla en blanco. Ambos
  corregidos y desplegados.



<!-- Movido desde tienda/CLAUDE.md ("Pendiente conocido") el 2026-10-07. -->
- **Tiempo estimado de entrega — fórmula futura, todavía NO implementada**
  (el usuario la describió para dejarla anotada, pidió explícitamente no
  construirla todavía): el ETA que ve el cliente debería ser la suma de
  (a) el tiempo de preparación de cada plato del pedido — dato que hoy NO
  existe en el menú, el usuario lo va a agregar más adelante (¿por
  producto? ¿por categoría? sin definir todavía) — más (b) el tiempo de
  ruta real calculado por la API de rutas de Google Maps (Directions/Routes
  API) desde el restaurante hasta la dirección del cliente. Hoy el ETA
  sigue siendo manual (botones 15/30/45/60 min que pone el cajero, con
  sugerencia simple según cola de pedidos — ver "ETA sugerido" más arriba).
  No implementar esto sin que el usuario traiga primero el dato de tiempo
  de preparación y decida si paga una clave de Google Maps con facturación.
