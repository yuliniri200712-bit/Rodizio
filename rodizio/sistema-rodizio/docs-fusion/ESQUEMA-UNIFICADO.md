# Esquema unificado — Rodizio (mesas + domicilios)

**Fase 1 del `PLAN-FUSION.md`.** Este documento define el modelo de datos único al que
converge todo. Hay que aprobarlo (vos + tu compañero) antes de escribir código.

Proyecto Firebase: **`rodiziomarketplace`** · RTDB.

---

## Decisiones

| # | Decisión | Motivo |
|---|---|---|
| **D1** | Colección única: **`orders`**. Campo de estado: **`status`**. | Las Cloud Functions (`orders/{id}/status`) y las 3 apps del marketplace no cambian de nombres. Las apps de mesa cambian igual por el proyecto nuevo + SDK. |
| **D2** | Las apps de mesa pasan al **SDK de Firebase** (Fase 2b). | Elimina el problema de token/refresco/reconexión SSE. |
| **D3** | Pedido de domicilio lleva `codigo` con prefijo **`D-`** (`D-001`), correlativo diario. Pedido de mesa sigue con **`P-`** (`P-001`). Ambos usan el mismo `siguienteCodigo()` con contador por día. | Trazable en cocina y en reportes. |
| **D4** | Escalera de estados unificada (abajo). | Un solo vocabulario; los estados que no aplican a un `origen` simplemente no se usan. |

---

## 1. Colección `orders`

Un documento por pedido, sea de mesa o de domicilio. Lo distingue el campo **`origen`**.

### 1.1 Campos comunes (todos los pedidos)

| Campo | Tipo | Notas |
|---|---|---|
| `origen` | `"mesa" \| "domicilio" \| "recoger"` | **sin `origen` ⇒ `"mesa"`** (fallback, igual que `rondaEstados`) |
| `codigo` | string | `P-001` (mesa) / `D-001` (domicilio y recoger) — ver D3 |
| `lineas` | array | shape único, ver 1.4 |
| `total` | number | COP |
| `status` | string | ver escalera en §2 |
| `createdAt` | number | `serverTimestamp()` — **se estandariza a servidor** (mesa hoy usa `Date.now()` del cliente) |
| `tsCambio` | number | último cambio de estado |
| `rondaActual` | number | 1 si nunca se sumó nada. Domicilio/recoger: siempre 1 |
| `rondas` | `{ "1": ts, … }` | ronda → ts en que se agregó |
| `rondaEstados` | `{ "1": status, … }` | estado por ronda. Domicilio/recoger: `{ "1": <status> }` |
| `rondaPrepInicio` | `{ "2": ts }` | opcional — ts de "Empezar" por ronda |
| `tsUltimaRonda` | number | dispara el aviso sonoro en `panel-cocina` |

> Los helpers de `shared/util.js` (`estadoDeRonda`, `rondaEstadosCon`,
> `estadoEfectivoTicket`, `agruparPorRonda`) **funcionan sin cambios** para un pedido de
> una sola ronda — domicilio/recoger caen en ese caso.

### 1.2 Campos solo `origen: "mesa"`

| Campo | Notas |
|---|---|
| `mesa` | nombre visible ("Mesa 7") |
| `mesaId` | id local ("mesa-7") |
| `mesero`, `meseroUsuario` | quién tomó la comanda |
| `cliente` | opcional — nombre si vino de `/solicitudes` (QR) |
| `avisoCambio` | `{mensaje, mesero, ts}` — coordinación con cocina |
| `pagado`, `tsPago`, `metodoPago`, `cajero`, `cajeroUsuario` | cobro en `panel-caja` |
| `canceladoPor`, `tsCancelado`, `motivoCancelacion` | si `status === "cancelado"` |

### 1.3 Campos solo `origen: "domicilio"` / `"recoger"`

| Campo | Notas |
|---|---|
| `uid` | UID del cliente (cuenta Google) — **la regla de RTDB lo usa** |
| `customerName`, `customerEmail`, `phone` | contacto |
| `deliveryMode` | `"domicilio" \| "recoger"` (redundante con `origen`, lo escribe el checkout actual — se mantiene por compatibilidad) |
| `address`, `reference`, `customerLocation` | solo domicilio |
| `subtotal`, `shipping` | desglose; `total = subtotal + shipping` |
| `scheduledFor` | number \| null — pedido programado |
| `etaMinutes`, `etaSetAt` | tiempo estimado que pone caja |
| `internalNote` | nota interna, no la ve el cliente |
| `driverId`, `driverName`, `driverPhone` | asignación (en `tienda/admin.html`) |
| `driverLocation`, `driverTrail` | GPS en vivo |
| `tipAmount`, `cashSettled` | propina y rendición de efectivo |
| `deliveryFailureReason`, `deliveryFailureAt` | si `status === "no_entregado"` |
| `statusHistory` | `{pushId: {status, byEmail, at, note?}}` |
| `driverRatingSubmitted` | ya se calificó al domiciliario |
| `confirmadoPor`, `tsConfirmado` | **nuevo** — quién en caja confirmó el pedido (ver §2) |

