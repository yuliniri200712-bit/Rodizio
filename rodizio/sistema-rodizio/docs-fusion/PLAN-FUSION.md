# Plan de implementación — fusión Rodizio (mesas + marketplace)

**Contexto:** ver `DIAGNOSTICO-FUSION.md`. Todo está en desarrollo, sin datos reales.
Firebase destino: **`rodiziomarketplace`**. No hay migración de datos — solo consolidar
código y ajustar Firebase.

**Objetivo final:** un solo Firebase, una sola colección de pedidos, un solo menú en
RTDB, reglas cerradas, y que un pedido de domicilio confirmado en caja aparezca en el
tablero de cocina.

---

## Decisiones ya tomadas

| Tema | Decisión |
|---|---|
| Proyecto Firebase | `rodiziomarketplace` |
| "Mesa virtual" para domicilio | **descartada** — el pedido de domicilio aparece en cocina como ticket "Domicilio", sin mesa ni ronda |
| Confirmación | la hace **caja** desde el panel del marketplace (`tienda/admin.html`) |
| Identidad / unificar los 3 logins | **diferido** — no en esta ronda |
| Datos de prueba | se **borran** al consolidar |

## Decisiones tomadas (cont.)

| # | Decisión |
|---|---|
| **D2** | **Las apps de mesa pasan al SDK de Firebase.** `shared/firebase.js` se reescribe sobre el SDK, envuelto en las mismas funciones (`dbGet`, `dbUpdate`, `escucharSSE`…) para que los sitios de llamada casi no cambien. Se hace **temprano** (Fase 2b), todavía apuntando a `rodizio-eb49a` con reglas abiertas, para probarlo aislado. |

## Decisiones pendientes (Fase 1)

| # | Decisión | Recomendación |
|---|---|---|
| D1 | Nombre de la colección única y del campo de estado | **`orders` / `status`** (así las Cloud Functions y las 3 apps del marketplace casi no cambian) |
| D3 | ¿El pedido de domicilio lleva correlativo (`D-001`)? | sí, prefijo `D-` reusando `siguienteCodigo()` |
| D4 | Escalera de estados unificada | `recibido`(solo domicilio) → `enviado` → `preparacion` → `listo` → `en_camino`(solo domicilio) → `entregado`; + `cancelado`, `no_entregado`(solo domicilio) |

---

## Fases

### Estructura del repo (decidida 2026-09-05)

Todo vive en **un solo repo**: `github.com/deyvidjgv/sistema-rodizio`, rama `fusion`.

```
/                     sistema de mesas (mesero-app, panel-cocina, panel-caja,
                      panel-admin, panel-cliente, shared/, icons/)
/tienda/              marketplace de domicilios (era rodizio-marketplace-main)
/docs-fusion/         estos .md + los 2 export .json de RTDB
```

### Fase 0 — Preparación · peso S — ✅ hecho (parcial)
- [x] Backup de las 2 RTDB — los 2 `.json` en `docs-fusion/`.
- [x] Rama `fusion`.
- [x] Marketplace movido a `tienda/` (su `git init` se descarta; todo commitea acá).
- [ ] **Pendiente tuyo:** `firebase auth:export` de los 2 proyectos (necesita tu login
  de Firebase CLI — corré `! firebase login` y `! firebase auth:export …`).
- [ ] **Pendiente tuyo:** confirmar acceso CLI a `rodiziomarketplace`.

### Fase 1 — Esquema unificado (papel, antes de tocar código) · peso S — ✅ borrador escrito
`ESQUEMA-UNIFICADO.md` — **falta que lo aprueben vos + tu compañero.** Contiene:
- Shape final del pedido: campos comunes + campos por `origen` (`mesa`/`domicilio`/`recoger`).
- Escalera de estados (D4) y qué estados ve `panel-cocina`.
- Esquema del menú en RTDB: `categories`, `products`, y dónde van las `SUGERENCIAS` por
  categoría (nodo `sugerencias/{categoryId}` propuesto).
