# Sistema de reportes — cómo funciona

**Rodizio Cúcuta** · rama `fusion` · actualizado 2026-09-06

Este documento explica **qué muestra cada número, de dónde sale y por qué se
calcula así**. Es la referencia para entender el reporte y para modificarlo sin
romper la coherencia entre pantallas.

Documentos relacionados: `PLAN-REPORTES.md` (el catálogo y las fases),
`ESQUEMA-UNIFICADO.md` (el modelo de datos), `ESTADO-ACTUAL.md` (dónde estamos).

---

## 1. La idea central: una sola fuente de cálculo

Antes de esta reescritura había **tres reportes distintos** que calculaban lo
mismo de tres formas: el dashboard de `panel-admin`, el Excel de `panel-caja` y
los reportes de `tienda/admin.html`. Cuando no coincidían, no había forma de
saber cuál tenía razón.

Ahora **todos los cálculos viven en un solo lugar**:

```
shared/util.js  ← LA CAPA DE REPORTES (única fuente de verdad)
      │
      ├── panel-admin/dashboard.js   (la pantalla de Reportes)
      ├── panel-caja/app.js          (el Excel de caja)
      └── tienda/js/admin.js         (los reportes de la tienda)
```

Reglas que hacen que esto funcione:

- La capa **no toca Firebase**. Recibe los pedidos ya cargados
  (`Object.entries(pedidos)`) y devuelve objetos planos. Es JavaScript puro y
  por eso se puede probar sin navegador.
- Todas las funciones reciben el mismo formato: `entries = [[id, pedido], ...]`.
- Si un número hay que cambiarlo, se cambia **una vez** y las tres pantallas
  quedan coherentes automáticamente.

**Prueba:** `node scripts/test-reportes.js` — 51 verificaciones sobre un set de
pedidos de ejemplo (mesa + domicilio + recoger, pagados y sin pagar, cancelado,
no entregado, con y sin historial de estados). Correrlo antes de tocar la capa.

---

## 2. Las tres reglas de negocio que gobiernan todo

### Regla 1 — El dinero solo cuenta cuando caja lo confirma

Un pedido suma a las ventas **únicamente si tiene `pagado === true`**, que es lo
que escribe `panel-caja` al cobrar (o lo que escribirá la pasarela de pago
cuando se integre).

*Por qué:* un pedido entregado pero sin cobrar no es plata en el bolsillo. Antes
de esta regla, el panel de la tienda sumaba el pedido apenas entraba —
mostraba "vendido hoy $519.000" cuando en realidad nadie había pagado todavía.
Eso es exactamente lo que rompería la contabilidad al conectar una pasarela.

### Regla 2 — Los conteos operativos usan todos los pedidos, no solo los pagados

Los **tiempos** y la **demanda** (pedidos por hora, por día) cuentan todos los
pedidos no cancelados, estén cobrados o no.

*Por qué:* un pedido que se preparó y no se cobró igual ocupó la cocina. Para
dimensionar turnos importa cuánta gente pidió, no cuánto entró en caja.

### Regla 2b — Todo corte de fecha es hora de Colombia

"Hoy", los rangos, la curva por hora, el día de la semana y el correlativo
diario (`P-`/`D-`) se calculan respecto a la **medianoche de Colombia (UTC-5
fijo)**, no a la hora del dispositivo que abre la app.

*Por qué:* si alguien consulta el dashboard desde un celular en otra zona
horaria — o el dueño viaja — "las ventas de hoy" tienen que seguir siendo el
mismo día para todos. Y con `toISOString()` (UTC) el correlativo `D-001` se
reiniciaba a las 7 p.m. hora de Cúcuta. Helpers en `shared/util.js`:
`relojCO()`, `inicioDiaCO()`, `isoDiaCO()`, `esHoyCO()`, `fmtHoraCO()`,
`fmtFechaCO()`. En `tienda/` (que no carga `shared/util.js`) los mismos
helpers viven en `js/data.js`.

### Regla 3 — Las comparaciones son contra un periodo del mismo largo

El Δ de cada KPI compara contra el periodo **inmediatamente anterior y del mismo
tamaño**: hoy contra ayer, una semana contra la semana previa, un mes contra el
mes previo.

*Por qué:* un número sin referencia no dice nada, y una referencia mal elegida
(una semana contra un mes) miente peor que no tener ninguna.

---

## 3. De dónde sale cada dato

Todo se calcula sobre la colección `orders` de Realtime Database. **No hay
tablas de resumen ni procesos nocturnos**: los reportes leen los pedidos crudos
y agregan en el navegador, en vivo por SSE.

