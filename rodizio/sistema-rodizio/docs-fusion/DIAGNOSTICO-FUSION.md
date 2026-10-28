# Diagnóstico — fusionar el sistema de mesas + el marketplace en uno

**Fecha:** 2026-09-05
**Objetivo del restaurante:** un pedido de domicilio debe entrar como una "mesa nueva"
y aparecer de una en la comanda de cocina; alguien en **caja** lo confirma antes (estilo
TNS: suena, entra, se acepta). En la práctica, caja termina con **dos vistas**: mesa y
domicilio.
**Proyecto Firebase destino elegido:** `rodiziomarketplace`.
**Este documento es solo diagnóstico** — no es el plan de implementación todavía.

---

## 1. Resumen ejecutivo

Son **dos sistemas independientes** del mismo negocio, cada uno con su propio proyecto
Firebase, su propio modelo de datos y su propia forma de hablar con la base:

| | sistema de mesas (raíz del repo) | marketplace de domicilios (ahora en `tienda/`) |
|---|---|---|
| Proyecto Firebase | `rodizio-eb49a` | `rodiziomarketplace` |
| RTDB | `rodizio-eb49a-default-rtdb` | `rodiziomarketplace-default-rtdb` |
| Apps | 5 PWAs (mesero, cocina, caja, admin, cliente-QR) | 3 apps (cliente web, panel, domiciliarios) |
| Cómo lee la base | REST + SSE **sin SDK y sin token** | SDK de Firebase con `onValue` + auth real |
| Reglas RTDB | **abiertas** (`.read/.write: true`) | **cerradas y bien hechas** |
| Menú | 162 ítems **fijos en código** (`shared/menu.js`) | en RTDB, editable desde el panel |
| Login | 1 (usuario sintético `x@rodizio.local`) | 3 (Google clientes · correo panel · correo drivers) |
| Build | ninguno, PWAs sueltas | módulos ES + `npm start` + Cloud Functions |
| Pedido | `/pedidos` con **rondas** y estado por ronda | `orders`, lineal, con logística de domicilio |

**Veredicto:** se puede fusionar, pero hay **6 choques de lógica reales**. Los dos más
caros son **unificar el modelo de pedido** y **unificar el menú**. La seguridad (cerrar
las reglas de RTDB para las apps de mesa) deja de ser opcional en cuanto todo comparte
una sola base con una tienda pública encima.

> **Actualización tras revisar los datos (ver sección 5):** las dos bases están en
> **datos de prueba** — ninguno de los dos sistemas atiende clientes reales todavía. No
> hay migración de datos riesgosa. El trabajo real es de **código**: unificar dos
> código-bases pre-lanzamiento y lanzar una sola vez.

---

## 2. Los 6 choques de lógica

Peso: **S** = chico · **M** = mediano · **L** = grande.

### 2.1 Modelo de pedido — `/pedidos` vs `orders` · peso **L**

| | mesas (`/pedidos/{pushId}`) | domicilios (`orders/{pushId}`) |
|---|---|---|
| Estados | `enviado · preparacion · listo · entregado · cancelado` | `recibido · en_cocina · en_camino · entregado · no_entregado · cancelado` |
| Granularidad | **por ronda** (`rondaEstados`, `estadoEfectivoTicket`, `rondaPrepInicio`) | lineal, un solo estado por pedido |
| Líneas | `{id, nombre, cat, qty, precio, nota, ronda}` | `{id, name, price, qty, notes}` |
| Timestamp de creación | `ts` = `Date.now()` del navegador | `createdAt` = `serverTimestamp()` |
| Identificador visible | `codigo` = `P-014` (correlativo **diario** con ETag) | el `pushId` (no hay correlativo) |
| Campos propios | `mesa`, `mesaId`, `mesero`, `meseroUsuario`, `rondas`, `tsCambio`, `avisoCambio`, `pagado`, `metodoPago`, `cajero` | `uid`, `customerName`, `phone`, `address`, `deliveryMode`, `customerLocation`, `subtotal`, `shipping`, `total`, `scheduledFor`, `etaMinutes`, `driverId`, `driverLocation`, `driverTrail`, `tipAmount`, `statusHistory` |
| Cómo lo leen cocina/caja | SSE sobre `/pedidos` **entero** | SDK con `limitToLast(400)` + query por `uid`/`driverId` |