- Reglas de RTDB finales.
- Resolver D1, D3, D4.
- Que lo aprueben vos y tu compañero antes de seguir.

### Fase 2b — `shared/firebase.js` al SDK de Firebase · peso M — ✅ código hecho (falta probar)

Commit: `shared/firebase-app.js` nuevo (config única + `initializeApp`),
`shared/firebase.js` reescrito sobre el SDK (mismas funciones en `window`),
`shared/auth.js` reusa la instancia, `escucharSSE(path, onData, onStatus)`
nueva firma en 6 sitios, `esperarFirebase()` en `util.js`, `firebase.js`
pasa a `type="module"` en las 5 `index.html`. Sigue apuntando a
`rodizio-eb49a` con reglas abiertas.
**Probar:** `npm start` (o servidor local) → abrir las 5 apps de mesa,
verificar login, que cocina/caja/mesero reciben pedidos en vivo, que se
puede enviar una comanda (correlativo P-00X), y el dashboard de admin.

<details><summary>plan original</summary>
- Reescribir `shared/firebase.js` sobre el SDK de RTDB (`onValue`, `ref`, `update`,
  `push`, `get`, `remove`, `runTransaction`), manteniendo los nombres de función
  actuales (`dbGet`, `dbSet`, `dbPush`, `dbUpdate`, `dbDelete`, `escucharSSE`,
  `siguienteCodigo`).
- `escucharSSE(path, cb)` pasa a envolver `onValue` — devuelve el árbol completo en cada
  cambio en vez de eventos incrementales. Ajustar los `conectarPedidos()` /
  `conectarSolicitudes()` de las 5 apps para reemplazar su árbol local con el snapshot
  (ya casi lo hacen vía `aplicarEventoSSE`; se simplifica).
- Cargar el SDK como módulo ES (igual que `shared/auth.js` ya lo hace). Cada `index.html`
  de mesa carga `shared/firebase.js` como `type="module"`.
- **Todavía apunta a `rodizio-eb49a` con reglas abiertas** — así se prueba este cambio
  aislado, sin mezclarlo con el cambio de proyecto ni con las reglas.
- Probar las 5 apps de mesa de punta a punta.

</details>

### Fase 2 — Menú real a RTDB · peso M — ✅ código hecho (falta subir el menú + probar)

Commit: `scripts/build-menu-data.mjs` (parsea `shared/menu.js` → `scripts/menu-seed/*.json`,
159 productos / 16 categorías), `shared/menu-loader.js` nuevo (carga el menú
de RTDB y reconstruye `window.MENU`/`SUGERENCIAS`/`sugerenciasParaItem` con
la misma forma de antes), `mesero-app` + `panel-cliente` cargan el menú
async (`await esperarMenu()`), `index.html` cambian `menu.js` por
`menu-loader.js`, SW shells actualizados.
**Falta tuyo:** subir los JSON a RTDB — `firebase database:set /categories …`
etc. (ver `scripts/README.md`).
**Pendiente Fase 5:** la tienda no ve las fotos del menú real hasta unificar
el hosting (`/icons/`).

<details><summary>plan original</summary>
- Script `scripts/seed-menu.mjs`: lee `shared/menu.js`, escribe
  `categories` + `products` + `sugerencias` en `rodiziomarketplace`. Mapa de campos:
  `nombre→name`, `desc→description`, `precio→price`, `img→image`; `cat` (grupo) →
  categoría con id slug (`Entradas`→`entradas`, `De la Parrilla`→`de-la-parrilla`…).
- Copiar las 155 fotos `.webp` de `icons/menu/` al hosting unificado y
  ajustar el `image` de cada producto a la ruta nueva.