Campos de un pedido que alimentan los reportes:

| Campo | Lo escribe | Se usa para |
|---|---|---|
| `origen` | la app que crea el pedido | separar mesa / domicilio / recoger |
| `status` | cada app según el flujo | filtrar cancelados, no entregados |
| `total`, `subtotal`, `shipping` | el checkout / mesero-app | ventas, envíos |
| `pagado`, `metodoPago`, `tsPago` | **`panel-caja`** | toda la plata |
| `createdAt` / `ts` | la app que crea el pedido | ubicar el pedido en el tiempo |
| `tsConfirmado` | `panel-caja` al confirmar domicilio | tiempo de confirmación |
| `statusHistory[]` | cada cambio de estado, en toda app | **todos los tiempos** |
| `lineas[]` | la app que crea el pedido | productos, categorías, unidades |
| `mesero`, `cajero`, `driverName` | mesero-app / caja / asignación | reportes por persona |
| `etaMinutes`, `etaSetAt` | `panel-caja` (botones 15/30/45/60) | % a tiempo |
| `tipAmount` | el domiciliario al entregar | propinas |
| `motivoCancelacion`, `deliveryFailureReason` | quien cancela / el domi | motivos agrupados |

**`statusHistory` es la pieza clave de los tiempos.** Cada vez que alguien
cambia el estado de un pedido, se agrega una entrada `{status, at, byEmail}`.
De ahí salen todas las duraciones — no hace falta ningún campo extra.

---

## 4. Las funciones de la capa

Todas están en `shared/util.js`, sección "CAPA DE REPORTES".

### `rangoReporte(clave, personalizado)`

Traduce un rango elegido a milisegundos. Devuelve
`{clave, label, desde, hasta, desdeAnterior, hastaAnterior}`.

Claves: `hoy` · `ayer` · `7d` · `30d` · `mes` · `mesPasado` · `dia` (un día
concreto, `personalizado.dia = "YYYY-MM-DD"`) · `mesEspecifico` (un mes concreto,
`personalizado.mes = "YYYY-MM"`) · `custom` (desde/hasta libres).

`desdeAnterior`/`hastaAnterior` son el periodo del **mismo largo** justo antes —
de ahí salen los Δ (Regla 3).

> **Cuidado con las fechas.** `new Date("2026-09-06")` se interpreta como UTC y
> en Colombia (UTC-5) devuelve el día anterior. Por eso las claves `dia` y
> `mesEspecifico` parsean el texto a mano con `new Date(y, m-1, d)`.

### `filtrarPedidos(entries, opts)`

El filtro base del que parte todo lo demás.

```js
filtrarPedidos(entries, {
  desde, hasta,          // ventana de tiempo (ms)
  origen,                // 'mesa' | 'domicilio' | 'recoger' | '' (todos)
  persona,               // matchea contra mesero, cajero O driverName
  soloPagados,           // true para la plata (Regla 1)
  incluirCancelados,     // true solo para calcular la TASA de cancelación
})
```

`persona` busca en los tres campos a la vez: así el dashboard ofrece **un solo
selector** en vez de obligar al usuario a saber de antemano si el nombre que
busca es un mesero, un cajero o un domiciliario.

### `resumenVentas(entriesPagados)`

`{ total, pedidos, unidades, envios, propinas, ticketPromedio, itemsPorPedido,
porMetodo: { efectivo, tarjeta, transferencia, otro } }`

Los métodos de pago están fijos en esos cuatro. Cualquier valor desconocido cae
en `otro` en vez de perderse — si aparece un método nuevo, el total sigue
cuadrando.

### `variacionPct(actual, anterior)`

El Δ porcentual entero. **Devuelve `null` si `anterior` es 0**, para no mostrar
"∞%" o "+100%" cuando en realidad no hay base de comparación. La UI muestra
"Sin datos del periodo anterior".

### `serieDiaria(entriesPagados, desde, hasta)`

Un punto por **cada día del rango, incluidos los de $0**.

*Por qué importa:* si solo se devolvieran los días con ventas, la línea saltaría
los días vacíos y un lunes cerrado se vería como una recta ascendente en vez de
un bajón. La tendencia sería una mentira visual.

### `bucketsPorHora(entries)` / `bucketsPorDiaSemana(entries)`

La curva de demanda: 24 y 7 posiciones siempre presentes, aunque estén en cero.
Usan todos los pedidos no cancelados (Regla 2). Sirven para decidir cuánta gente
poner en cada franja.

