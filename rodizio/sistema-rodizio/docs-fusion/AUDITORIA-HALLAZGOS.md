# Auditoría — hallazgos

Plan: `PLAN-SEGURIDAD-Y-AUDITORIA.md`. Severidad: 🔴 crítico · 🟠 alto · 🟡 medio · ⚪ bajo.
Estado: ✅ corregido y desplegado · ⬜ pendiente · 👤 decide el dueño.

## B3 — Consola, errorLogs y red (2026-10-07)

| # | Sev | Superficie | Hallazgo | Evidencia | Estado |
|---|---|---|---|---|---|
| H1 | 🟠 | Marketplace | Un pago en línea cuya transacción nunca se creó en AAvance quedaba "pendiente" para siempre: en cada visita el cliente veía "Verificando tu pago…" / "Tu pago aún se está procesando" y se hacían 4 llamadas a `verificarPagoEnLinea` | Reproducido con `RC1791361398169680` (intento fallido de AAvance) | ✅ `confirmarPagoPendiente` marca `expirado` si AAvance no tiene transacción pasados 30 min; la tienda olvida pendientes de más de 24 h sin llamar al servidor. Verificado en producción |
| H2 | ⚪ | Marketplace, admin domicilios, domiciliario | La consola se llenaba de `heartbeats`: `console.log` olvidado dentro del SDK de Firebase 10.13.0 | `firebase-app.js:2499` | ✅ SDK 10.13.0 → 10.13.2 (parche, misma API). Consola limpia verificada |
| H3 | 🟡 | Marketplace, domiciliario | 9 errores en `errorLogs` (2026-09-19, 10-05, 10-06): "Cannot set/read properties of null" en `renderClosedBanner`, `renderOrdersList`, `renderPaymentModes`, `bindProfileEvents` | Las líneas del stack no coinciden con el código actual y caen en días de despliegue; los ids existen hoy en el HTML. 8 de 9 son de un PC Windows (pruebas); 1 de un Android | ⬜ Causa probable: versiones mezcladas (el service worker usa la copia en caché de algunos archivos cuando falla la red). Propuesta: versionar los módulos o que el SW sirva HTML+JS de la misma versión |
| H4 | — | Los 8 sitios | Ningún `$('id')`/`getElementById` apunta a un elemento inexistente | Script de verificación estática, 8 páginas | ✅ sin hallazgos |
| H5 | — | Los 8 sitios | Pantalla inicial sin errores de consola | Revisión en navegador, con sonda para confirmar la captura | ✅ (falta revisar con sesión iniciada: B2) |
| H6 | ⚪ | Pruebas | La prueba de emulador "pago en línea" falló 3 veces seguidas por `deadline-exceeded` ("Failed to load function" al recargar funciones) y luego pasó 3 veces sin cambios de código | Salida de `npm test` | ⬜ Intermitente del emulador; vigilar |

## B2 — Flujos de punta a punta en el entorno local (2026-10-07)

Recorridos con la interfaz real de cada panel sobre emuladores (`scripts/entorno-local.mjs`):

| Flujo | Resultado |
|---|---|
| 1. Domicilio en efectivo: tienda → caja confirma, asigna domi y 30 min → cocina listo → domiciliario recoge, entrega, propina $2.000 → caja cobra efectivo → cierre de turno ($93.000 esperado = entregado, propina aparte) → cliente ve "Pedido completado" | ✅ |
| 2. Recoger en tienda (nota por plato "sin hielo", sin envío) | ✅ |
| Pedido programado (+2 h) | ✅ tras H8 |
| 4. Mesa: mesero → cocina → servido → **ronda 2 en el mismo pedido** (no ticket nuevo) → caja cobra tarjeta → mesa libre. Primera prueba de punta a punta del flujo de mesas con reglas cerradas | ✅ |
| 4b. QR de mesa: comensal pide → solicitud → mesero la ve "Pedido del cliente"; al confirmar, precios de la carta del mesero (no del celular) | ✅ |
| 6. Trabajador sin rol admin no entra a panel-admin | ✅ |
| Reportes: resumen del día = $181.000 (efectivo 93.000 / tarjeta 88.000), canales mesa/domicilio correctos; `scripts/test-reportes.js` TODO OK | ✅ |
| 5. Casos límite (cerrado, pausado, agotado, precio cambiado, bloqueado, cancelación) | ✅ cubiertos por las 19 pruebas de emulador |

