# Rodizio Cúcuta — Sistema de pedidos

Cinco PWAs vanilla (sin build, sin framework) sobre una sola Firebase Realtime Database, más
`tienda/` — el marketplace público de domicilios. Este archivo es lo que hay que saber **antes de
tocar el código**: decisiones tomadas a propósito y trampas conocidas. Lo que se averigua leyendo
el repo no está aquí.

> **Rama activa: `fusion`**, mergeada a `main` el 2026-10-20 (`--no-ff`). Se sigue
> trabajando en `fusion`; `main` ya no es pre-fusión, pero puede ir un paso atrás.

---

## 🔒 El total del pedido lo calcula el servidor (resuelto 2026-10-05)

Los pedidos de la tienda los crea **solo** la Cloud Function `crearPedido`
(`tienda/functions/index.js`): el navegador manda ids, cantidades y notas, y el
servidor pone precios, envío y total desde RTDB. Las reglas ya no dejan que un
cliente cree ni reescriba pedidos (solo cancelar uno suyo en `recibido`), y el
domiciliario solo toca campos de logística.

- La lógica de negocio (zonas, horario, mínimo, agotados) vive en
  **`tienda/js/reglas-pedido.js`** — una sola fuente para navegador y servidor.
  `functions/lib/reglas-pedido.mjs` es una copia generada: no editarla a mano.
- Pruebas: `cd tienda/functions && npm test` (unitarias + emuladores con las
  reglas reales). Correrlas antes de tocar `reglas-pedido.js`, `crearPedido` o
  el bloque `orders` de `database.rules.json`.
- Plan de lo que sigue (pasarela, dominio, Storage): `docs-fusion/PLAN-MAESTRO.md`.

---

## ⚠️ Seguridad — la lección que costó un proyecto

El Firebase original (`rodizio-cucuta-08`) **fue suspendido por Google el 11 ago 2026**, muy
probablemente por abuso de terceros aprovechando reglas de RTDB abiertas. Se migró a `rodizio-eb49a`
y después a `rodiziomarketplace`.

- **Nunca abrir las reglas con un `true` genérico**, ni "temporalmente" para desbloquear algo. Así
  se perdió el proyecto original. Ver `docs-fusion/DIAGNOSTICO-FUSION.md`.
- Ante un `permission_denied` inesperado, **diagnosticar la regla puntual** — no abrir.
- `/solicitudes` sí lleva escritura pública (sin `auth != null`) porque `panel-cliente` no tiene
  login. Es la excepción deliberada, no el patrón.
- Si el proyecto viejo se reactiva, **no volver a usarlo** sin cerrar las reglas primero.
- Las reglas cerradas ya están desplegadas, pero **el flujo completo de mesas bajo esas reglas
  sigue sin probar de punta a punta**.

---

## Qué cambió en la fusión

Si el contexto viene de código o documentación pre-fusión, estos son los puntos donde ya no aplica:

- **Datos por SDK, no REST+SSE.** `shared/firebase.js` usa el SDK (`shared/firebase-app.js` =
  `initializeApp` único). `escucharSSE(path, onData, onStatus)` envuelve `onValue` — el nombre
  quedó del esquema viejo.
- **Una sola colección `orders`** (antes `/pedidos`), campo **`status`** (antes `estado`), con
  `origen: "mesa" | "domicilio" | "recoger"`. Helpers en `shared/util.js`: `origenDe`, `statusDe`,
  `tsDe`, `nombreLinea/precioLinea/notaLinea`.
- **Escalera de estados:** `recibido → enviado → preparacion → listo → en_camino → llegado → entregado`
  (+ `cancelado`, `no_entregado`). `recibido`, `en_camino` y `llegado` **no se cocinan**.
  `llegado` ("Llegando" en los paneles) lo marca la app del domiciliario solo, por geofence GPS
  al entrar al radio del destino (o a mano); sigue siendo una entrega en curso.
- **El menú vive en RTDB** (`categories`/`products`/`sugerencias`), lo carga
  `shared/menu-loader.js`. `shared/menu.js` quedó **solo como fuente del seed**.
- **`rolesPermitidos` es un MAPA** (`{"admin": true}`), no un array.
- **Pedido de domicilio → cocina:** el cajero lo confirma en `panel-caja`, pestaña Domicilios
  (`recibido → enviado`; ya no es una acción de `tienda/admin.html`), ahí mismo asigna domiciliario
  y tiempo, y aparece en `panel-cocina` como ticket "Domicilio".

---

## Acceso y roles — el modelo real

**Cualquier trabajador activo puede operar mesero, caja o cocina.** No se asignan esos roles uno por
uno: los turnos rotan, y el panel que usa una persona lo define el dispositivo donde trabaja ese
día. El login raíz le muestra los 3 paneles para que elija.

`admin` es el **único** rol que se asigna explícitamente (checkbox en `panel-admin`), porque da
acceso a gestionar trabajadores.

