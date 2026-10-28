# PLAN MAESTRO — de "funciona" a "perfecto y en producción"

> Creado 2026-10-05. Plan Blaze y dominio propio ya disponibles.
> Regla de oro: **una fase a la vez, un paso a la vez**. Cada paso termina con
> un criterio verificable; no se pasa al siguiente sin marcarlo. Nada se
> despliega sin confirmar proyecto (`firebase use` → `rodiziomarketplace`) y
> sin el OK explícito del dueño.

Leyenda: ✅ 2026-10-05 (Node 20→22; borrador de pasarela retirado: guardaba items del navegador y no validaba cantidades) pendiente · 🔄 en curso · ✅ hecho y verificado · 👤 lo hace el dueño (consola/pago/decisión)

---

## Orden y por qué

1. **Fase 0 — Control**: respaldo, línea base, configuración segura.
2. **Fase 1 — El total del pedido lo calcula el servidor**: es el único hueco
   con plata real expuesta hoy, y cambia *cómo se crea un pedido* — si se
   probara todo antes, habría que volver a probarlo después.
3. **Fase 2 — Pruebas de punta a punta**: con el flujo de pedido ya
   definitivo, se prueba todo una sola vez.
4. **Fase 3 — Pasarela de pago (sandbox → producción)**.
5. **Fase 4 — Dominio propio**: va al final porque cambia URLs que dependen
   de todo lo anterior (QR impresos, login de Google, webhook de pago).
6. **Fase 5 — Cierre**: limpieza, merge `fusion → main`.

---

## Fase 0 — Control (línea base)

| # | Paso | Quién | Criterio de hecho | Estado |
|---|---|---|---|---|
| 0.1 | Commitear las 3 semanas de trabajo suelto, agrupado por tema | Claude | `git status` limpio | ✅ 2026-10-05 (11 commits, `c352d0f..f765f51`) |
| 0.2 | Push de `fusion` al remoto (respaldo fuera del PC) | 👤 OK → Claude | `git status` dice "up to date with origin/fusion" | ✅ 2026-10-05 (repo privado, 25 commits subidos) |
| 0.3 | `.firebaserc`: cambiar `default` de `rodizio-eb49a` a `rodiziomarketplace` (hoy un `firebase deploy` suelto va al proyecto viejo) | Claude | `firebase use` sin flags → `rodiziomarketplace` | ✅ 2026-10-05 (el viejo queda como alias `viejo`; `tienda/.firebaserc` ya estaba bien) |
| 0.4 | Respaldo manual de RTDB completo antes de tocar nada, fuera del repo (trae datos personales) | Claude | archivo existe y abre | ✅ 2026-10-05 → `../respaldos-rtdb/rodiziomarketplace-2026-10-05.json` (127 KB, 18 nodos, 50 pedidos) |
| 0.5 | Activar **backups diarios automáticos** de RTDB (requiere Blaze) | 👤 consola | aparece en Realtime Database → Backups | ✅ 2026-10-05 (reportado por el dueño) |
| 0.6 | **Alerta de presupuesto** en Google Cloud Billing (ej. aviso a 50/90/100% de un tope mensual). Con el antecedente de abuso que suspendió el proyecto original, esto no es opcional en Blaze. Ojo: **avisa, no corta el gasto** | 👤 consola | alerta creada | ✅ 2026-10-05 (reportado por el dueño) |
| 0.7 | Activar "Email Enumeration Protection" (Authentication → Settings) — pendiente desde la ronda de hardening. Verificado: ningún código usa `fetchSignInMethodsForEmail`, no rompe nada | 👤 consola | toggle activo | ✅ 2026-10-05 (reportado por el dueño) |
| 0.8 | **Congelar deploys de `tienda/`** hasta la Fase 3 o hasta ocultar el botón "Pago en línea": el repo ya lo tiene en el checkout, producción no, y la función que lo atiende no está desplegada | regla | — | 🔄 vigente |

## Fase 1 — El total lo calcula el servidor (bloqueante de seguridad)

Hoy `tienda/js/auth.js` → `placeOrder()` hace `push(ref(db,'orders'))` desde el
navegador con `subtotal`/`shipping`/`total` del cliente, y
`database.rules.json` no valida montos. Ya existe media solución en
`tienda/functions/` (`createPaymentSession` + `lib/calcularTotal.js`).

