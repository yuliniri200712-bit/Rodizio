# Fusión: un solo sistema para mesas + domicilios

`fusion` → `main` · 32 commits

Une el **sistema de mesas** (5 PWAs vanilla) y el **marketplace de domicilios**
(hecho aparte) en un solo sistema: un Firebase, una colección de pedidos, un
menú, unas reglas. Todo en desarrollo, sin datos reales — no hay migración.

---

## 1. Estructura y base de datos

- El marketplace pasó a `tienda/` dentro de este repo. Los docs de la fusión a
  `docs-fusion/`.
- **Un solo Firebase: `rodiziomarketplace`.** `shared/firebase-app.js` (nuevo)
  inicializa Firebase una vez para todas las apps de mesa.
- **`shared/firebase.js` reescrito sobre el SDK de Firebase** (antes: REST + SSE
  sin token). Con las reglas cerradas, las apps de mesa funcionan porque el SDK
  adjunta el token de Auth tras el login.
- **Una sola colección `orders`.** El campo de estado es `status` (mesa traía
  `estado` — se lee con fallback). `origen` distingue `"mesa" | "domicilio" |
  "recoger"` (sin `origen` ⇒ `"mesa"`). Helpers de compatibilidad en
  `shared/util.js` para las líneas (`nombre/precio/nota` ↔ `name/price/notes`)
  sin renombrar 100 sitios.
- **El menú (159 ítems) vive en RTDB** (`categories`/`products`/`sugerencias`),
  lo carga `shared/menu-loader.js`. `shared/menu.js` queda como fuente de la
  semilla (`scripts/build-menu-data.mjs` → `scripts/menu-seed/`).
- **`database.rules.json` unificado** — reglas del marketplace + `orders` para
  trabajadores activos + `solicitudes` pública acotada (cliente QR) + menú
  público. `rolesPermitidos` pasó de array a mapa. Desplegado en
  `rodiziomarketplace`.

## 2. Flujo de domicilio

**Escalera:** `recibido → enviado → preparacion → listo → en_camino → llegado →
entregado` (+ `cancelado`, `no_entregado`).

| Estado | Quién lo marca |
|---|---|
| `recibido` | el cliente, al pedir en la tienda |
| `enviado` | **CAJA** — `panel-caja` pestaña "Domicilios", botón "Confirmar y mandar a cocina". Aquí, y solo aquí, entra a la comanda |
| `preparacion` / `listo` | cocina (`panel-cocina`); en domicilio, un solo botón "Listo para el domi" |
| `en_camino` | el domiciliario ("Recogí el pedido") — un toque cierra cocina y arranca la ruta |
| `llegado` | **automático** — el GPS del domi entra en 150 m del destino (geofence en `driver.js`, sobre `customerLocation` o `destinoCoords` que geocodifica caja). Botón "Llegué" manual como fallback |
| `entregado` | el domiciliario — siempre manual |

- `panel-caja` gana la pestaña **"Domicilios"** (diseño Rodizio): confirmar,
  asignar domiciliario, tiempo estimado, nota interna, ver ubicación del domi,
  cancelar y **cobrar** (efectivo/tarjeta/transferencia).
- `tienda/admin.html` **pierde el botón "Confirmar"** — la puerta a cocina es
  caja. El resto de su logística sigue, en paralelo, para el equipo de domicilios.

## 3. Caja = única autoridad del dinero

- **Todos** los pedidos (mesa + domicilio + recoger) pasan por `panel-caja` para
  confirmar `pagado` + `metodoPago` + `cajero`.
- Domicilio se puede cobrar desde `en_camino`/`llegado` (el domi cobró al salir)
  o al `entregado` (paga al volver).
- **La plata solo cuenta con `pagado === true`** — en `panel-caja`, en el
  dashboard de `panel-admin` y en `tienda/admin.html` ("Vendido hoy" y reportes).
  Un pedido entregado sin cobrar no es venta. Prepara el sistema para la pasarela.
- `transferencia` hoy se marca a mano; con la pasarela se marcará sola.

## 4. Correlativo unificado

`P-001` (mesa) / `D-001` (domicilio). El de domicilio se asigna cuando **caja
confirma**. Antes se veía el pushId crudo de Firebase (`-P0tPTEG8YmBF76FwXsZ`);
ahora, si un pedido no tiene código todavía, se muestra un corto legible
(`#FWXSZ`). Helpers `codigoPedido()` / `codigoCorto()` en `shared/util.js`.

## 5. Reportes unificados

Antes había tres reportes que calculaban lo mismo de tres formas. Ahora **una
sola capa de cálculo en `shared/util.js`** alimenta el dashboard de
`panel-admin`, el Excel de `panel-caja` y los reportes de la tienda — los números
coinciden por construcción. `scripts/test-reportes.js`: 60 verificaciones,
`node scripts/test-reportes.js`.

- `panel-admin` → Reportes reescrito: **filtro global** (rango + canal + persona)
  y **filtro por sección**, KPIs con Δ contra el periodo del mismo largo,
  tendencia diaria, ventas por canal, torta por método (con transferencia),
  **tiempos de operación** (cocina / entrega / confirmación de caja / % a tiempo,
  con aviso cuando la muestra es chica), demanda por hora y por día, tasas de
  cancelación con motivos, productos y equipo.
- Ancho completo en escritorio; el header se pliega al bajar.
- Docs: `docs-fusion/SISTEMA-REPORTES.md` (técnico) y `GUIA-REPORTES.md` +
  `.pdf` (guía simple para el dueño).

## 6. Horario de Colombia (UTC-5 fijo), para todo

Bug real: el correlativo diario usaba `toISOString()` (UTC) → se reiniciaba a las
7 p.m. hora de Cúcuta. Ahora todo corte de fecha ("hoy", los rangos, la curva
por hora, el día de la semana, el correlativo) es respecto a la medianoche de
Colombia, no a la del dispositivo. Helpers `relojCO`/`inicioDiaCO`/`isoDiaCO`/
`esHoyCO`/`fmtHoraCO`/`fmtFechaCO` en `shared/util.js` (y en `tienda/js/data.js`,
que no carga `shared/util.js`).

---

## Estado / cómo probar

- **Todo el código pasa `node --check`.** `node scripts/test-reportes.js` en verde.
- Reglas unificadas + menú desplegados en `rodiziomarketplace`. Cuenta de
  trabajador `rodizio@rodizio.local` creada (`/trabajadores/3tJJAXr…`).
- Server local: `python -m http.server 8000` desde la raíz. Hard-refresh +
  desregistrar los Service Workers (subieron de versión).
- Probado en desarrollo: flujo de tienda, confirmación en caja, puente a cocina,
  cobro, reportes con datos de prueba. Pendiente: prueba con volumen real y la
  pasarela de pago (Wompi, cuando el usuario elija proveedor).

## Diferido (no en este PR)

Unificar los 3 logins en uno; renombrar las líneas de pedido
`nombre/precio/nota` → `name/price/notes`; topología de hosting multi-sitio;
costo por plato → margen; metas de venta; pasarela de pago + validación del
`total` en backend.