**El admin entra a mesero/caja/cocina en modo OBSERVACIÓN (solo lectura).** El guard detecta
`hasRole(perfil, "admin")` y llama a `activarModoObservador()` (`shared/ui.js`): pone
`window.__SOLO_LECTURA = true` y muestra `#obs-badge`. `shared/firebase.js` revisa esa bandera antes
de CADA escritura (`dbSet/dbUpdate/dbDelete/dbPush/siguienteCodigo`) y la vuelve no-op + toast.
Es una **barrera de interfaz, no de reglas RTDB** — alcanza para "el dueño quiere mirar sin romper
nada", no para un atacante.

**Sesión: una sola vez, en el login raíz (`/index.html`).** Cada app solo trae un guard que en cada
carga verifica sesión de Firebase Auth válida + perfil en `/trabajadores/{uid}` +
`estado === "activo"`. Si algo falla, redirige a `/`. Consecuencia práctica: desactivar un
trabajador lo saca de **todas** las apps en la siguiente carga, aunque tuviera sesión abierta.

**`panel-cliente` es la excepción a todo**: no tiene login y **no es PWA** (sin
`manifest.webmanifest` ni `sw.js`). Es una página simple que se abre al escanear el QR de la mesa,
para que cargue rápido sin fricción de instalación. Requiere `?mesa=<id>` válido; sin eso muestra
"Enlace no válido".

---

## Trampas del menú

- **IDs**: prefijo de categoría de 3 letras mayúsculas + guión + número de 2 dígitos (`ENT-01`,
  `PAR-03`). Antes era `en1`/`pa3` (2 letras, sin guión); se cambió para leer de un vistazo a qué
  categoría pertenece un código en los reportes. Único en todo el archivo. Prefijos:
  Entradas→`ENT`, Para Compartir→`COM`, De la Parrilla→`PAR`, Angus Beef→`ANG`, Burger Angus→`BUR`,
  De la Casa→`CAS`, Del Mar→`MAR`, Menú Infantil→`INF`, Postres→`POS`, Bebidas→`BEB`,
  Cervezas 3 Cordilleras→`CER`, Mocktails→`MOC`, Cocteles→`COC`, Licores→`LIC`, Vinos→`VIN`,
  Champagnes→`CHA`.

- ⚠️ **El nombre del archivo de foto NO coincide con el `id` del ítem.** Están en `icons/menu/`
  (155 de 162 ítems tienen foto). Se bajaron una vez del menú digital de Ola Click y quedaron como
  archivos estáticos — **sin dependencia en vivo con Ola Click**. Los `.webp` conservaron su nombre
  original (`en1.webp`, `pa3.webp`) cuando los ids cambiaron de formato, así que `img` es un campo
  **independiente**: no se puede derivar la ruta desde el `id`. Al agregar un plato o cambiar una
  foto hay que poner el `.webp` a mano y editar `img`. Hoy solo se muestran en `panel-cliente`.

- **Fotos en Firebase Storage (desde 2026-10-07).** `products.image`/`productsMesa.image` guardan la
  URL completa de `menu/<f>.webp` (lista, 320 px) en el bucket `rodiziomarketplace.firebasestorage.app`;
  el detalle usa `menu/hd/<f>.webp` (800 px), derivada por `urlFoto()` (`tienda/js/data.js`) y
  `rutaFoto()` (`shared/menu-loader.js`), que también traducen rutas viejas `icons/menu/…` de pedidos
  y carritos guardados. `icons/menu/` queda en el repo como copia maestra pero **no se despliega**
  (`ignore` de ambos `firebase.json`). Foto nueva: subirla en la consola a `menu/` (y `menu/hd/`) y
  pegar la URL en el producto. La función `fotoMenuSubida` (us-east1) les pone caché pública sola.
  Reglas: `storage.rules` (lectura pública solo de `menu/`).
- **`.git` estuvo publicado en los 5 sitios de la raíz** hasta el 2026-10-07 (`"**/.*"` no lo
  excluía). Ya está en el `ignore`; no quitarlo.

---

## No reintroducir estos bugs ya corregidos

El porqué de cada uno está en `docs/pre-fusion.md`. La lista corta:

- **No** poner limpieza automática de cuentas en cada carga — borraba cuentas legítimas cuyo
  usuario contenía cierto substring.
- **No** autologuear después de registrar una cuenta — vuelve al login a propósito.
- **No** duplicar `dbUrl`/`dbGet` dentro de cada app — viven solo en `shared/firebase.js`.
- **No** cerrar la sesión cuando alguien entra a un panel sin permiso — solo redirigir al login.
- **No** volver a poner el tablero Nuevos/Preparación/Listos en `panel-caja` — duplicaba
  `panel-cocina`, se quitó a propósito.
- **No** aplicar `database.rules.json` sin antes hacer lo que ese mismo archivo lista.
- **No** reintroducir reserva exclusiva de mesas (dueño / `meseroId` / bloqueo) — se probó y se
  descartó.