**Qué hay que decidir:** una sola colección `/pedidos`. Un pedido de domicilio pasa a ser
un `/pedidos` normal con `origen: "mesa" | "domicilio" | "recoger"` (sin `origen` ⇒
`"mesa"`, mismo patrón de fallback que ya usa `rondaEstados`). Los campos de domicilio
quedan opcionales. **Hay que mapear los dos vocabularios de estado** — p. ej. el
`recibido/en_cocina` del marketplace cae en `enviado/preparacion` de cocina; `en_camino`
es un estado nuevo que solo aplica a `origen: "domicilio"`.

### 2.2 Menú — `shared/menu.js` vs `categories`/`products` · peso **L**

| | mesas | domicilios |
|---|---|---|
| Dónde vive | archivo `shared/menu.js` (1209 líneas, fijo) | RTDB `categories` + `products`, editable desde el panel |
| Estructura | array de grupos `{cat, items:[…]}` | productos planos con `categoryId` |
| IDs | `ENT-01`, `PAR-03`… (prefijo de 3 letras por categoría) | libres (`picanha`, `ancho`…) |
| Campos | `nombre`, `desc`, `precio`, `img` | `name`, `description`, `price`, `image`, `badge` |
| Editar | requiere `deploy` | en vivo, sin tocar código |
| Contenido | **el menú real de 162 ítems** (bajado de Ola Click) | `data.js` trae solo una **semilla genérica de 7 categorías** — falta verificar qué tiene la base de producción |

**Qué hay que decidir:** una sola fuente del menú, en RTDB, estilo marketplace. Hay que
(a) migrar los 162 ítems reales al esquema `categories`/`products`, (b) reapuntar
`mesero-app` y `panel-cliente` para que lean el menú de RTDB en lugar de `menu.js`, y
(c) decidir qué pasa con `SUGERENCIAS` por categoría (hoy solo existe en el de mesas) y
con las 155 fotos `.webp` del repo de mesas.

### 2.3 Identidad y usuarios · peso **M** · **FUERA DE ALCANCE por ahora**

> Decisión del usuario (2026-09-05): como todo está en desarrollo y no hay cuentas
> reales, no se toca el tema de unificar logins/roles en esta ronda. Se deja para
> después. Lo único que sí hay que hacer ya es pasar `rolesPermitidos` de array a mapa
> (o al esquema `admins/{uid}`) para que la regla de RTDB funcione.


| Nodo | mesas | domicilios |
|---|---|---|
| Empleados | `/trabajadores/{uid}` — `nombre, usuario, rolesPermitidos[], estado` | `admins/{uid}` = `true`/`"dueno"`/`"cajero"` |
| Domiciliarios | — | `drivers/{uid}` — `access, name, phone, available, fcmTokens` |
| Clientes | — (nadie se autentica) | `users/{uid}` — `addresses`, `fcmTokens`; login con Google |
| Login | correo sintético `usuario@rodizio.local`, SDK 12.17.1 | Google + correo/contraseña, SDK 10.13.0, sesión aislada por página |

**Qué hay que decidir:** al consolidar en `rodiziomarketplace`, los `trabajadores` del
sistema de mesas se migran como cuentas de correo/contraseña de ese proyecto. Los
clientes de Google y los domiciliarios **ya están** ahí — no se tocan.
**Choque conocido:** `rolesPermitidos` se guarda como **array** (`["admin"]`), y eso
rompe una regla de RTDB del borrador (`database.rules.json`, punto 3). Al fusionar hay
que pasarlo a mapa (`{"admin": true}`) o unificarlo con el esquema `admins/{uid}`.

### 2.4 Reglas de RTDB y forma de hablar con la base · peso **M–L, bloqueante**

- Las apps de mesa hablan con RTDB por **REST + `EventSource` sin ningún token**. Eso
  **solo funciona con las reglas abiertas**. En el proyecto `rodiziomarketplace` las
  reglas están cerradas → **las apps de mesa dejan de funcionar** apenas apunten ahí.
- Para arreglarlo hay dos caminos:
  1. Adjuntar el ID token de Firebase Auth como `?auth=<token>` a cada petición REST y a
     cada stream SSE, **y** renovarlo cada hora reconectando el stream solo (los 5 puntos
     de `sistema-rodizio/database.rules.json`).
  2. Migrar las apps de mesa a usar el **SDK de Firebase** como el marketplace — más
     trabajo de una vez, pero elimina toda la clase de problema (token, refresco,
     reconexión) y deja los dos lados hablando igual.