### 1.4 Línea de pedido (shape único)

```
{
  id:      "ENT-01",        // id del producto en `products`
  name:    "Sopa del Día",  // denormalizado (hoy mesa usa `nombre`, marketplace `name`)
  price:   20000,           // (hoy mesa `precio`, marketplace `price`)
  qty:     2,
  notes:   "sin sal",       // (hoy mesa `nota`, marketplace `notes`)
  cat:     "Entradas",      // opcional — categoría, útil en reportes (mesa ya lo trae)
  ronda:   1                // 1 = pedido inicial. Domicilio/recoger: siempre 1
}
```

**Cambio de nombres:** `nombre→name`, `precio→price`, `nota→notes`. Afecta a
`mesero-app`, `panel-cocina`, `panel-caja`, `panel-cliente`, `shared/util.js`
(`ventasPorPlato` usa `l.nombre`/`l.precio`).

### 1.5 Ejemplos

<details><summary>Pedido de mesa (2 rondas)</summary>

```json
{
  "origen": "mesa",
  "codigo": "P-014",
  "mesa": "Mesa 7", "mesaId": "mesa-7",
  "mesero": "Juan Pérez", "meseroUsuario": "juanp",
  "lineas": [
    { "id": "PAR-03", "name": "Punta de Anca", "price": 62000, "qty": 1, "notes": "", "cat": "De la Parrilla", "ronda": 1 },
    { "id": "BEB-01", "name": "Limonada", "price": 15000, "qty": 2, "notes": "", "cat": "Bebidas", "ronda": 2 }
  ],
  "total": 92000,
  "status": "preparacion",
  "createdAt": 1788200000000,
  "rondaActual": 2,
  "rondas": { "1": 1788200000000, "2": 1788200600000 },
  "rondaEstados": { "1": "listo", "2": "enviado" },
  "tsUltimaRonda": 1788200600000
}
```
</details>

<details><summary>Pedido de domicilio</summary>

```json
{
  "origen": "domicilio",
  "codigo": "D-007",
  "uid": "AF5jVL2vhJUa4HNs1CP0OLePSuX2",
  "customerName": "María", "phone": "3001234567",
  "deliveryMode": "domicilio",
  "address": "Calle 9 #3-40", "reference": "Casa azul",
  "lineas": [
    { "id": "PAR-01", "name": "Picanha", "price": 38000, "qty": 2, "notes": "término medio", "cat": "De la Parrilla", "ronda": 1 }
  ],
  "subtotal": 76000, "shipping": 5000, "total": 81000,
  "status": "recibido",
  "createdAt": 1788300000000,
  "rondaActual": 1,
  "rondaEstados": { "1": "recibido" }
}
```
</details>

---

## 2. Escalera de estados (`status` y `rondaEstados[n]`)

```
                    ┌──────────── solo origen:domicilio/recoger ────────────┐
  recibido ──► enviado ──► preparacion ──► listo ──► en_camino ──► llegado ──► entregado
     │            │                          │          │            ▲
     │       (mesa arranca aquí)             │      (domi recoge)  automático GPS
     │                                  (recoger: cliente          (radio 150 m)
     │                                   pasa a buscarlo)
     └── el cliente pidió, CAJA todavía no confirma

  cancelado        — cualquier origen, antes de listo
  no_entregado     — solo domicilio, después de en_camino
```

| status | Significado | Quién lo marca | Aplica a |
|---|---|---|---|
| `recibido` | Cliente hizo el pedido en la tienda web. **Caja aún no lo confirma.** No aparece en cocina. | cliente | domicilio, recoger |
| `enviado` | Comanda en la cola de cocina. Mesa arranca aquí. Domicilio llega aquí cuando **caja confirma**. | mesa: mesero · domicilio: **caja** | todos |
| `preparacion` | Cocina lo está preparando (opcional en domicilio). | cocina | todos |
| `listo` | Listo para servir (mesa) / para que el domi lo recoja. | cocina (o implícito al recoger el domi) | todos |
| `en_camino` | Domiciliario lo recogió y salió. Un solo toque del domi: implica `listo` + salida. | domiciliario | domicilio |
| `llegado` | El GPS del domi entró en 150 m del destino. Botón "Llegué" como fallback manual. | **automático (GPS)** / domi | domicilio |
| `entregado` | Servido (mesa) / entregado al cliente (domicilio). Siempre manual. | mesa: mesero · domicilio: domiciliario | todos |
| `cancelado` | Cancelado antes de `listo` (cliente) o por caja en cualquier momento. | cliente / caja | todos |
| `no_entregado` | No se pudo entregar. | domiciliario | domicilio |

