# PLAN — Reportes unificados

**Rama:** `fusion` · 2026-09-06

## 0. Problema

Los reportes hoy están **repartidos en 3 lugares con criterios distintos**:

| Dónde | Qué muestra | Granularidad |
|---|---|---|
| `panel-admin` → Reportes (`dashboard.js`, Vue+Chart.js) | KPIs con Δ mes anterior, top platos, efectivo/tarjeta, ventas por mesa | **solo mensual** |
| `panel-caja` → Exportar Excel (`app.js`) | Cobrados del mes + resumen por plato | mensual |
| `tienda/admin.html` → Reportes | Ventas hoy/7d, top productos 30d, cierres de turno, ratings de domi | hoy / 7d / 30d |

Problemas concretos:
- **Sin comparación útil**: números sueltos ("Vendido hoy $519.000") sin "vs ayer / vs mismo día semana pasada / vs meta".
- **Sin filtro de canal**: desde que existe domicilio, no se puede ver mesa vs domicilio vs recoger.
- **Sin rango de fechas**: solo mes calendario (admin) o ventanas fijas (tienda).
- **Sin tiempos de operación**: cuánto tarda cocina, la entrega, la confirmación de caja.
- **Sin curva de demanda**: a qué hora / qué día se vende — clave para dimensionar turnos.
- La torta de pagos dice solo "Efectivo/Tarjeta" — falta **transferencia** (ya existe desde la Fase A del flujo de domicilio).
- El dashboard de admin no ve nada de domiciliarios (eso vive en tienda).

## 1. Principios (del checklist del usuario, aterrizados)

1. **Máx. 3 KPIs de titular** + drill-down. Para un local: Venta cobrada · Ticket promedio · Nº pedidos. El resto son secciones que se abren.
2. **Todo número lleva contexto**: Δ vs periodo anterior comparable + (cuando exista) vs meta.
3. **Nada de métricas de vanidad**: no "clientes registrados", no "visitas". Nº de pedidos solo vale junto a valor y tiempo.
4. **Tiempo real** (ya lo tenemos por SSE) — no hace falta job de agregación.
5. **Una sola capa de cálculo** en `shared/util.js` → el Excel de caja, el dashboard de admin y los reportes de tienda leen de ahí. Los números SIEMPRE coinciden.
6. **Filtros globales**: rango de fechas + canal + persona. Cada gráfico puede tener además un filtro propio.
7. **Dueño de la métrica**: cada sección dice a quién le sirve y qué decisión dispara.

## 2. Catálogo de métricas

Marcadas: ✅ calculable HOY con lo que ya se guarda · 🟡 necesita un campo nuevo · 🔴 necesita decisión del usuario.

### 2.1 Ventas — audiencia: dueño

| Métrica | Cómo | Estado |
|---|---|---|
| Venta neta cobrada (`pagado === true`, sin cancelado) | Σ `total` | ✅ |
| Δ vs periodo anterior comparable (día→día, semana→semana, mes→mes) | mismo cálculo, ventana desplazada | ✅ |
| Δ vs mismo día de la semana pasada | ventana -7d | ✅ |
| Δ vs meta | meta de `settings` | 🟡 (guardar meta) |
| Ticket promedio (global y por canal) | venta / nº pedidos | ✅ |
| Nº de pedidos cobrados | count | ✅ |
| Unidades vendidas | Σ `lineas[].qty` | ✅ |
| Desglose por método: efectivo / tarjeta / **transferencia** | group by `metodoPago` | ✅ (falta agregar transferencia a la torta) |
| Venta por canal: mesa / domicilio / recoger | group by `origen` | ✅ |
| Ingresos por domicilio (`shipping`) | Σ `shipping` | ✅ |
| Propinas totales | Σ `tipAmount` | ✅ |
| Tendencia diaria (línea) dentro del rango | serie por día | ✅ (falta el gráfico de línea) |
| Margen bruto / plato más rentable | precio − costo | 🔴 **necesita costo por plato** |

### 2.2 Operación / tiempos — audiencia: dueño + cocina

