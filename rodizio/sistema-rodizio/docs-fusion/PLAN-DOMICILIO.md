# PLAN — Flujo de domicilio unificado (caja + cocina + domiciliario)

**Rama:** `fusion` · commit por fase · 2026-09-06

Decisiones tomadas con el usuario:

1. **Confirmar `recibido → enviado` = SOLO CAJA.** Se quita el botón "Confirmar"
   de `tienda/admin.html`. Caja es la única puerta de entrada a cocina.
2. **`llegado` automático por GPS.** Umbral 150 m. Si el pedido no trae
   `customerLocation`, se geocodifica la dirección con Nominatim → `destinoCoords`.
   Si la geocodificación falla, el domi tiene botón manual "Llegué".
3. **Cocina se agiliza:** el pedido de domicilio no necesita marcado manual paso
   a paso. Cuando el domiciliario marca **"Recogí el pedido"** eso significa que
   salió de cocina (`listo` implícito) y va `en_camino` — un solo toque del domi
   cierra cocina y arranca la ruta. Cocina solo cocina; puede marcar "Listo" para
   avisar que la bolsa está en el mostrador, pero no es obligatorio para el flujo.
4. Ejecución corrida, commit por fase.

---

## Escalera de estados (con `llegado` nuevo)

```
recibido → enviado → preparacion → listo → en_camino → llegado → entregado
                                                          ▲ automático (GPS)
```
`cancelado`, `no_entregado` aparte. `preparacion` es opcional en domicilio.

| Estado | Quién | Dónde |
|---|---|---|
| `recibido` | cliente | checkout de la tienda |
| `enviado` | **caja** | `panel-caja` → pestaña Domicilios → "Confirmar y mandar a cocina" |
| `preparacion` | cocina (opcional) | `panel-cocina` botón "Avanzar" |
| `listo` | cocina (opcional) o implícito | `panel-cocina`, o lo fuerza el domi al recoger |
| `en_camino` | domiciliario | `driver.html` "Recogí el pedido" — arranca GPS |
| `llegado` | **automático** | geofence GPS < 150 m del destino; fallback botón "Llegué" |
| `entregado` | domiciliario | `driver.html` "Entregado" — manual, corta GPS, finaliza |
| pago | **caja** | efectivo (al despachar o al volver el domi); transferencia → pasarela futura |

---

## Fase A — La confirmación se muda a caja

- `panel-caja/index.html`: estructura de pestañas — **"Cobrar"** (lo actual) +
  **"Domicilios"** (nueva). Diseño Rodizio, no se incrusta la tienda.
- `panel-caja/app.js`:
  - `render()` reparte: los `origen === "mesa"` y el cobro siguen igual en Cobrar;
    los `origen !== "mesa"` alimentan la pestaña Domicilios.
  - Pestaña Domicilios: pedido `recibido` → tarjeta destacada + beep + botón grande
    **"Confirmar y mandar a cocina"** → `dbUpdate` `{ status:'enviado',
    rondaEstados:{1:'enviado'}, confirmadoPor, tsConfirmado }`.
  - Pedidos ya confirmados: tarjeta con estado en vivo, contacto, dirección, total.
- `tienda/js/admin.js`: quitar el paso "Confirmar" de `STATUS_STEPS` como acción
  del panel; mientras `status === 'recibido'` mostrar "⏳ Esperando confirmación de
  caja" en vez de botón. El resto de la logística del panel sigue.
- `tienda/js/admin.js`: **el dinero solo cuenta con `pagado === true`.**
  `renderQuickStats` ("Vendido hoy") y cualquier cálculo de ventas suman solo
  pedidos pagados — igual que `panel-caja` y el dashboard de `panel-admin`. Un
  pedido sin cobrar no es venta (va también con la pasarela).

## Fase B — Logística de domicilio también en caja (diseño Rodizio)

- Pestaña Domicilios de `panel-caja`, por pedido confirmado:
  - Selector de domiciliario (lee `drivers` con `access === true`), asignar →
    `{ driverId, driverName, driverPhone }`.
  - ETA rápida 15/30/45/60 → `{ etaMinutes, etaSetAt }`.
  - Nota interna → `internalNote`.
  - Ubicación del domi en vivo → link Maps con `driverLocation`.
  - Cancelar (`cancelado` + motivo) / reintentar (`no_entregado → en_camino`).
- `tienda/admin.html` NO se elimina — sigue para el equipo de domicilios.

## Fase C — Agilizar cocina

- `panel-cocina/app.js`:
  - Botón único **"Avanzar"** por ticket/ronda (un toque = siguiente estado).
  - Ticket de domicilio: rótulo "Domicilio", visible en `enviado`/`preparacion`/
    `listo`, desaparece del tablero en `en_camino` (ya hay guard, ampliarlo).
  - Objetivos de toque grandes.
- `tienda/js/driver.js` (`handlePickup`): al marcar "Recogí el pedido", si el
  estado es `enviado`/`preparacion`/`listo` → `status:'en_camino'` +
  `rondaEstados:{1:'en_camino'}` + registrar `listo` en `statusHistory` si nunca
  pasó por ahí. Un solo toque cierra cocina y arranca la ruta.

## Fase D — `llegado` automático por GPS

- `shared/util.js`: `ORDEN_ESTADO_RONDA` → agregar `llegado: 5`, `entregado: 6`.
- `panel-caja` (al confirmar) y/o al asignar domi: si no hay `customerLocation`,
  geocodificar `address` con `nominatim.openstreetmap.org` → guardar
  `destinoCoords {lat,lng}`. Best-effort, no bloquea.
- `tienda/js/driver.js` (`startTracking` / callback de `watchPosition`): además de
  escribir `driverLocation`, calcular distancia Haversine a
  `order.customerLocation || order.destinoCoords`; si `< 150` m y
  `status === 'en_camino'` → `update {status:'llegado', rondaEstados:{1:'llegado'}}`
  una sola vez (flag local `llegadoMarcado[orderId]`), toast al domi.
- `driver.html`: en `en_camino`, agregar botón secundario **"Llegué"** (fallback
  manual). En `llegado`, el botón principal sigue siendo "Entregado".
- `tienda/js/ui.js` (`ORDER_STEPS`) y cliente: mostrar "El domiciliario está
  llegando" en `llegado`.
- `tienda/js/driver.js` (`ordersForFilter`, `activeDeliveries`): tratar `llegado`
  igual que `en_camino` (sigue en la pestaña "En camino", sigue compartiendo GPS).

## Fase E — Cobro efectivo del domicilio

- `panel-caja` `cobrable(p)`: mantener — domicilio cobrable desde `en_camino`
  (paga al salir) o `entregado` (paga al volver). Agregar `llegado` a la condición.
- Sin cambios en el cierre de turno del domi (`cashSettled` / `cashSettlements`
  ya existen). Transferencia → pasarela futura, no ahora.

## Fase F — Reglas, Functions, docs

- `database.rules.json`: permitir a trabajador activo escribir
  `status`/`confirmadoPor`/`tsConfirmado`/`destinoCoords`/`etaMinutes`/
  `internalNote`/`driverId` en `orders` de domicilio. Permitir valor `llegado`.
- `tienda/functions/index.js`: `STATUS_LABELS.llegado = "El domiciliario está llegando"`.
- Actualizar `ESTADO-ACTUAL.md` y `ESQUEMA-UNIFICADO.md`.