- **No** dejar que `panel-cliente` escriba directo en los pedidos — el pedido del comensal solo va a
  `/solicitudes/{mesaId}`; el mesero siempre confirma y lo pasa a cocina. Decisión explícita del
  dueño del negocio, no un detalle técnico.
- **No** hacer que enviar una comanda a una mesa ocupada cree un pedido nuevo — bug real, duplicaba
  el ticket en cocina. Va como ronda nueva al pedido activo
  (`pedidoActivoDeMesa()`/`agregarRonda()`).
- **No** resetear el pedido completo a `"enviado"` al agregar una ronda a uno ya `listo`/`entregado`
  — bug real: la parte ya servida parecía tener que prepararse de nuevo. El estado es **por ronda**
  (`rondaEstados`/`estadoDeRonda`/`estadoEfectivoTicket`).
- **No** hacer `dbDelete` sobre un pedido al cancelarlo — se marca `cancelado` para que el dueño
  tenga registro completo en el reporte de caja.
- **No** quitar los guards anti-doble-clic (`state.enviando`, los `Set` de ids en curso en
  `marcarServido`/`marcar`/`confirmarPago`) por creerlos redundantes — sin ellos, un toque doble o
  una conexión lenta dispara la misma escritura dos veces.

---

## Probar sin tocar producción

`node scripts/entorno-local.mjs` levanta todo en este PC con emuladores (reglas reales, menú
público copiado de producción, cuentas de prueba): paneles en `localhost:5050`, tienda en
`localhost:8080`. En `localhost` las apps se conectan solas a los emuladores (`MODO_LOCAL` en
`shared/firebase-app.js` y `tienda/js/firebase-config.js`) y no registran service worker.

- El namespace local es `demo-rodizio`, no `demo-rodizio-default-rtdb`: es el que usa el
  emulador de functions, y si la app mira otro, `crearPedido` responde "el producto ya no existe".
- La paleta vive en `shared/marca.css` y los íconos de categorías (Lucide) en
  `shared/iconos-categoria.js`; la tienda usa las copias `tienda/css/marca.css` y
  `tienda/js/iconos-categoria.js` que genera `scripts/sync-marca.mjs` (corre sola antes de cada
  deploy de la tienda). No editar las copias.

## Despliegue

**Proyecto `rodiziomarketplace`, hosting multisitio con targets.** Cada panel es su propio sitio:

| Target | Sitio | URL |
|---|---|---|
| `mesero` | `rodizio-mesero` | rodizio-mesero.web.app |
| `cocina` | `rodizio-cocina` | rodizio-cocina.web.app |
| `caja` | `rodizio-caja` | rodizio-caja.web.app |
| `cliente` | `rodizio-cliente` | rodizio-cliente.web.app |
| `admin` | `rodizio-admin` | rodizio-admin.web.app |

Más el marketplace en `rodiziomarketplace.web.app`.

⚠️ **`.firebaserc` NO está versionado**, y ya no basta con `firebase use --add`: lleva los cinco
targets de hosting. En una máquina nueva hay que recrearlos con
`firebase target:apply hosting <target> <sitio>` según la tabla, o el deploy no sabe a dónde ir.
Ver `docs-fusion/HOSTING-MULTISITIO.md`.

- Confirmá el proyecto con `firebase use` **antes** de cualquier deploy.
- La cuenta que administra `rodizio-eb49a` es `rodizio895@gmail.com`. Si el CLI está en otra,
  `firebase login --reauth`.
- `rodiziocucuta21.web.app` sigue en pie sirviendo una versión vieja — **no es el destino**.
- Los nombres `rodizio` y `rodizio-cucuta` quedaron **reservados globalmente** por el proyecto
  suspendido; Firebase no los libera aunque esté suspendido. Para una URL vendible la salida es
  conectar un dominio propio, no buscar un `.web.app` lindo que esté libre.

---

## Dónde está lo demás

| Necesito… | Archivo |
|---|---|
| **el estado real de la fusión** (hecho, desplegado, probado, siguiente paso) | `docs-fusion/ESTADO-ACTUAL.md` |
| el plan de la fusión por fases | `docs-fusion/PLAN-FUSION.md` |
| el esquema unificado de datos | `docs-fusion/ESQUEMA-UNIFICADO.md` |
| por qué se perdió el Firebase viejo | `docs-fusion/DIAGNOSTICO-FUSION.md` |
| esquema, flujos, rondas y mesas **pre-fusión**, con el porqué de cada decisión | `docs/pre-fusion.md` |
| el marketplace de domicilios | `tienda/CLAUDE.md` (lo vigente) y `tienda/docs/historial-cambios.md` (rondas de ajustes y bugs ya resueltos) |
| planes de pasarela, domicilios y reportes | `docs-fusion/PLAN-*.md` |