- La tienda pública (`panel-cliente` por QR y el checkout de domicilio) escribe sin
  login → necesita una **regla pública pero acotada** para su cola de entrada
  (`/solicitudes` y la cola de domicilio), validando el shape, sin abrir el resto.
- **Motivo por el que esto es urgente:** exponer una tienda pública publica la URL de la
  base a cualquiera. Es exactamente el vector por el que Google suspendió el proyecto
  viejo de mesas (`rodizio-cucuta-08`) el 11 ago 2026.

### 2.5 Correlativo de pedido (`codigo` `P-001`) · peso **S**

Mesas numera los pedidos por día (`siguienteCodigo()` con ETag). El marketplace no
numera nada. **Decisión menor:** si los pedidos de domicilio también llevan `P-NNN`, un
prefijo aparte (`D-NNN`), o se dejan con el `pushId`.

### 2.6 Cocina y caja — el cambio que pidió el restaurante · peso **M**

Estado actual:
- `panel-cocina` y `panel-caja` leen `/pedidos` entero por SSE y filtran por `estado`.
- `panel-caja` **solo** ve pedidos ya `entregado` y confirma el pago (`pagado`, `metodoPago`).
- El marketplace ya tiene su **propio panel** (`tienda/admin.html`) que recibe los pedidos de
  domicilio con sonido, botones de estado, asignación de domiciliario y GPS.

Lo que falta para lo que pide el restaurante:
- Un pedido de domicilio confirmado = un `/pedidos` con `origen: "domicilio"` y una
  **"mesa virtual"** (p. ej. `"Domicilio · Juan P."` o `"Recoge · #A3F2"`). Cocina lo ve
  como un ticket más, etiquetado.
- El paso de **"confirmar" en caja** es **nuevo** — hoy en el marketplace los pedidos de
  domicilio entran directo a la cola como `recibido`, sin que nadie los acepte. Habría
  que replicar el patrón de `/solicitudes` (cola de entrada → alguien confirma → recién
  ahí entra a `/pedidos`).
- **Cobro:** un domicilio contra-entrega lo paga el cliente al domiciliario, y la
  rendición de efectivo ya existe en el marketplace (`cashSettlements`). Hay que decidir
  si esos pedidos pasan por el flujo de cobro de `panel-caja` o lo saltan.

---

## 3. Flujo cocina/caja acordado (2026-09-05)

**Sin "mesa virtual".** El pedido de domicilio ya entra al panel del marketplace
(`tienda/admin.html`) con sonido. El único cambio de fondo: que al **confirmarlo**, aparezca en
el tablero de `panel-cocina` como un ticket más, etiquetado "Domicilio", sin mesa y sin
ronda.

1. Cliente pide en la tienda web → `orders/{id}` con `status: "recibido"`.
2. Caja lo ve en `tienda/admin.html` (ya funciona) y toca **Confirmar** (= el botón "En cocina"
   que ya existe, o un paso "Confirmar" nuevo antes de ese).
3. Al confirmar, el pedido pasa a un estado que `panel-cocina` reconoce → aparece en su
   columna "Nuevos" / "En preparación" como cualquier comanda.
4. Cocina lo avanza con el flujo normal (Nuevos → Preparación → Listos).
5. Cuando está listo, sigue el flujo de domicilio del marketplace (asignar domiciliario,
   salir, entregar) — eso no cambia.

Para que el paso 3 funcione hace falta que `panel-cocina` y `tienda/admin.html` lean **la misma
colección de pedidos** — es lo que resuelve el punto 2.1 (modelo de pedido unificado).
La asignación de domiciliario y el GPS se quedan en `tienda/admin.html`; `panel-cocina` solo
suma los tickets de `origen: "domicilio"` a su tablero.

---

## 4. Datos — no hay nada que migrar (confirmado por el usuario, 2026-09-05)

Todo está en desarrollo, ninguno de los dos sistemas atiende clientes reales. Las dos
RTDB son de prueba (ver sección 5). Por lo tanto:

- **No hay migración de historial de pedidos, ni de clientes, ni de menú-en-base.**
- El único activo de datos real es el **menú de 162 ítems**, que está en el repo
  (`shared/menu.js`) — se carga a RTDB una sola vez con un script.
- Se guarda un backup de las 2 RTDB y un `auth:export` de los 2 proyectos **por
  disciplina** (commit + los 2 `.json` que ya están en la raíz), no porque haya riesgo.
- Los datos de prueba de las 2 bases se **borran** al consolidar.