Todo sale de `statusHistory[]` (cada cambio con `status`, `at`, `byEmail`) + `rondaPrepInicio`.

| Métrica | Cómo | Estado |
|---|---|---|
| Tiempo de cocina (enviado/preparacion → listo) | Δ timestamps | ✅ |
| Tiempo de confirmación de caja (`createdAt` → `tsConfirmado`) | Δ | ✅ |
| Tiempo de entrega domicilio (`en_camino` → `entregado`) | Δ | ✅ |
| Tiempo total cliente (pedido → entregado/servido) | Δ | ✅ |
| % pedidos "a tiempo" vs ETA prometido (`etaMinutes`) | comparar real vs `etaSetAt + etaMinutes` | ✅ |
| Tasa de cancelación (y motivos) | count `cancelado` / total | ✅ (motivos: mesa usa texto libre, domicilio lista fija) |
| Tasa de "no entregado" + motivos | `deliveryFailureReason` | ✅ |
| Pedidos por hora del día (heatmap / barras) | bucket por hora de `createdAt` | ✅ |
| Pedidos por día de la semana | bucket | ✅ |
| Pico de demanda (hora + día con más pedidos) | max del bucket | ✅ |

### 2.3 Productos — audiencia: dueño + compras

| Métrica | Cómo | Estado |
|---|---|---|
| Más vendidos (unidades y $) | `ventasPorPlato()` | ✅ (ya existe) |
| Menos vendidos / sin rotación | mismo, orden inverso + los que no aparecen | ✅ |
| Productos que se agotan seguido | historial de `outOfStock` | 🟡 (hoy `outOfStock` no guarda histórico, solo estado actual) |
| Ítems por pedido | Σ qty / nº pedidos | ✅ |
| Venta por categoría | group by `lineas[].cat` | ✅ |
| Rentabilidad por plato | 🔴 costo por plato | 🔴 |

### 2.4 Personas — audiencia: dueño

| Métrica | Cómo | Estado |
|---|---|---|
| Venta por mesero + nº mesas + rondas promedio | group by `mesero` | ✅ |
| Cobros por cajero (monto, turno, método) | group by `cajero` | ✅ |
| Domiciliario: entregas/día | group by `driverId`, `entregado` | ✅ |
| Domiciliario: tiempo promedio de entrega | de `statusHistory` | ✅ |
| Domiciliario: rating promedio | `driverRatings` | ✅ (existe en tienda) |
| Domiciliario: diferencias de cuadre de caja | `cashSettlements.difference` | ✅ (existe en tienda) |

### 2.5 Domicilios — audiencia: dueño + despacho

| Métrica | Cómo | Estado |
|---|---|---|
| Nº y $ de domicilios por día | filter `origen` | ✅ |
| Zona más pedida | `matchZone(address)` (ya existe en `settings.js`) | ✅ |
| Tiempo confirmación caja → salida del domi | Δ | ✅ |
| % que llega `llegado` por GPS vs botón manual | `statusHistory[].note` | ✅ |
| Domicilios sin domiciliario asignado a tiempo | `driverId` null pasados X min | ✅ |

## 3. Decisiones abiertas (usuario)

| # | Decisión | Recomendación |
|---|---|---|
| D1 | **Costo por plato** — ¿agregar un campo `costo` a cada producto del menú para tener margen/rentabilidad? | **Sí, vale la pena** — es el dato que convierte "vendí mucho" en "gané". Trabajo: campo en el editor de menú de `tienda/admin.html` + `panel-admin`. Se puede hacer en una fase aparte, no bloquea el resto. |
| D2 | **Meta de venta** — ¿meta diaria y/o mensual editable en Configuración? | Sí, es barato y habilita todo el "vs meta". |
| D3 | **Histórico de agotados** — ¿empezar a registrar cada vez que un producto se marca agotado (nodo nuevo `stockEvents`)? | Opcional, fase tardía. Nice-to-have. |
| D4 | **Motivo de cancelación en mesa** — unificar a lista fija como domicilio | Sí, chico, mejora el reporte de cancelaciones. |
| D5 | **Dónde vive el reporte unificado** | **`panel-admin` → Reportes** (ya es Vue+Chart.js, la base está). El Excel de caja y los reportes de tienda quedan como accesos rápidos que llaman a la misma capa. |