| # | Paso | Criterio de hecho | Estado |
|---|---|---|---|
| 1.1 | Revisar `tienda/functions` (runtime de Node, región, dependencias, `lib/calcularTotal.js`) y el envío: hoy el comentario dice "por ahora confiamos en el del cliente" para `shipping` → calcularlo en servidor desde `settings.coverageZones` | código revisado, tests locales de `calcularTotal` pasan | ✅ 2026-10-05 (`crearPedido` + `js/reglas-pedido.js` compartido) |
| 1.2 | Nueva callable `crearPedido` (efectivo **y** pago en línea pasan por ahí): valida carrito contra `/products` (precio, `hidden`, agotado), calcula envío y total, descuenta stock, escribe el pedido con Admin SDK | probado en emulador | ✅ 2026-10-05 |
| 1.3 | `placeOrder()` del navegador llama a `crearPedido` en vez de escribir directo | pedido de prueba en emulador idéntico al formato actual (`origen`, `lineas`, `rondaEstados`…) | ✅ 2026-10-05 (también: domiciliario solo logística, `contadores`/`outOfStock` solo personal, `errorLogs` solo agregar) — 30 pruebas verdes en emuladores |
| 1.4 | Reglas RTDB: el cliente de la tienda ya **no puede crear** `orders` directo (sí el personal de mesa, que sigue igual); campos de dinero (`total`, `pagado`) no editables por el cliente | prueba negativa: `push` manual desde DevTools → `permission_denied` | 🔄 commit `2509860` listo; el deploy lo corre el dueño (Claude Code bloquea deploys a producción) |
| 1.5 | Desplegar functions + reglas + tienda (con OK) | pedido real de prueba en producción llega bien a `admin.html` y cocina | ✅ 2026-10-05 (D-002: caja confirma → admin avanza → caja cobra efectivo → cancelado por CLI; reportes vuelven a $0). Bugs: B1, B2, B3, B4 |
| 1.6 | Desplegar también las 2 funciones de push ya escritas (`notifyOrderStatusChange`, `notifyDriverAssigned`) | notificación recibida en un celular | 🔄 desplegadas 2026-10-05; falta recibir una notificación (en la prueba no estaban activadas en el navegador) |
| 1.7 | Hosting de mesa: excluir `.claude/**`, `docs/**`, `package.json` — **hoy `/.claude/MEMORY.md` y `/.claude/settings.local.json` se sirven públicos en los 5 sitios de mesa** (notas internas + un correo; sin secretos). El `**/.*` excluye la carpeta pero no su contenido | `curl` a esas rutas → 404 tras el deploy | ✅ 2026-10-05 (desplegado; `/.claude/*`, `docs/`, `package.json` → 404 en los 5 sitios, apps cargan) |
| 1.9 | Política de limpieza de imágenes de compilación de functions (`firebase functions:artifacts:setpolicy`) — el primer deploy avisó que no pudo borrarlas y quedan cobrando unos centavos al mes | política activa | ✅ 2026-10-05 (cocina con cuenta admin: badge "Solo observación" y el botón no escribe) |
| 1.8 | Actualizar el CLI global (`npm i -g firebase-tools`, hoy 13.35 → 15.x). Con el 13 el emulador no carga `firebase-functions` v7, por eso functions quedó en v6.6 + admin v13 (2 vulnerabilidades moderadas de `uuid` transitivas, no explotables en nuestro uso). Tras actualizar: subir a functions v7 + admin v14 y re-correr `npm test` | `firebase --version` ≥ 15, tests verdes | ✅ 2026-10-05 (390 px: inicio, carrito y checkout sin desborde; inglés completo salvo 2 claves de pago → corregido en `91bc3aa`, desplegado 2026-10-05) |

## Fase 2 — Pruebas de punta a punta (nunca probadas)

Cada fila se prueba en dispositivos reales y se anota el resultado aquí.

**Entorno local de pruebas** (desde 2026-10-05): `node scripts/entorno-local.mjs` levanta
emuladores (Auth, RTDB con las reglas reales, Functions) + los paneles en `localhost:5050` y la
tienda en `localhost:8080`, con el menú público copiado de producción y cuentas de prueba. Las
apps detectan `localhost` y no tocan producción. Sirve para probar flujos sin pedidos reales.