---

## 5. Estado real de los datos (ya revisado — export de las 2 RTDB, 2026-09-05)

**Las dos bases están en datos de prueba. Ninguno de los dos sistemas está en uso real
todavía.** Esto cambia todo: no hay una migración de datos riesgosa — hay dos bases de
QA que se pueden vaciar.

### `rodiziomarketplace` (domicilios)
- `products`/`categories`: **el menú genérico de fábrica** (16 productos: Picanha, Bife
  Ancho, Alitas BBQ…). Nunca se cargó el menú real de 162 ítems.
- `orders`: ~21 pedidos, **todos de prueba** — cuentas del equipo
  (`[correo]`, `[correo]`…), direcciones repetidas,
  teléfonos falsos, hasta pedidos con `couponCode` de un sistema ya eliminado.
- `admins`: 1 · `drivers`: 1 ("Julian Rolon") · `users`: ~3 cuentas de prueba.
- `settings`: lo único semi-real — tel `+57 3052321975`, cierre 14:30, zona "Caobos",
  domicilio $5.000, mínimo $5.000.
- `outOfStock`, `customerFlags`: vacíos.
- Por los `errorLogs`: **las reglas publicadas están viejas** respecto al repo
  (`permission_denied` en `/cashSettlements` y `/driverRatings`).

### `rodizio-eb49a` (mesas)
- `pedidos`: **8 pedidos**, todos `entregado`+`pagado`, todos de prueba (meseros
  "rodizio"/"Maria", montos de $1.2M, correlativos que se reinician). Algunos con IDs de
  menú viejos (`dm3`, `be1`, `po6`), otros con los nuevos (`ENT-02`, `VIN-01`).
- `trabajadores`: **2 cuentas** — "Maria" (`maria`, sin roles) y "rodizio" (`rodizio`,
  `rolesPermitidos: ["admin"]`).
- `contadores`: 3 días con actividad (ago 22, 30, 31).
- No hay `/solicitudes` ni `/mesas`. El menú vive en `shared/menu.js`, no en la base.

### Qué significa
- **No hay datos reales que perder.** El único activo de datos real es **el menú de 162
  ítems** — y está en el repo (`shared/menu.js`), no en una base.
- La consolidación deja de ser "migración entre 2 producciones" y pasa a ser: **unificar
  dos código-bases pre-lanzamiento, elegir un Firebase, vaciar lo de prueba, lanzar una
  sola vez.** Mucho más simple y rápido.
- **Falta confirmar con el usuario/restaurante:** ¿de verdad ninguno de los dos está
  atendiendo clientes reales hoy? Si el de mesas ya se usa a diario en el local, hay que
  revisar si este export salió del proyecto correcto.
- Las cuentas de Auth (2 en mesas, ~5 de prueba en marketplace) — falta el
  `firebase auth:export` de los 2 para ver la lista completa, pero el volumen es mínimo.

---

## 6. Esfuerzo estimado por bloque

| Bloque | Peso | ¿Bloqueante? | Notas |
|---|---|---|---|
| Backup + export de Auth de las 2 bases | S | sí (primero) | por disciplina; hay poco que respaldar |
| Unificar el modelo de pedido (`/pedidos` + `origen`) | **L** | sí | el corazón del trabajo |
| Cargar el menú real (162 ítems) a RTDB + reapuntar mesero-app y panel-cliente | **L** | sí | primera vez que el menú real entra a una base |
| Cerrar reglas RTDB + adaptar apps de mesa (token o SDK) | **M–L** | sí | la "Fase 9" que estaba pausada |
| Vaciar datos de prueba de las 2 bases | **S** | sí | no hay historial que conservar |
| Puente domicilio → cocina (ticket "Domicilio" en `panel-cocina` al confirmar) | **M** | sí | el cambio que pidió el restaurante (ver sección 3) |
| `rolesPermitidos` array → mapa (para que la regla de RTDB funcione) | S | sí | único pedazo de "identidad" en alcance |
| Correlativo / etiqueta "Domicilio" | S | no | detalle de presentación |
| Reportes unificados (Excel de caja + reportes del panel) | M | no | se puede diferir |
| Unificar logins/roles (3 → 1) | M | **no** | diferido por decisión del usuario |
| Unificar el código de los dos frontends en uno | **L** | **no** | opcional, se hace después sin prisa |

---

## 7. Plan de implementación

Ver **`PLAN-FUSION.md`** (documento aparte).