## 4. Estructura de pantalla propuesta (`panel-admin` → Reportes)

```
┌─ Reportes ───────────────────────────────────────────────┐
│ [Rango: Hoy ▾] [Canal: Todos ▾] [Persona: Todos ▾]  [⤓ Excel] │
│                                                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                    │
│  │ VENTA   │  │ TICKET  │  │ PEDIDOS │   ← 3 KPIs titular │
│  │ $X ▲12% │  │ $Y ▼3%  │  │ N ▲5%   │   Δ vs comparable  │
│  └─────────┘  └─────────┘  └─────────┘                    │
│                                                          │
│  ── Ventas ──────────────────────────                    │
│  [línea: venta por día en el rango]                      │
│  [barras: por canal]  [torta: efectivo/tarjeta/transf]   │
│                                                          │
│  ── Operación ───────────────────────                    │
│  Cocina Xmin · Entrega Ymin · Confirmación Zmin (con Δ)  │
│  [barras: pedidos por hora]  [barras: por día de semana] │
│  Cancelación X% · No entregado Y%                        │
│                                                          │
│  ── Productos ───────────────────────                    │
│  [tabla top/bottom, filtro categoría]  [venta x categoría]│
│                                                          │
│  ── Personas ───────────────────────                     │
│  [tabla meseros] [tabla cajeros] [tabla domiciliarios]   │
│                                                          │
│  ── Domicilios ─────────────────────                     │
│  [zona más pedida] [% GPS auto vs manual] [tiempos]      │
└──────────────────────────────────────────────────────────┘
```

Rangos: **Hoy · Ayer · Últimos 7 días · Este mes · Mes pasado · Personalizado**.
Cada rango define su "periodo anterior comparable" para los Δ.

## 5. Fases de implementación

| Fase | Qué | Depende de |
|---|---|---|
| **R1** | Capa de cálculo en `shared/util.js`: `filtrarPedidos({desde,hasta,origen,persona})`, `resumenVentas()`, `serieDiaria()`, `tiemposOperacion()`, `bucketsPorHora/Dia()`, `resumenCanales()`, `resumenPersonas()`. Con tests `node --check` + casos. | — |
| **R2** | `panel-admin` Reportes: filtro global (rango + canal + persona), 3 KPIs titulares con Δ dinámico, gráfico de línea de tendencia. Reemplaza el selector de solo-mes. | R1 |
| **R3** | Sección Operación: tiempos (cocina/entrega/confirmación), curva por hora y por día, tasas de cancelación/no-entregado. | R1 |
| **R4** | Sección Canales + torta de pagos con transferencia + sección Domicilios (zona, GPS auto vs manual). | R1 |
| **R5** | Sección Personas unificada (meseros + cajeros + domiciliarios con rating y cuadre) — trae acá lo que hoy está en tienda. | R1 |
| **R6** | Excel: `panel-caja` y un botón nuevo en Reportes exportan desde la misma capa (R1), con las hojas por sección. | R1–R5 |
| **R7** *(opcional)* | D1 costo por plato → margen. D2 metas. D4 motivos de cancelación unificados. | decisión usuario |

## 6. Notas técnicas

- El dashboard ya carga Chart.js + Vue por CDN — agregar tipo `line` no suma peso.
- `statusHistory` puede no existir en pedidos viejos de prueba → todos los cálculos de tiempo deben tolerar `undefined` (devolver `null`, no romper).
- `panel-admin` pagina `orders` (`limitToLast`) — un rango largo puede exceder lo cargado. Para reportes de rango amplio quizás haya que subir el límite o hacer una query por `createdAt` (ya está en `.indexOn`).
- Mantener el filtro base "solo `pagado`" para plata; los tiempos y conteos operativos usan TODOS los pedidos no cancelados.