| # | Flujo | Estado |
|---|---|---|
| 2.1 | Tienda → confirmar en `admin.html` → aparece en `panel-cocina` como "Domicilio" | ✅ 2026-10-05 (dashboard 30 días OK; Carta: guardar OK; bug B8 corregido; Carta rediseñada con buscador/filtro/plegables/orden — desplegado 2026-10-05) |
| 2.2 | Flujo domicilio nuevo: cocina 1 botón → domiciliario "Llegué" → entregado | ✅ 2026-10-05 en entorno local (reglas reales): cliente → `crearPedido` ($29.000 calculado por el servidor) → caja confirma (D-001), asigna domiciliario y 30 min → cocina "Listo para el domi" con trabajador NO admin → domiciliario recoge → entrega sin propina. Antes: QR → mesero → cocina (P-003) → cancelar ✅ en producción |
| 2.3 | `panel-caja` cobra un domicilio (efectivo / tarjeta / transferencia) | ✅ 2026-10-05 en local: D-002 domicilio cobrado con tarjeta en "en camino" ($29.000); efectivo ya probado en mesa (P-001) |
| 2.4 | Recoger en tienda, de punta a punta | ✅ 2026-10-05 en local: `crearPedido` sin envío ($24.000) → caja confirma (sin selector de domiciliario) → cocina "Listo para entregar · esperando al cliente" → admin domicilios "Marcar Entregado" → caja cobra por transferencia. Ver B14 |
| 2.5 | Dashboard de `panel-admin` + pestaña Carta (editar un plato y verlo en el QR) | ⬜ |
| 2.6 | Admin en modo observación no puede escribir en mesero/caja/cocina | 🔄 2026-10-05 en local: entra a caja con insignia "Solo observación" y `__SOLO_LECTURA=true`; el intento de anular un cobro no escribió nada, pero la prueba quedó incompleta (el entorno se cerró por falta de memoria) |
| 2.7 | Tienda en celular (<768px): checkout, carrito, idioma EN | ⬜ |
| 2.8 | Driver: cierre de turno, cambio de contraseña, GPS | 🔄 recoger/en camino/entregar ✅ en local 2026-10-05 (bug B11). Falta: cierre de turno, contraseña, GPS en celular |
| 2.9 | Regresión de mesas (ya probado 2026-09-19, repetir tras Fase 1): mesero → cocina → servido → caja; QR → mesero → cocina | ✅ 2026-10-05 en entorno local con las reglas cerradas y trabajador NO admin: mesero comanda (P-001) → cocina Empezar → Listo → mesero servido → caja cobra en efectivo → reporte del admin $44.000. Falta repetir el tramo QR → mesero en local |

Bugs encontrados → se arreglan uno por uno, cada uno en su commit, y se
re-prueba la fila.

### Bugs encontrados en la Fase 2