- `mesero-app` y `panel-cliente`: dejar de `import`ar `menu.js`; cargar el menú de RTDB
  al arranque (patrón de `catalog.js` del marketplace) y construir `MENU`/`ITEM_INDEX`/
  `CATS` desde ahí. Es el cambio más delicado de esta fase (esas apps hoy asumen el menú
  disponible de forma síncrona).
- El panel del marketplace queda como **único editor del menú**.
</details>

### Fase 3 — Modelo de pedido unificado · peso L — ✅ código hecho (falta probar)

Commit: colección `/pedidos` → **`orders`** en las 4 apps de mesa. Campo
`estado` → `status` (con fallback `p.status || p.estado` vía `statusDe()`
en `shared/util.js` — no se migran datos). Escalera de estados unificada
(`recibido → enviado → preparacion → listo → en_camino → entregado` +
`cancelado`/`no_entregado`). Helpers nuevos en `util.js`: `origenDe`,
`statusDe`, `tsDe`, `nombreLinea/precioLinea/notaLinea` (las líneas de
mesa siguen con `nombre/precio/nota`, las de domicilio `name/price/notes`
— los helpers bridgean; renombrar del todo queda para Fase 7).

- `mesero-app`: crea pedidos con `origen: "mesa"`, `codigo` `P-`, `status`.
- `panel-cocina`: lee `orders`; ignora `recibido`/`en_camino` del tablero;
  muestra ticket "Domicilio"/"Recoge en tienda" sin mesa; contacto = teléfono.
- `panel-caja`: filtra a `origen === "mesa"` (domicilio se cobra contra-entrega).
- `panel-admin` dashboard: `orders`, filtra a `origen === "mesa"`.
- **tienda**: `en_cocina` → `enviado`; STATUS_STEPS/ORDER_STEPS ganan
  `preparacion`/`listo`; `placeOrder` escribe `origen` + `lineas` (mirror de
  `items`, para `agruparPorRonda`); `admin.js` filtra los de mesa fuera del
  panel; `driver.js` arrays de "para recoger" incluyen los estados nuevos;
  `functions/index.js` STATUS_LABELS.
- **Limitación conocida:** `admin.js` hace `limitToLast(400)` sobre `orders`
  y luego filtra los de mesa — con mucho volumen el panel de domicilios
  podría ver menos de 400 domicilios. Fase 7: `.indexOn`/query por `origen`.

<details><summary>plan original</summary>
- Helpers compartidos para el shape del pedido y el mapeo de estados.
- `panel-cocina`: leer `orders`; entender `origen`; ticket "Domicilio" sin controles de
  mesa/ronda; mapear estados. Un `orders` con `origen:"domicilio"` y estado
  `recibido` **no** aparece; aparece al pasar a `enviado`.
- `panel-caja` y `mesero-app`: `/pedidos`→`orders`, `estado`→`status`, líneas al shape
  único (`{id, name, price, qty, notes, ronda?}`).
- `tienda/js/admin.js` / `tienda/js/driver.js` del marketplace: ajustar solo si cambió algún nombre de campo.
- `tienda/functions/index.js`: agregar labels de estado que falten; para `origen:"mesa"` no hay
  `uid`/tokens así que la notificación simplemente no se dispara — sin cambios extra.
- Correlativo `D-` para domicilio (D3).
</details>

### Fase 4 — Puente domicilio → cocina + "Confirmar" en caja · peso M — ✅ código hecho (falta probar)

La Fase 3 ya hizo el grueso (cocina lee `orders`, `enviado` ∈ tablero de
cocina). Fase 4 = la última milla:

- `tienda/js/admin.js` `handleStatusButtonClick`: el botón **"Confirmar"**
  (`recibido → enviado`) escribe `confirmadoPor` + `tsConfirmado`. En CADA
  cambio de estado sincroniza `rondaEstados: {1: status}` (el domicilio es
  de 1 ronda) para que cocina no lo deje pegado en "Listos" tras salir.
- `panel-cocina` `unidadesPendientes`: guard a nivel de ticket — si
  `statusDe(p)` ya es `en_camino`/`entregado`/`cancelado`, el ticket no se
  muestra aunque su `rondaEstados` viejo diga otra cosa.