### `tiemposDePedido(p)` y `tiemposOperacion(entries)`

Los cuatro tiempos que mide el sistema:

| Tiempo | Desde | Hasta | Qué revela |
|---|---|---|---|
| `confirmacion` | creación del pedido | `tsConfirmado` / estado `enviado` | cuánto tarda caja en aceptar un domicilio |
| `cocina` | confirmación | estado `listo` | cuánto tarda la cocina |
| `entrega` | estado `en_camino` | estado `entregado` | cuánto tarda el domiciliario |
| `total` | creación | `entregado` | lo que espera el cliente de punta a punta |

**Los pedidos sin `statusHistory` devuelven `null`, no `0`.** Un pedido viejo sin
historial contaría como "0 minutos" y hundiría el promedio hasta volverlo
inservible. Se descartan de la muestra y se informa cuántos quedaron.

`tiemposOperacion` devuelve, por métrica, un objeto `detalle` con
`{prom, mediana, n, min, max}`, más `pctATiempo` (cuántos se entregaron dentro
del estimado que prometió caja) y `muestrasEta`.

### `tasasIncidencia(entriesConCancelados)`

% de cancelados y de no entregados, con los **motivos agrupados y ordenados**.
Necesita los pedidos sin filtrar por estado (`incluirCancelados: true`) — si no,
el denominador estaría mal y la tasa saldría inflada.

### `resumenCanales` · `resumenPersonas` · `ventasPorCategoria` · `ventasPorPlato`

Agregaciones simples. `resumenPersonas(entries, rol)` recibe el campo a agrupar
(`'mesero'`, `'cajero'` o `'driverName'`) y devuelve filas ordenadas por total,
cada una con su propio ticket promedio.

---

## 5. La pantalla de Reportes

`panel-admin` → pestaña **Reportes**. Vue 3 + Chart.js por CDN, sin build.
El archivo (`dashboard.js`) **no calcula nada**: solo llama a la capa y pinta.

### Jerarquía visual

De arriba hacia abajo, de lo más importante a lo más específico:

1. **Filtro general** — rango + canal + persona. Afecta todo.
2. **3 KPIs titulares** — Venta cobrada · Ticket promedio · Pedidos, cada uno
   con su Δ. Son los tres números que responden "¿cómo vamos?".
3. **Números de apoyo** — unidades, ítems por pedido, envíos, propinas. En una
   línea de texto, sin tarjeta: son contexto, no titulares.
4. **Secciones** — Ventas, Operación, Productos, Equipo.

Solo 3 KPIs arriba es deliberado: más de eso y ninguno destaca. Lo demás se
consulta cuando hace falta, no compite por la atención.

### Los dos niveles de filtro

**Filtro general (arriba):** rango de fechas, canal (mesa/domicilio/recoger) y
persona. Es el contexto de toda la pantalla.

**Filtro por sección:** cada sección tiene el suyo. Por defecto dice *"Sigue el
filtro general"*; si se elige otra cosa, esa sección se independiza.

Esto permite comparar en una sola pantalla, por ejemplo, las ventas del mes
contra los tiempos de cocina de un día puntual.

> Cuando una sección tiene filtro propio muestra un **chip con su rango y una ×**
> para volver al general. Sin ese indicador es fácil leer un número creyendo que
> corresponde al filtro de arriba — un error de interpretación silencioso y
> difícil de detectar.

### Qué hay en cada sección

| Sección | Contenido | Para quién / qué decisión |
|---|---|---|
| **Ventas** | Línea de tendencia diaria, barras por canal, torta por método de pago | Dueño: ¿crece o baja? ¿qué canal tira? ¿cuánto efectivo hay que cuadrar? |
| **Operación** | Tiempos (cocina, entrega, confirmación de caja, % a tiempo), pedidos por hora y por día, tasas de cancelación y no entrega con motivos | Dueño + cocina: ¿dónde se atasca el flujo? ¿cuándo hace falta más gente? |
| **Productos** | Top platos, venta por categoría, buscador por código o nombre | Dueño + compras: qué se vende, qué no rota |
| **Equipo** | Meseros, cajeros y domiciliarios con pedidos y total | Dueño: rendimiento por persona |

### Cómo se comunica la confianza en los tiempos

Los promedios de tiempo son los números más fáciles de malinterpretar: con pocos
pedidos, uno solo que quedó abierto toda la tarde dispara el promedio y el
número parece absurdo sin que se sepa por qué.