| # | Bug | Dónde | Estado |
|---|---|---|---|
| B1 | Pedido de **recoger** pasa por "En camino" en el admin de domicilios (En cocina → Listo → En camino → Entregado) | `tienda/js/admin.js` (siguiente estado) | ✅ `31ef600`, desplegado |
| B2 | **No hay forma de anular un cobro**: un pedido entregado+pagado no tiene "Cancelar" en el admin ni "anular" en caja. Si el cajero se equivoca de pedido o de método, no lo puede corregir | admin + `panel-caja` | ✅ `3568101` "Anular cobro" en caja (motivo obligatorio + registro en orders/{id}/anulaciones) + "Cancelar pedido" en Por cobrar; probado en vivo. Desplegado 2026-10-05 |
| B3 | Caja muestra "Hora entregado: —" en pedidos que el admin marcó entregados (el admin no guarda `tsEntregado`) | `tienda/js/admin.js` | ✅ `31ef600`, desplegado |
| B4 | En cocina, el botón de un pedido de **recoger** dice "Listo para el domi" | `panel-cocina/app.js` | ✅ `31ef600`, desplegado 2026-10-05 (hosting de mesa) |
| B5 | El admin muestra "Estado: Confirmar" para un pedido ya confirmado (el filtro dice "Confirmado") | `tienda/js/admin.js` | ✅ `31ef600`, desplegado |
| B6 | Voseo argentino en la interfaz ("tomá", "forzás") | dashboard + admin domicilios | ✅ `31ef600` |
| B7 | Dashboard → Operación muestra el PROMEDIO como cifra grande (Cocina 470 min por un caso atípico, mediana 3 min) | `panel-admin/dashboard.js` | ✅ mediana como cifra principal. Desplegado 2026-10-05 |
| B8 | Editar un plato en la Carta borraba `sabores`, `subGroup` y `hidden` | `panel-admin/app.js` | ✅ `882da03`, desplegado 2026-10-05 |
| B9 | Pedido de prueba viejo P-002 Mesa 7 "Listo" hace ~8 días: ensucia cocina y el aviso del mesero | datos | ✅ cancelado con motivo (autorizado por el dueño) |
| B10 | Las insignias rojas de pestañas (admin domicilios "Pedidos", domiciliario "Para recoger") mostraban "0": su `display:inline-flex` le ganaba al `[hidden]` | `tienda/css/admin.css` | ✅ sin desplegar (2026-10-05) |
| B11 | Domiciliario: al recoger decía "llevas 2 pedidos activos" con uno solo (el SDK aplica la escritura local antes del `await` y lo contaba dos veces) | `tienda/js/driver.js` | ✅ sin desplegar (2026-10-05) |
| B12 | El encabezado carbón compartido no aplicaba en caja/admin (selector `body > header`, pero el header vive dentro de `#app`) — solo afectaba al estilo nuevo, nunca llegó a producción | `shared/ui.css` | ✅ sin desplegar (2026-10-05) |
| B13 | Admin de domicilios: el detalle de un pedido abierto ("Ver detalle") se vuelve a cerrar solo cuando la lista se refresca | `tienda/js/admin.js` | ⬜ |
| B14 | Pedido de **recoger**: caja confirma y cobra, pero no puede marcarlo "entregado" al cliente — eso solo está en el admin de domicilios, otra app. Propuesta: botón "Entregado al cliente" en caja cuando está Listo | `panel-caja/app.js` | ⬜ decisión del dueño |
| B15 | Caja: la insignia "Domicilios" mostraba "0" (mismo `[hidden]` vs `display` de B10) | `panel-caja/styles.css` | ✅ sin desplegar (2026-10-05) |
| B16 | Las direcciones que terminan en `/` (`/` de la tienda, el login y cada panel: `/panel-caja/`, `/mesero-app/`…) salían con `Cache-Control: max-age=3600`: tras un deploy se podía ver la versión vieja hasta 1 h (la regla no-cache solo cubría `*.html`) | `firebase.json` + `tienda/firebase.json` (regla `regex: "/$"`) | ✅ sin desplegar; verificar la cabecera después del próximo deploy |

## Fase 2b — Pedidos del dueño (2026-10-05)