- Flujo: cliente pide (`recibido`) → cajero abre `tienda/admin.html`, toca
  "Confirmar" (`enviado`) → aparece en `panel-cocina` → cocina
  "Empezar"/"Marcar listo" (`preparacion`/`listo`) → cajero/domiciliario
  sigue en `admin.html` (asignar, `en_camino`, `entregado`).
- **Friccción por identidad diferida:** el cajero necesita HOY dos cuentas
  — su usuario de mesa (panel-caja) **y** un `admins/{uid}: "cajero"` en la
  tienda (admin.html). Se resuelve al unificar logins (Fase 7).

### Fase 5 — Cerrar reglas + apuntar todo a un Firebase · peso M — ✅ código hecho (falta publicar + probar)

- `shared/firebase-app.js`: config → **`rodiziomarketplace`** (mismos valores que
  `tienda/js/firebase-config.js`). El SDK adjunta el token de Auth solo tras el login,
  así funciona con reglas cerradas.
- `database.rules.json`: reescrito — reglas del marketplace + `orders` para trabajadores
  activos + `solicitudes` pública acotada + `contadores` + `trabajadores` + menú público
  (`categories`/`products`/`sugerencias`) con escritura admin. `.indexOn` en `orders`.
- `rolesPermitidos` **array → mapa** (`{"admin": true}`): `panel-admin/app.js` y
  `shared/roles.js` (con `rolesComoArray()` que acepta las dos formas por compat).
- `firebase.json` (raíz): sección `database` + `functions: tienda/functions`. Hosting
  del sistema de mesas desde `.` (ignora `tienda/functions`, `docs-fusion`, `scripts`).
- **Pendiente tuyo:**
  1. `firebase deploy --only database` (apuntando a `rodiziomarketplace`) — publica las
     reglas nuevas. **Coordinar con tu compañero** (cambia las reglas de su proyecto).
  2. Fase 6: recrear las cuentas de `/trabajadores` en el Auth de `rodiziomarketplace` +
     subir el menú ahí — hasta entonces las apps de mesa no dejan entrar a nadie.
- **Hosting multi-sitio** (mesero/cocina/caja/admin/cliente vs tienda/admin.html/driver.html
  con `/icons/` compartido para las fotos del menú): topología a decidir — el `firebase.json`
  actual solo sirve el sistema de mesas. Queda para cuando definas los sitios/dominio.

### Fase 6 — Limpieza y cutover · peso S — 📋 runbook escrito (todo lo ejecuta el usuario)

Ver **`docs-fusion/FASE-6-RUNBOOK.md`** — backups, publicar reglas, subir el menú a
`rodiziomarketplace`, recrear las 2 cuentas de `/trabajadores`, borrar datos de prueba,
archivar `rodizio-eb49a`.

### Fase 7 — Diferido (no ahora)
- Unificar los 3 logins / roles en uno.
- Reportes unificados (el Excel de `panel-caja` + los reportes del panel del marketplace).
- Unificar los dos frontends en un solo código-base.
- Pasarela de pago (Wompi) + validar el total del pedido en un backend (hoy el navegador
  manda el `total` sin que nada lo verifique — aceptable solo mientras sea contra-entrega).

---

## Orden de trabajo

`0 → 1 → 2 → 2b → 3 → 4 → 5 → 6`

- **2b** (SDK) puede ir en paralelo con **2** (menú) — tocan cosas distintas.
- Unificar menú y modelo de pedido **antes** de mover el Firebase, así el cambio de
  proyecto (Fase 5) es lo último y se prueba todo junto una sola vez.

---

## Siguiente paso

Fase 0 + escribir `ESQUEMA-UNIFICADO.md` (Fase 1) con D1/D3/D4 resueltos, para que vos y
tu compañero lo aprueben antes de tocar código.