Pago (`pagado`/`metodoPago`): lo confirma **siempre caja** (`panel-caja`), para cualquier
origen. Domicilio se puede cobrar desde `en_camino`/`llegado` (el domi cobró al salir) o
al `entregado`. `transferencia` hoy es manual; con la pasarela se marcará sola.

### El paso "Confirmar" es EXCLUSIVO de caja

- `panel-caja` → pestaña **"Domicilios"** → botón **"Confirmar y mandar a cocina"**
  (`recibido → enviado`, escribe `confirmadoPor`/`confirmadoPorUsuario`/`tsConfirmado`,
  sincroniza `rondaEstados:{1:'enviado'}`). También geocodifica la dirección con
  Nominatim → `destinoCoords` (para el `llegado` automático).
- `tienda/admin.html` **ya NO tiene botón "Confirmar"** — mientras el pedido está
  `recibido` muestra "⏳ Esperando que caja confirme". El resto de su logística sigue.
- `panel-caja` pestaña Domicilios también trae asignar domiciliario, tiempo estimado,
  nota interna, cancelar y cobrar — con el diseño de Rodizio, sin incrustar la tienda.
  `tienda/admin.html` sigue funcionando en paralelo para el equipo de domicilios.
- `enviado`+ son los estados que `panel-cocina` incluye en su tablero. El ticket de
  domicilio se agiliza: un solo botón "Listo para el domi".

### Qué estado ve cada panel

| Panel | Muestra pedidos con `status` / `estadoEfectivoTicket` en… |
|---|---|
| `panel-cocina` | `enviado`, `preparacion`, `listo` (tablero) + `entregado` reciente (franja). **No** `recibido`. Domicilio: además muestra la etiqueta "Domicilio". |
| `panel-caja` (mesas) | pedidos `origen:"mesa"` en `entregado` sin `pagado` |
| `tienda/admin.html` (marketplace) | todos los `origen:"domicilio"`/`"recoger"`, cualquier estado |
| `mesero-app` | los pedidos `origen:"mesa"` del mesero en turno |

---

## 3. Menú en RTDB

Se abandona `shared/menu.js` como fuente. El menú vive en RTDB, con el
esquema del marketplace (`categories` + `products`), más un nodo `sugerencias`.

### 3.1 `categories/{catId}`

```
{ "name": "De la Parrilla", "order": 2 }
```

Mapa de los 16 grupos actuales a `catId` (slug):

| `cat` actual | `catId` | prefijo de id de producto |
|---|---|---|
| Entradas | `entradas` | `ENT` |
| Para Compartir | `para-compartir` | `COM` |
| De la Parrilla | `de-la-parrilla` | `PAR` |
| Angus Beef | `angus-beef` | `ANG` |
| Burger Angus | `burger-angus` | `BUR` |
| De la Casa | `de-la-casa` | `CAS` |
| Del Mar | `del-mar` | `MAR` |
| Menú Infantil | `menu-infantil` | `INF` |
| Postres | `postres` | `POS` |
| Bebidas | `bebidas` | `BEB` |
| Cervezas 3 Cordilleras | `cervezas-3-cordilleras` | `CER` |
| Mocktails | `mocktails` | `MOC` |
| Cocteles | `cocteles` | `COC` |
| Licores | `licores` | `LIC` |
| Vinos | `vinos` | `VIN` |
| Champagnes | `champagnes` | `CHA` |

`order` = posición en la lista de `menu.js` (0..15).

### 3.2 `products/{prodId}`

`prodId` = el id actual del menú de mesa (`ENT-01`, `PAR-03`…). **Se conserva tal cual**
— así los pedidos de prueba viejos y los futuros hacen match, y el prefijo dice la
categoría de un vistazo.

```
{
  "name":        "Crema de Pollo ó Champiñones",   // era `nombre`
  "description":  "Suave crema en bechamel…",       // era `desc`
  "price":        24000,                            // era `precio`
  "image":        "menu/en1.webp",                  // era `img` (ruta nueva, ver 3.4)
  "categoryId":   "entradas",
  "order":        0                                 // posición dentro de la categoría
}
```

Los 16 productos de la semilla vieja del marketplace (`picanha`, `ancho`…) se **borran**.

### 3.3 `sugerencias/{catId}` y `sugerenciasPorProducto/{prodId}`

```
sugerencias: {
  "de-la-parrilla": ["Término medio", "Bien asado", "Salsa aparte"],
  "angus-beef":     ["Término medio", "Bien asado", "Salsa aparte"],
  "burger-angus":   ["Sin cebolla", "Extra queso", "Papas aparte"],
  "de-la-casa":     ["Sin picante", "Salsa aparte", "Poca sal"]
}
sugerenciasPorProducto: {
  "PAR-08": ["Salsa BBQ", "Salsa ahumada", "Salsa aparte"]
}
```