| # | Pedido | Estado |
|---|---|---|
| 2b.1 | Carta del panel-admin: buscador, filtro por categoría, categorías plegables con "Ver más", ordenar con ▲▼ | ✅ `68c4818`, probada en vivo por inyección; desplegado 2026-10-05 |
| 2b.2 | Reportes: Excel bien detallado | ✅ `1de43b0` — 10 hojas; verificado contra la capa de reportes con pedidos reales (30d, hoy, solo domicilio). Desplegado 2026-10-05 |
| 2b.3 | **Unificar el estilo de TODOS los paneles** y bajar el brillo/estridencia de colores y fondos | 🔄 paso 1/3 hecho 2026-10-05: recorrido visual (9 pantallas, 3 familias de estilo, 5 contrastes bajo el mínimo, 2 paletas en el código, ~500 colores sueltos) → https://claude.ai/artifact/9N4Vsx5fMsru6z9J4p2iQr. Paso 2/3 hecho: decisiones del dueño (encabezado carbón para todo, esquinas 4px, cocina oscura con la misma paleta) → sistema "Rodízio Brasa" https://claude.ai/artifact/SthJTy9aDEApsUAqbPgo2k (22 colores claro/oscuro, 44 pares de contraste verificados, 7 componentes). Paso 3 hecho 2026-10-05 (SIN desplegar): paleta compartida `shared/marca.css` (+ copia `tienda/css/marca.css` por `scripts/sync-marca.mjs`), encabezado carbón en las 9 apps, mesero/carta QR/acceso/tienda/admin domicilios/domiciliario/Excel/gráficos migrados, recorrido en local y en vistas previas (canal `estilo`, vence 2026-10-12). Falta: visto bueno del dueño → commit → despliegue fuera de horario. **Paso 4 (2026-10-06, sin commit):** auditoría de lo que quedaba fuera de la paleta. Las 10 páginas tenían el `theme-color` del navegador con los colores viejos (`#b10101`, `#14100d`, `#f7f1e8`, `#0c0e12`, `#ffffff`); ahora van con el carbón `#2A2D33`, y la cocina (oscura) con `#0F1114`. Los hex que siguen en el código son legítimos (verde de WhatsApp, logo de Google, comentarios). **Pendiente antes de desplegar:** subir `CACHE_NAME` del `sw.js` de cada app que precachea estas páginas, para que las PWA instaladas tomen el cambio. **Revisión del marketplace (2026-10-06, por código):** la copia `tienda/css/marca.css` está sincronizada (`sync-marca.mjs --check` OK); el encabezado es `var(--carbon)`; las fuentes son las de la paleta (Plus Jakarta Sans + Manrope); no quedan colores viejos de diseño. Único resto corregido: el spinner de `driver.css` usaba el marrón viejo `rgba(23,17,14)` → carbón. ~~Sigue pendiente subir `CACHE_NAME`~~ **Hecho:** mesero v33, admin v34, caja v26, cocina v23, tienda v131. **Íconos de categorías del marketplace (2026-10-06):** los dibujos a mano de `getCategoryIcon` (`tienda/js/ui.js`, ~80 líneas de `if`) se reemplazaron por **Lucide** (licencia ISC, uso comercial libre) en el módulo nuevo `tienda/js/iconos-categoria.js` (agregado al `APP_SHELL` del sw). Probado contra las 13 categorías reales de producción: todas tienen ícono propio, ninguna cae al genérico. De paso se corrigió un bug: "Burger Angus" mostraba el ícono de Angus Beef. **`panel-cliente` (QR de mesa):** mismo ícono Lucide por categoría que el marketplace (antes todas mostraban `restaurant_menu`). **Fuente única:** `shared/iconos-categoria.js` (script clásico, `window.RodizioIconos`, normaliza guiones como espacios porque la carta del QR solo tiene nombres); la tienda usa la copia `tienda/js/iconos-categoria.js` que genera `scripts/sync-marca.mjs` (ahora copia paleta e íconos). Probado contra las 28 categorías reales (13 domicilios + 15 mesa): ninguna al genérico. **Vista previa desplegada 2026-10-06** (canal `estilo`, vence 2026-10-13; producción sin tocar, verificado): marketplace https://rodiziomarketplace--estilo-samwupsx.web.app · carta QR https://rodizio-cliente--estilo-i8xt5t7e.web.app/?mesa=prueba-iconos&nombre=Prueba — las vistas previas usan la base REAL: no agregar platos ni pedir. **✅ DESPLEGADO A PRODUCCIÓN 2026-10-06 (~15:35), a pedido del dueño aunque el 2b.3 siga en curso:** solo hosting de los 8 sitios (`npm run deploy` en la raíz y en `tienda/`, proyecto `rodiziomarketplace`); reglas y functions sin cambios, no se tocaron. Verificado en las URLs reales: íconos Lucide en carta QR y marketplace, `theme-color` carbón (cocina `#0F1114`), sw mesero v33 / admin v34 / caja v26 / cocina v23 / tienda v131. **Commiteado en `fusion` 2026-10-06:** `e8c0f97` (entorno local), `1a49607` (domiciliario: contador de pedidos activos), `553feb4` (estilo + íconos). Sin push: `fusion` va 18 commits por delante de `origin/fusion`. | 

## Fase 2c — Vistas del cliente: fotos HD, detalle de producto, idioma completo (2026-10-06)

Pedido del dueño: fotos nítidas al abrir un producto (carta QR y marketplace),
marketplace 100 % en inglés incluidas las descripciones, y pulir el diseño de
las vistas de cliente con revisión en el navegador.

Hallazgos que definen el trabajo:
- **Las 155 fotos del menú son de 150×150 px** (se bajaron así de Ola Click). Por
  eso se ven borrosas al agrandarlas. Subirlas a Storage no cambia la calidad.