| # | Sev | Superficie | Hallazgo | Estado |
|---|---|---|---|---|
| H7 | 🟡 | Tienda | Si la función tarda o falla, el cliente veía el error técnico crudo `deadline-exceeded` (inglés) | ✅ `mensajeDeError()` traduce errores genéricos de funciones y de permisos a "No se pudo enviar el pedido. Intenta de nuevo en un momento." (ES/EN); los mensajes del servidor se siguen mostrando |
| H8 | 🟠 | Caja, cocina | La hora de un pedido **programado** no se veía en caja (donde ahora se confirma) ni en cocina: un pedido para las 8 p. m. confirmado a las 3 p. m. se cocinaba de una | ✅ Caja: "Programado para las HH:MM"; cocina: "para las HH:MM" en el ticket |
| H9 | 🟡 | Caja | La tarjeta de domicilio no mostraba la **referencia** de la dirección | ✅ "Dirección · referencia" |
| H10 | 🟡 | Caja | El chip "Estimado N min" se ocultaba si el pedido ya estaba pagado → con pago en línea nunca se vería | ✅ se muestra hasta entregar/cancelar |
| H11 | ⚪ | Cocina | En tickets de mesa, "Cliente" repetía el nombre del mesero | ✅ muestra "—" si no hay nombre del comensal |
| H12 | ⚪ | QR mesa | Sin `&nombre=` en el QR se veía el id "mesa-7" (y así llegaba al mesero) | ✅ se muestra "Mesa 7". Al regenerar los QR (PLAN-MAESTRO 4.5) incluir `&nombre=` |
| H6 | ⚪ | Pruebas / entorno local | Causa encontrada: el emulador corta a los 30 s el arranque de procesos de funciones; con ráfagas de triggers en Windows algunos tardan más | ✅ `FUNCTIONS_DISCOVERY_TIMEOUT=90` en `functions/scripts/pruebas-emulador.cjs` (npm test) y en `entorno-local.mjs`. 15 + 19 pasan estables |
| H13 | ⚪ | Caja, mesero | Usan `alert()`/`confirm()`/`prompt()` nativos (la tienda ya tiene diálogos propios) | ⬜ cosmético |
| H14 | ⚪ | Caja | En la cuenta de una mesa con varias rondas, el mismo plato aparece en líneas separadas ("1× Sopa" dos veces) | ⬜ cosmético |
| H15 | ⚪ | Tienda | Avatar vacío (círculo sin foto) si la cuenta no tiene foto | ⬜ |
| H16 | ⚪ | Datos | `outOfStock` en producción tiene 5 marcas de ids viejos (`alitas-bbq`, `gaseosa`…) que ya no existen | ⬜ limpieza |
| H17 | ⚪ | Reportes | Cuando se active la pasarela, `metodoPago: en_linea` caerá en "otro" en `resumenVentas` | ⬜ al activar pago en línea |
| H18 | 👤 | Configuración | El horario del miércoles en producción abre a las **02:00** (¿valor de prueba?) | 👤 revisar en admin → Horario |

| H19 | 🟠 | Tienda | Al arrancar se dibujaba el menú "de fábrica" de `js/data.js` (categorías y precios viejos, "Lo más pedido" con Picanha $38.000 / Alitas BBQ sin foto) hasta que llegaba el de Firebase: con señal lenta el cliente lo veía varios segundos y podía agregar productos inexistentes | ✅ 2026-10-08: arranca con el último menú REAL guardado en el celular (`rodizio_catalogo_v1`); primera visita → tarjetas "cargando". Probado en tiempo real (Edge + CDP): sin Firebase 1ª visita = cargando; con Firebase = 13 cat/109 prod y se guarda; 2ª visita sin Firebase = 13 categorías reales |
| H20 | 🟡 | Tienda (PC) | En PC las tarjetas de categoría crecían sin límite (4 columnas cuadradas: ~450 px cada una a 1920, la destacada ~900 px) | ✅ 2026-10-08: columnas automáticas de ~230 px (5 en portátil, 7-8 en monitor) y tarjetas 4:3 desde 720 px. Sin tope de ancho del shell (decisión previa del dueño). A 1366 px se ven las 13 categorías en una pantalla |
| — | — | Marca | Ícono sin fondo rojo (círculo crema a borde, farol +22 %) y farol del logo +15 % (`scripts/generar-iconos.py`, `scripts/logo-farol-grande.py`) | ✅ desplegado en tienda y 5 paneles |

Pendiente de B2: probar en celular real (la ventana del navegador de pruebas no se dejó achicar) → bloque B4.

## Seguridad / datos personales

| # | Sev | Hallazgo | Evidencia | Estado |
|---|---|---|---|---|
| S1 | 🟠 | Dos exportaciones completas de la base de datos están en git (`docs-fusion/rodiziomarketplace-default-rtdb-export.json`, `docs-fusion/rodizio-eb49a-default-rtdb-export.json`) con **96 correos, 27 teléfonos**, pedidos, direcciones y consentimientos. Subidas a GitHub en el commit `92d58f3` (ramas `main` y `fusion`). El repo es **privado** (GitHub responde 404 sin autenticación) | `git ls-files`, conteo con script | ✅ 2026-10-07: historial reescrito con `git filter-repo` (los 2 exports fuera de todos los commits; 2 correos personales de `DIAGNOSTICO-FUSION.md` → `[correo]`) y push forzado de `fusion` (`a7fe346`) y `main` (`b11a0cb`). Exports movidos a `../respaldos-rtdb/`; regla `*-rtdb-export.json` en `.gitignore`. Respaldo del historial viejo: `../respaldos-privados/historial-git-antes-limpieza-2026-10-07.bundle`. 👤 Falta: pedir a GitHub Support la purga (9 PR refs conservan los commits viejos) y re-clonar en cualquier otro PC |
| S2 | 🟠 | Firebase Analytics se inicia sin consentimiento de cookies | `tienda/js/firebase-config.js:120` | ⬜ Parte A2 del plan |
| S3 | — | Archivos internos (`server.js`, `test-pasarela*`, `README.md`, `CLAUDE.md`) no se sirven en producción | 404 verificado | ✅ |