La lógica de `sugerenciasParaItem()` (filtro por palabras clave de carne) se mantiene en
`mesero-app`/`panel-cliente`, solo que lee estas dos ramas en vez de constantes locales.

### 3.4 Fotos

Las 155 `.webp` de `icons/menu/` se copian al hosting unificado bajo
`menu/` (o `images/menu/`). El campo `image` de cada producto se ajusta a esa ruta. El
`seed` toma la ruta de `img` de `menu.js` y le cambia el prefijo.

---

## 4. Otros nodos

| Nodo | Cambio |
|---|---|
| `solicitudes/{mesaId}` | **se mantiene** — cola del cliente por QR. Líneas al shape único (§1.4). Necesita regla pública acotada (§5). |
| `contadores/{YYYY-MM-DD}` | **se mantiene** — ahora cuenta `P-` y `D-` juntos (un correlativo por día para todo el local). Regla: `auth != null`. |
| `settings` | **se mantiene** el del marketplace (horario, zonas, teléfono, mínimo). |
| `trabajadores/{uid}` | se mantiene. `rolesPermitidos` pasa de array `["admin"]` a mapa `{"admin": true}`. |
| `admins/{uid}`, `drivers/{uid}`, `users/{uid}`, `consents`, `errorLogs`, `outOfStock`, `customerFlags`, `cashSettlements`, `driverRatings` | **se mantienen** como están en el marketplace. |
| `pedidos` (viejo, mesa) | **desaparece** — todo va a `orders`. |
| `mesas` | no existe, sigue sin existir. |

---

## 5. Reglas de RTDB (finales)

Base: las del marketplace (`tienda/js/firebase-config.js`). Cambios:

- **`orders`**: la regla actual deja escribir a un admin, o al dueño del pedido
  (`newData.child('uid').val() === auth.uid`), o al domiciliario asignado. Falta el
  **personal de mesa**: agregar `|| root.child('trabajadores').child(auth.uid).child('estado').val() === 'activo'`
  a `.read` y `.write` de `orders` (un mesero/cajero/cocinero autenticado y activo puede
  leer y escribir cualquier pedido — misma laxitud ya aceptada para el cliente dueño).
- **`solicitudes`**: nueva. Escritura **pública** (sin `auth`) pero acotada:
  ```
  "solicitudes": {
    "$mesaId": {
      ".read": true,
      ".write": "!newData.exists() || (newData.hasChildren(['lineas','actualizado']) && newData.child('lineas').val().length <= 50)",
      ".validate": "newData.child('mesa').isString() && newData.child('actualizado').isNumber()"
    }
  }
  ```
- **`contadores`**: `.read`/`.write`: `"auth != null"`.
- **`trabajadores`**: `.read`: `"auth != null"`. `.write` de `$uid`: solo un admin
  (`root.child('admins').child(auth.uid).exists()` **o** el mapa
  `rolesPermitidos/admin === true` — según cómo quede D-identidad; por ahora el mapa).
- **`.indexOn`**: `orders` → `["uid","driverId","status","createdAt","origen"]`.

---

## 6. Checklist de cambios por app (derivado de este esquema)

| App | Cambios |
|---|---|
| `shared/firebase.js` | reescribir sobre el SDK (Fase 2b); `/pedidos` → `orders` |
| `shared/util.js` | `ventasPorPlato`: `l.nombre`→`l.name`, `l.precio`→`l.price` |
| `shared/roles.js` + `panel-admin` | `rolesPermitidos` array → mapa |
| `mesero-app` | menú desde RTDB (async); líneas `nombre/precio/nota`→`name/price/notes`; `estado`→`status`; `origen:"mesa"` al crear; `codigo` `P-` |
| `panel-cliente` | menú desde RTDB (async); líneas al shape único; `sugerencias` desde RTDB |
| `panel-cocina` | leer `orders`; filtrar/etiquetar por `origen`; `estado`→`status`; ignorar `recibido` |
| `panel-caja` | leer `orders` filtrando `origen:"mesa"`; `estado`→`status` |
| `tienda/js/admin.js` (marketplace) | `status` ladder nuevo (`recibido→enviado→…`); botón "Confirmar"; `origen:"domicilio"` al leer/crear; líneas ya usan `name/price/notes` |
| `tienda/js/driver.js` (marketplace) | `en_camino`/`entregado` sin cambio de nombre; revisar `status` strings |
| `tienda/functions/index.js` | `STATUS_LABELS`: agregar `enviado`; quitar/renombrar `en_cocina`→`preparacion` |
| `tienda/js/data.js` (marketplace) | ya no es semilla del menú real — se deja como fallback mínimo o se vacía |