- Ola Click sigue en línea y tiene cada foto también en **800 px**
  (`assets.olaclick.app/companies/products/images/800/<uuid>.jpg`). Las 128 fotos
  que usan los dos menús se emparejaron por comparación de imagen (diferencia
  máx. 4,35, promedio 2,06), no solo por nombre.
- **16 descripciones están cortadas con "…"** desde el origen; el catálogo de Ola
  Click trae el texto completo.
- Ninguna app traduce platos ni categorías; el marketplace traduce solo parte de
  la interfaz. Bug: `updateStaticContentFromHTML` compara `tagName === 'SVG'`
  (en HTML llega en minúsculas).
- Productos sin foto generan `<img src="">` en la grilla del marketplace.

| # | Paso | Estado |
|---|---|---|
| 2c.1 | Fotos: lista 320 px (`icons/menu/<f>.webp`) + detalle 800 px (`icons/menu/hd/<f>.webp`), en raíz y `tienda/` | ✅ |
| 2c.2 | Detalle de producto rediseñado (foto a todo el ancho, HD, fondo de carga) en las dos apps | ✅ |
| 2c.3 | Completar las 16 descripciones cortadas (producción + semilla) | ✅ |
| 2c.4 | Traducción: `nameEn`/`descriptionEn` en productos y categorías; marketplace 100 % en inglés | ✅ (faltan mensajes del servidor, sabores, insignias y `privacidad.html`) |
| 2c.5 | Revisión visual completa en navegador (banco `_vista-movil.html`, temporal) | ✅ |
| 2c.6 | Storage (Fase 4b): 283 fotos en `menu/` y `menu/hd/`, `storage.rules`, función `fotoMenuSubida` (caché pública), `image` en RTDB apunta a Storage, `icons/menu` fuera del deploy. 2026-10-07 | ✅ |
| 2c.7 | Farol cálido (opción C): `scripts/generar-iconos.py` + `scripts/logo-farol-vidrio.py`; íconos de entrega moto/bolsa (`tienda/icons/entrega/`, `scripts/vectorizar-icono.py`). Desplegado 2026-10-07 | ✅ |
| 2c.9 | Horario automático en admin (Estado ahora, Detener/Reanudar, copiar lunes), «Pausar domicilios» (caja + admin, validado en `crearPedido` y reglas), avisos en la tienda. Incidente: `.git` expuesto en Hosting raíz, corregido. 2026-10-07 | ✅ |
| 2c.8 | Marketplace tipo app: portada por categorías (Para comer / Para tomar), vista de una categoría con cabecera de foto y barra fija, atrás del celular vuelve a la portada; ícono con fondo rojo; encabezado rojo `#C4100E` (prueba, `--marca` solo en la tienda); avatar de Google redondo. Desplegado 2026-10-07 | ✅ |

## Fase 3 — Pasarela de pago (AAvance / PayWay)

> Nota de la prueba del 2026-10-05: el botón oculto "Pago en línea" muestra la clave cruda `pagoEnLinea` — falta esa clave en `tienda/js/i18n.js`. Corregir antes de prender `settings.pagoEnLinea`.

Detalle técnico en `PLAN-PASARELA-PAGO.md` (secciones 4, 6 y 7).

| # | Paso | Estado |
|---|---|---|
| 3.1 | ApiKey en Secret Manager (`PASARELA_API_KEY`); copia local en `functions/.secret.local` (ignorado por git y por el deploy) | ✅ 2026-10-07 |
| 3.2 | `crearPagoEnLinea` usa el mismo `prepararPedido` que `crearPedido`; el pedido espera en `pagosPendientes/{orderNumber}` | ✅ 2026-10-07 |
| 3.3 | `webhookAAvance` + `verificarPagoEnLinea` → `confirmarPagoPendiente`: consulta AAvance, exige idstatus 34 y monto exacto, y solo entonces crea el pedido en `orders` con `pagado: true, metodoPago: 'en_linea'` | ✅ desplegado 2026-10-07 |
| 3.3b | Registrar `https://us-central1-rodiziomarketplace.cloudfunctions.net/webhookAAvance` en el panel de AAvance (terminal 21827 → Webhook, "Activar notificaciones" = Sí) | 👤 |
| 3.4 | Pedidos sin pagar: decidido — nunca entran a caja/cocina; quedan en `pagosPendientes` | ✅ |
| 3.5 | Pago de prueba de punta a punta en sandbox, incluido el rechazo | ⬜ |
| 3.6 | Checklist sección 7 completo → pasar a producción | ⬜ |