Por eso cada tiempo declara su calidad:

- **Menos de 5 pedidos medidos** → borde punteado, número atenuado, texto
  "Poca muestra: solo N pedido(s)", más un aviso general debajo de la franja.
- **Promedio muy lejos de la mediana (>50%)** → "N pedidos · mediana X min
  (hay un caso atípico)". Señala que el promedio está inflado por un outlier.
- **Muestra sana** → "N pedidos · entre X y Y min".

El principio: **es preferible un número que admite su incertidumbre a uno que
aparenta precisión que no tiene.**

---

## 6. Cómo leer cada gráfico

Explicado con números, no con código. Los montos son de ejemplo.

### Los KPIs de arriba y el "▲ 641%"

Los tres números grandes son **venta cobrada, ticket promedio y pedidos**. Debajo
de cada uno, el "▲ 641% vs. periodo anterior" compara contra el mismo lapso justo
antes: si el rango es "Hoy", compara contra ayer; si es "Últimos 7 días", contra
los 7 anteriores.

> Con pocos días de datos esos porcentajes salen enormes ("▲ 800%") y **no son
> confiables** — si ayer hubo 1 pedido y hoy 9, el sistema dice "+800%" y es
> cierto pero no significa nada. Se estabilizan cuando hay semanas de historia.
> El número grande (la venta en sí) sí es real desde el primer día.

### Tendencia de venta — la línea

Un punto por cada día del rango. El lunes vendiste $150.000, el martes $600.000,
el miércoles cerraste y el punto baja a $0, el jueves $250.000. La línea sigue
esos altibajos.

- **Solo aparece con un rango de más de un día** — con "Hoy" no hay línea que
  dibujar, un solo punto no es una tendencia.
- **Pasá el mouse por un punto:** te dice el monto exacto y cuántos pedidos
  fueron ese día.
- **Para qué sirve:** ver si el negocio sube, baja o tiene un patrón (siempre
  flojo los martes, pico los viernes).

### Por canal — las barras de Mesa / Domicilio / Recoger

Reparte la venta del rango según de dónde vino el pedido. Si de $1.089.000 la
barra de Domicilio llega a $800.000 y la de Mesa a $250.000, **3 de cada 4 pesos
entran por domicilio**.

Debajo de las barras, una línea por canal: *"Domicilio · 7 ped. · ticket
$114.000"* — fueron 7 pedidos de domicilio y cada uno gastó $114.000 en
promedio. Sirve para ver si un canal vende poco pero con tickets altos, o mucho
con tickets bajos.

### Por método de pago — la rueda

Parte la plata cobrada según cómo pagó la gente: **efectivo, tarjeta,
transferencia**. Si la mitad de la rueda es efectivo, la mitad de la plata del
día está en billetes y hay que cuadrarla físicamente contra la caja al cerrar.
Pasá el mouse por un pedazo para ver el monto de ese método.

### Top platos — las barras horizontales

Cuenta **cuántas unidades** se vendieron de cada plato, no cuánta plata.
*"Coctel de Camarón — 9"* quiere decir que se pidieron 9 cocteles en el rango. El
de más arriba es el más pedido. El buscador de al lado filtra por código o
nombre para revisar un plato puntual aunque no esté en el top.

### Por categoría — las barras de grupos del menú

Agrupa la venta por el grupo al que pertenece cada plato en el menú (Entradas,
De la Parrilla, Bebidas…). *"Angus Beef — $350.000"* = sumando todos los cortes
Angus que se vendieron, entraron $350.000.

> **"Sin categoría"** aparece cuando un plato de un pedido no tenía grupo
> asignado en el menú. **No es un error de plata** — la venta está bien contada,
> solo que ese plato quedó sin clasificar. Se arregla poniéndole una categoría
> en el editor del menú (`tienda/admin.html` → Menú, o `panel-admin`), y a
> partir de ahí los pedidos nuevos ya caen en el grupo correcto.

### Pedidos por hora / por día de la semana — las barras de demanda

Cuentan **pedidos, no plata**, en cada franja horaria y en cada día. Si la barra
de las 20:00 es el doble que la de las 15:00, a las 8 de la noche entra el doble
de pedidos — ahí hace falta más gente en cocina y en salón. Usan todos los
pedidos, cobrados o no, porque un pedido que se preparó ocupó la cocina aunque
después se cancelara el pago.

### Los tiempos de Operación

Cada tarjeta muestra un promedio y, debajo, **de cuántos pedidos salió**:

- *"51 min · Cocina · Poca muestra: solo 3 pedido(s)"* → el promedio existe pero
  se calculó con 3 pedidos. Un pedido que quedó abierto por error dispara ese
  número. Tratalo como referencia, no como dato.
- *"18 min · Cocina · 40 pedidos · entre 9 y 32 min"* → confiable: 40 pedidos,
  y todos entre 9 y 32 minutos.
- *"45 min · Entrega · 21 pedidos · mediana 12 min (hay un caso atípico)"* → la
  mitad de las entregas fueron en 12 minutos o menos, pero una o dos muy largas
  subieron el promedio a 45. La mediana es el número más realista acá.

---

## 7. Notas técnicas

### Chart.js: dos trampas ya resueltas

1. **No compartir objetos de opciones entre gráficos.** Chart.js toma posesión
   del objeto que recibe y le instala descriptores internos; si dos gráficos
   comparten el mismo `ticks`, el segundo recibe uno ya envuelto y falla con
   `t.startsWith is not a function`. Por eso `ejeMoneda` es una **función** que
   devuelve un objeto nuevo cada vez.
2. **No reasignar `chart.options` al actualizar.** Rompe la misma estructura
   interna. `pintar()` solo reemplaza `data` y llama a `update()`. No hace falta
   más: las opciones son fijas y los callbacks de tooltip leen `.value` de los
   computed en cada llamada, así que ya salen frescos.

### Vue: `flush: "post"` es obligatorio

Algunos canvas viven detrás de un `v-if` (la línea de tendencia solo existe con
un rango de más de un día). Con el `flush: "pre"` por defecto, el watcher corre
**antes** de que Vue actualice el DOM, así que el `ref` sería `null` la primera
vez que el gráfico aparece y nunca se dibujaría.

También: si un canvas se desmonta y vuelve, la instancia vieja apunta a un nodo
que ya no está en el documento. `pintar()` detecta el cambio de canvas, destruye
la instancia y crea una nueva.

### `__dashboardOnShow`

La pestaña Reportes arranca en `display:none` y Chart.js no calcula bien el
tamaño de un canvas oculto. `panel-admin/app.js` llama a
`window.__dashboardOnShow()` al mostrarla, que redibuja y hace `resize()`.

### Ancho en escritorio

`panel-admin` estaba fijo en 900px (pensado para el formulario de trabajadores) y
los gráficos se ahogaban. El shell completo — header, pestañas y `main` juntos,
para que sigan alineados entre sí — se ensancha a 1500px desde 1200px de
viewport y a 1800px desde 1700px.

### Paginación de pedidos

`panel-admin` carga los pedidos con `limitToLast`. Un rango muy largo puede
exceder lo que está en memoria. Si un reporte de varios meses parece corto, esa
es la causa: hay que subir el límite o hacer una consulta por `createdAt` (el
índice ya existe en las reglas).

---

## 8. Qué NO hace todavía

| Falta | Qué haría falta |
|---|---|
| **Margen / rentabilidad por plato** | Un campo `costo` en cada producto del menú. Es lo que convierte "vendí mucho" en "gané". |
| **Metas de venta** | Un valor en `settings` para poder mostrar "vs meta" además de "vs periodo anterior". |
| **Histórico de agotados** | Hoy `outOfStock` guarda el estado actual, no un registro de cada vez que algo se agotó. |
| **Motivos de cancelación unificados** | Mesa usa texto libre, domicilio una lista fija. Unificarlos permitiría agrupar bien. |
| **Rotación de mesa** | Habría que registrar cuándo se libera una mesa; hoy se infiere. |
| **Excel desde la capa compartida** | El Excel de caja todavía tiene su propio armado (fase R6 del plan). |

---

## 9. Cómo agregar una métrica nueva

1. Escribir la función en la sección "CAPA DE REPORTES" de `shared/util.js`.
   Recibe `entries`, devuelve un objeto plano, no toca Firebase.
2. Agregar casos a `scripts/test-reportes.js` — incluyendo el caso vacío y el
   caso con datos faltantes. Correr `node scripts/test-reportes.js`.
3. Consumirla desde `dashboard.js` con un `computed`, usando el rango de la
   sección que corresponda (`rangoDe('ventas')`, etc.), no el global directo.
4. Si es un gráfico: agregar el `ref` del canvas, pintarlo dentro de
   `dibujarTodo()` y sumar el computed al array del `watch`.
5. Subir el `CACHE` de `panel-admin/sw.js` — si no, los navegadores siguen
   sirviendo la versión vieja.