## Fase 4 — Dominio propio

| # | Paso | Estado |
|---|---|---|
| 4.1 | Decidido: solo el marketplace lleva dominio, `rodiziocucuta.com` (comprado en ColombiaHosting). Paneles siguen en `.web.app` | ✅ |
| 4.2 | Agregados en Hosting (sitio rodiziomarketplace): `rodiziocucuta.com` y `www.rodiziocucuta.com` (redirige al principal). Registros: A `@` → `199.36.158.100`, TXT `@` → `hosting-site=rodiziomarketplace`, CNAME `www` → `rodiziomarketplace.web.app`. DNS en Cloudflare (plan Free, registros en "solo DNS"), nameservers cambiados en ColombiaHosting. **HTTPS activo**: `https://rodiziocucuta.com` 200, `www` → 301 al principal | ✅ 2026-10-08 |
| 4.3 | `rodiziocucuta.com` agregado a Authentication → Authorized domains | ✅ 2026-10-07 |
| 4.4 | Actualizar `og:url`/`og:image` (hoy `og:image` apunta a `images/picanha.jpg`, **borrada** → la vista previa de WhatsApp sale sin foto), `manifest` y `response_url`/webhook de la pasarela | ⬜ |
| 4.5 | Regenerar los QR de mesa con el dominio final **antes** de imprimirlos | ⬜ |

## Fase 4b — Imágenes del menú en Firebase Storage

Storage ya está activo con reglas "de producción" (todo bloqueado por
defecto). Hoy las ~155 fotos son archivos estáticos duplicados en `icons/menu/`
y `tienda/icons/menu/`, y el campo `img`/`image` no se deriva del id.

| # | Paso | Estado |
|---|---|---|
| 4b.1 | Reglas de Storage: lectura pública solo de `menu/**`, escritura solo admin, tipo `image/*` y tamaño máximo | ⬜ |
| 4b.2 | Script que sube las fotos actuales y reescribe `image`/`img` en `products` y `productsMesa` con la URL nueva (con respaldo previo) | ⬜ |
| 4b.3 | Subir/cambiar foto desde el panel (admin tienda y pestaña Carta), comprimida en el navegador | ⬜ |
| 4b.4 | Quitar las copias estáticas duplicadas | ⬜ |

## Fase 5 — Cierre

| # | Paso | Estado |
|---|---|---|
| 5.1 | `tienda/js/data.js`: el menú semilla de respaldo apunta a las imágenes demo borradas → limpiar | ⬜ |
| 5.2 | Partir `tienda/CLAUDE.md` (113k caracteres) en archivos por tema | ⬜ |
| 5.3 | Archivar `rodizio-eb49a` y retirar `rodiziocucuta21.web.app` (destructivo → confirmación explícita) | 👤 |
| 5.4 | Merge `fusion → main` | 👤 OK |

---

## Bitácora

- **2026-10-05** — Plan creado. Fase 0.1 hecha: 11 commits (`c352d0f..f765f51`).
  Verificado: producción de la tienda sirve `sw` v127 **sin** el botón "Pago en
  línea"; el repo sí lo tiene → regla 0.8.
- **2026-10-05** — Fase 0: 0.2, 0.3 y 0.4 hechos. Gotcha: en Git Bash,
  `firebase database:get /` falla con "Path must begin with /" (o "Failed to get
  details for project") porque MSYS convierte `/` en una ruta de Windows → usar
  `MSYS_NO_PATHCONV=1 firebase database:get / ...` o correrlo en PowerShell.
- **2026-10-05** — Fase 1: 1.1–1.4 hechos (commit `2509860`). Hallazgos extra: el
  cliente podía reescribir su pedido entero (`pagado:true`), `contadores` abierto a
  cualquier logueado, `errorLogs` borrable sin login, y `/.claude/*` servido público en
  los 5 sitios de mesa. Emuladores: el CLI 13 usa `ns=demo-rodizio` para functions →
  `firebase.test.json` aplica las reglas a los dos namespaces.
