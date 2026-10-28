# Plan de seguridad, datos personales y auditoría completa del sistema

Creado 2026-10-07. Dos planes en un documento:

- **Parte A — Seguridad web y protección de datos personales** (marketplace
  `rodiziocucuta.com` + paneles).
- **Parte B — Auditoría completa del sistema** (flujos, consola, diseño en
  celular, código muerto, optimización) **sin romper lógica**.

Cada punto tiene un estado: ✅ ya está · 🟡 parcial · ⬜ falta · 👤 lo decide o
lo hace el dueño. Lo legal se basa en la norma colombiana. **No reemplaza la
revisión de un abogado**: los textos finales de las políticas los debe validar
uno.

---

## Parte A — Seguridad y datos personales

### A0. Inventario de datos personales (base de todo lo demás)

Antes de escribir políticas hay que tener claro qué se guarda, dónde, quién lo
ve y por cuánto tiempo. Lo que hoy se sabe:

| Dato | Titular | Dónde vive | Quién lo lee | Para qué |
|---|---|---|---|---|
| Nombre, correo y foto de Google | Cliente | Firebase Auth, `orders/*` | Cliente, caja, admin, domiciliario asignado | Identificar el pedido |
| Teléfono | Cliente | `orders/*`, `localStorage` del celular | Caja, admin, domiciliario | Contactar por la entrega |
| Direcciones (y guardadas) | Cliente | `orders/*`, `users/{uid}/addresses` | Caja, admin, domiciliario | Entregar |
| Ubicación GPS del cliente (opcional) | Cliente | `orders/*/customerLocation` | Caja, domiciliario | Ubicación exacta |
| Historial de pedidos | Cliente | `orders/*` | Cliente (los suyos), personal | Seguimiento, reportes |
| Tokens de notificaciones (FCM) | Cliente / domiciliario | `users/*/fcmTokens`, `drivers/*/fcmTokens` | Solo Cloud Functions | Avisos push |
| Datos de pago en línea | Cliente | **No se guardan**: los maneja AAvance. Solo el número de orden y el id de transacción | Caja, admin | Confirmar pago |
| Posición GPS en vivo del domiciliario | Domiciliario | `orders/*` mientras entrega | Cliente del pedido, caja | Rastreo |
| Correo y datos del personal | Trabajadores | Auth, `trabajadores/*`, `drivers/*`, `admins/*` | Dueño | Acceso a paneles |
| Bloqueos de clientes | Cliente | `customerFlags/*` | Admin | Evitar fraude |
| Registros de error | Cualquiera | `errorLogs/*` | Admin | Depurar |
| Analítica | Visitante | Google Analytics (cookies `_ga`) | Dueño | Métricas |

- [ ] A0.1 Confirmar este inventario contra el código y la base real (es el
      primer paso de la auditoría de la Parte B).
- [x] A0.2 Revisar que `errorLogs` no guarde datos personales (correos,
      teléfonos, direcciones dentro de mensajes de error o URLs).
      Revisado 2026-10-13: los 10 registros de producción no tenían datos personales; `errors.js` ahora guarda la URL sin `?query`/`#hash` y las reglas solo aceptan sus campos, con tope.
- [ ] A0.3 Definir **retención**, por ejemplo: pedidos 5 años (soporte
      contable), GPS del domiciliario borrado al entregar, `errorLogs`
      90 días, `pagosPendientes` no pagados 30 días. 👤 decisión.

### A1. Cumplimiento legal (Colombia)

Normas: **Ley 1581 de 2012** (protección de datos personales), **Decreto 1377
de 2013** (compilado en el Decreto 1074 de 2015), **Ley 1480 de 2011**
(Estatuto del Consumidor: comercio electrónico) y la **SIC** como autoridad.

| # | Requisito | Estado | Acción |
|---|---|---|---|
| A1.1 | **Política de Tratamiento de Datos** publicada (obligatoria). Debe incluir: responsable (razón social, NIT, dirección, correo, teléfono), finalidades, derechos del titular, procedimiento de consultas y reclamos, área responsable y fecha de vigencia | 🟡 `privacidad.html` existe con 3 secciones (cliente, panel, domiciliario) pero hay que comprobar que cubra todos estos puntos | Completar con los datos de la empresa 👤 y revisar con abogado |
| A1.2 | **Autorización previa, expresa e informada** antes de recoger datos | 🟡 Hay casilla de consentimiento antes del login con Google | Verificar que enlace a la política, que quede registro de la fecha y la versión aceptada, y que no esté premarcada |
| A1.3 | Autorización especial para la **geolocalización** (dato sensible por contexto) | ⬜ | Pedir el GPS solo al tocar "usar mi ubicación", con texto que explique para qué |
| A1.4 | **Derechos del titular**: conocer, actualizar, rectificar y suprimir los datos, y revocar la autorización | 🟡 Hay perfil y direcciones editables | Agregar "Eliminar mi cuenta y mis datos" y un correo de contacto para reclamos. Plazos legales: 10 días hábiles para consultas y 15 para reclamos |
| A1.5 | **Aviso de privacidad** corto en los puntos de captura (checkout, login, registro de personal) | ⬜ | Una línea con enlace a la política |
| A1.6 | **Registro Nacional de Bases de Datos (RNBD)** ante la SIC | 👤 | Solo obligatorio para sociedades con activos mayores a 100.000 UVT. Confirmar con el contador si aplica |
| A1.7 | **Transferencia internacional**: los datos viven en servidores de Google (EE. UU.) | ⬜ | Mencionarlo en la política (Google figura como encargado) |
| A1.8 | **Términos y condiciones** de venta: precios, domicilio, cancelaciones, devoluciones y reembolsos del pago en línea, derecho de retracto (no aplica a comida perecedera; decirlo) | ⬜ | Crear `terminos.html` y enlazarlo en el checkout y el pie de página |
| A1.9 | Datos del comercio visibles (razón social, NIT, dirección, contacto): Estatuto del Consumidor para comercio electrónico | ⬜ | Pie de página del marketplace 👤 datos |
| A1.10 | Protocolo de **incidentes de seguridad**: avisar a la SIC y a los afectados si hay una fuga | ⬜ | Documento corto: quién detecta, quién decide, a quién se avisa y cómo |

### A2. Cookies y almacenamiento en el navegador

Hoy el marketplace carga **Firebase Analytics sin pedir permiso**, y eso deja
cookies de Google Analytics (`_ga`, `_ga_*`). Además usa `localStorage` para
cosas propias del funcionamiento (carrito, teléfono, consentimiento, idioma,
pago pendiente).

| # | Acción | Estado |
|---|---|---|
| A2.1 | Inventario de cookies y almacenamiento (nombre, propósito, duración, propio o de terceros) | ⬜ |
| A2.2 | **Banner de cookies**: "Aceptar", "Rechazar" (igual de visible) y "Configurar". Las necesarias siempre activas; la analítica solo si se acepta | ✅ 2026-10-13 (sin "Configurar": hay una sola categoría opcional; se cambia desde `privacidad.html#cliente`) · desplegado 2026-10-13 |
| A2.3 | Cargar Analytics **solo después** de aceptar (hoy `firebase-config.js` lo inicia siempre). Opción liviana: Consent Mode de Google (`analytics_storage: denied` por defecto) | ✅ 2026-10-13 (`js/cookies.js`) · desplegado 2026-10-13 |
| A2.4 | **Política de cookies** (sección en `privacidad.html` o `cookies.html`), con un enlace para cambiar la decisión después | ⬜ |
| A2.5 | Paneles internos (caja, cocina, admin, mesero, domiciliario): solo almacenamiento necesario. Confirmar que no carguen Analytics | ✅ 2026-10-13: admin.html y driver.html ya no cargan Analytics · desplegado 2026-10-13 |

### A3. Seguridad web (aplicación)

Ya hecho en rondas anteriores (no rehacer, solo verificar):

- ✅ Pedidos creados **solo** por Cloud Function con precios del servidor
  (`crearPedido`); el navegador no escribe en `orders`.
- ✅ Pago en línea verificado en servidor (estado aprobado + monto exacto);
  ApiKey en Secret Manager.
- ✅ Reglas de base de datos sin `.read`/`.write: true` en la raíz; pruebas de
  reglas en el emulador (19).
- ✅ `escapeHtml()` en todo texto libre que va a `innerHTML`.
- ✅ Mensajes de login que no revelan si un correo existe.
- ✅ Encabezados HSTS, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy` en todos los sitios.
- ✅ `.git` y archivos internos (`server.js`, `test-pasarela*`, `CLAUDE.md`)
  dan 404 en producción. Verificado 2026-10-07.
- ✅ Storage: `menu/**` solo lectura; el resto denegado.

Pendiente:

| # | Acción | Prioridad | Estado |
|---|---|---|---|
| A3.1 | **Content-Security-Policy**: empezar en modo `Report-Only`, recoger violaciones una semana, después aplicar. Permitir solo gstatic, googleapis, firebase, Storage, Google Fonts, Nominatim, AAvance (form-action) y lo que use ExcelJS | Alta | 🟡 2026-10-13: política en modo Report-Only en los 3 sitios de la tienda + función `reporteCsp` (logs "CSP"); quitados los 3 `onclick` en línea · desplegado 2026-10-13. Falta: revisar reportes ~1 semana y aplicarla |
| A3.2 | `X-Content-Type-Options: nosniff` en todos los sitios | Alta | ✅ ya estaba en los 8 sitios |
| A3.3 | `frame-ancestors 'none'` (vía CSP) en vez de solo `X-Frame-Options` | Media | ⬜ |
| A3.4 | **App Check** (reCAPTCHA Enterprise) en `crearPedido`/`crearPagoEnLinea`, para frenar bots que creen pedidos o pagos falsos. Se quitó antes a pedido del usuario: 👤 decidir de nuevo, ahora que hay pagos | Media | 🟡 2026-10-13: clave reCAPTCHA Enterprise "Tienda Rodizio App Check" creada (4 dominios), app registrada en App Check, tienda la envía (verificado: intercambio 200 en rodiziocucuta.com). **Sin exigir todavía**; nada aplicado en la consola (RTDB/Auth/Storage siguen "No se aplica"). Falta: ver "app":"VALID" en logs de crearPedido y luego `enforceAppCheck` en crearPedido/crearPagoEnLinea/verificarPagoEnLinea |
| A3.5 | Límite de frecuencia por usuario en `crearPedido`/`crearPagoEnLinea` (ej. máximo N por minuto) | Media | ✅ 2026-10-13: 10 intentos por cliente cada 10 min, sumando ambas funciones (`limitePedidos/{uid}`) · desplegado 2026-10-13 |
| A3.6 | Revisar cada nodo de `database.rules.json` con la pregunta "¿quién puede leer los datos de otro?" (ver A0) | Alta | 🟡 2026-10-13: cerrados `trabajadores`, `solicitudes`, `contadores`, `errorLogs`, `cashSettlements` (ver bitácora) · desplegado 2026-10-13 |
| A3.7 | Contraseñas del personal: largo mínimo, cambio inicial, cuentas de ex-empleados desactivadas (proceso de baja) | Media | 👤 + ⬜ |
| A3.8 | 2FA para las cuentas Google/Firebase del dueño y de quien tenga acceso a la consola | Alta | 👤 |
| A3.9 | Restringir la API key web de Firebase a los dominios propios (Google Cloud → Credenciales → restricciones HTTP) | Media | ⬜ |
| A3.10 | `npm audit` en `tienda/functions` y actualizar dependencias con avisos | Media | ⬜ |
| A3.11 | Respaldo automático de la base de datos (exportación programada) y una prueba de restauración | Alta | ⬜ |
| A3.12 | Alertas de presupuesto en Google Cloud (Blaze) para detectar abuso o costos raros | Alta | 👤 |
| A3.13 | Limpiar las imágenes de compilación de funciones en GCR (aviso de costo pendiente) | Baja | 👤 |
| A3.14 | Webhook de AAvance registrado y la pasarela reactivada (ver `PLAN-PASARELA-PAGO.md`) | — | 👤 |

### A4. Orden sugerido (Parte A)

1. A0 inventario y A3.6 reglas: saber qué protegemos.
2. A2 cookies (banner + Analytics con consentimiento): es lo más visible y lo
   que hoy incumple.
3. A1.1–A1.5, A1.8, A1.9: políticas, términos y datos del comercio
   (👤 datos de la empresa + abogado).
4. A3.1–A3.3 encabezados y CSP.
5. A3.4–A3.5 anti-abuso, A3.11 respaldos, A3.12 alertas.

---

## Parte B — Auditoría completa del sistema

### B0. Reglas de la auditoría (para no romper lógica)

- **Primero se documenta, después se corrige.** La auditoría produce una
  lista de hallazgos (`AUDITORIA-HALLAZGOS.md`) con prioridad. Ninguna
  corrección se hace a ciegas.
- **Red de seguridad antes de tocar**: `cd tienda/functions && npm test` (15
  unitarias + 19 emulador) debe pasar antes y después de cada corrección. Si
  un flujo crítico no tiene prueba, se escribe la prueba primero.
- Lógica de negocio solo en `tienda/js/reglas-pedido.js` (+ `npm run sync`).
  Nunca duplicarla.
- Un cambio por vez, probado en el entorno local (`scripts/entorno-local.mjs`
  con emuladores) y en el canal de vista previa antes de producción.
- Subir `CACHE_NAME` del service worker de cada panel que se toque.
- Respetar las decisiones registradas en `tienda/CLAUDE.md` (funciones
  quitadas a propósito no se "arreglan" volviéndolas a poner).

### B1. Alcance: superficies a auditar

| Superficie | Sitio | Usuarios |
|---|---|---|
| Marketplace | `rodiziocucuta.com` / `rodiziomarketplace.web.app` | Clientes (celular) |
| Admin domicilios | `rodizio-admin-domicilios` | Dueño, cajero |
| App domiciliario | `rodizio-driver` | Domiciliarios (celular) |
| Mesero | `rodizio-mesero` | Meseros (celular/tablet) |
| Cocina | `rodizio-cocina` | Cocina (tablet/TV) |
| Caja | `rodizio-caja` | Cajero (PC/tablet) |
| Admin restaurante + reportes | `rodizio-admin` | Dueño |
| QR cliente (mesa) | `rodizio-cliente` | Clientes en mesa (celular) |
| Cloud Functions | us-central1 / us-east1 | — |
| Reglas RTDB y Storage | — | — |

### B2. Flujos de punta a punta (con datos de prueba en emulador)

Cada flujo se recorre completo, cruzando paneles, y se anota cualquier
diferencia con lo esperado:

1. **Domicilio en efectivo**: cliente arma carrito → checkout → `crearPedido`
   → caja confirma → cocina prepara → listo → admin asigna domiciliario →
   push al domiciliario → en camino → entregado → caja cobra → cierre de turno
   del domiciliario → aparece en reportes.
2. **Recoger en tienda**, igual sin domiciliario.
3. **Pago en línea** (cuando AAvance esté activo): pagosPendientes → aprobado
   → entra a caja pagado → domiciliario "no cobrar" → no suma al efectivo.
   Ramas: rechazado, abandonado, monto distinto.
4. **Mesa**: mesero abre mesa → pedido → rondas → cocina → caja cobra →
   mesa libre. QR cliente: ve menú, pide/llama.
5. **Casos límite**: tienda cerrada, domicilios pausados, fuera de zona,
   debajo del mínimo, producto agotado durante el checkout, precio cambiado
   con carrito viejo, cliente bloqueado, cancelación del cliente dentro y
   fuera de la ventana, sin conexión y reconexión, dos pestañas abiertas,
   sesión vencida.
6. **Personal**: login, roles (dueño/cajero/trabajador), acceso denegado a lo
   que no corresponde, alta y baja de domiciliario.
7. **Horario**: horario semanal automático, botón "detener", reabrir.
8. **Notificaciones push**: permiso, recepción, token inválido.

### B3. Consola y red

- [ ] Recorrer cada panel con DevTools abierto: **cero errores** en consola
      y ninguna advertencia propia sin explicación.
- [ ] Peticiones fallidas (404/403/500) en la pestaña Red, incluidas
      imágenes de Storage e íconos.
- [ ] `onValue` sin `logOnValueError`, promesas sin `catch`.
- [ ] Revisar `errorLogs` de producción: agrupar errores reales que ya
      ocurrieron y priorizarlos.
- [ ] Logs de Cloud Functions (errores, timeouts, arranques en frío).

### B4. Diseño y celular

- [ ] Cada pantalla de cada panel en **360, 390, 414 px** (celular), **768**
      (tablet) y **1366** (PC), en vertical y horizontal.
- [ ] Nada se desborda horizontalmente; textos largos (nombres de platos,
      direcciones, inglés) no rompen tarjetas ni botones.
- [ ] Modales, hojas inferiores y teclado del celular: el botón principal
      sigue visible al escribir.
- [ ] Zonas táctiles de al menos 44 px; contraste legible (WCAG AA), modo
      oscuro donde exista.
- [ ] Estados vacíos, cargando y error en cada lista.
- [ ] Bilingüe (ES/EN): ninguna clave cruda visible (pasó con `pagoEnLinea`).
- [ ] iOS Safari y Android Chrome reales: zoom bloqueado, safe areas, PWA
      instalada.

### B5. Código muerto y limpieza

- [ ] Funciones, exportaciones, clases CSS y claves i18n sin uso
      (búsqueda por símbolo + Coverage de Chrome DevTools en cada flujo).
- [ ] Archivos huérfanos: scripts de prueba viejos, `icons/menu/**` local
      (las fotos ya están en Storage), borradores de pasarela retirados.
- [ ] Duplicados entre `shared/` y `tienda/js/` (formato de precio, fechas,
      escape HTML).
- [ ] Comentarios desactualizados ("cuando se pague Blaze", "sandbox", etc.).
- Regla: **se propone la lista y el usuario aprueba** antes de borrar.

### B6. Optimización

- [ ] Lighthouse (móvil) en marketplace, QR cliente y app domiciliario:
      meta ≥ 90 en Rendimiento, Accesibilidad, Buenas prácticas y SEO.
- [ ] Peso de la primera carga: JS/CSS no usados, fuentes (subset/`display:
      swap`), imágenes con tamaños correctos y `loading="lazy"`.
- [ ] Service workers: qué se precachea, que no sirvan versiones viejas.
- [ ] Lecturas de RTDB: escuchar solo lo necesario (consultas por query,
      `limitToLast`) para bajar costo y datos móviles.
- [ ] Cloud Functions: `maxInstances`, memoria, región, arranques en frío del
      checkout.
- [ ] SEO del marketplace con el dominio nuevo: `og:url`, `og:image` (hoy
      apunta a una imagen borrada), `canonical`, `sitemap.xml`, `robots.txt`.

### B7. Entregables

1. `docs-fusion/AUDITORIA-HALLAZGOS.md`: tabla con superficie, hallazgo,
   evidencia (captura o error), severidad (crítico/alto/medio/bajo) y
   propuesta.
2. Correcciones en lotes pequeños por prioridad, cada lote con pruebas
   verdes, desplegado primero al canal de vista previa y después a
   producción.
3. Pruebas nuevas para cada bug crítico encontrado (que no vuelva).
4. Actualización de `PLAN-MAESTRO.md` y de este documento.

### B8. Orden sugerido (Parte B)

1. B3 consola + `errorLogs` reales: bugs que ya les pasan a usuarios.
2. B2 flujos 1, 2 y 5 (dinero y pedidos).
3. B4 celular del marketplace, el domiciliario y el QR.
4. Resto de flujos y paneles.
5. B6 optimización y B5 limpieza, al final, cuando todo lo anterior esté
   estable.

---

## Lo que necesito del dueño (👤)

- Razón social, NIT, dirección, correo y teléfono de contacto para las
  políticas y el pie de página.
- Correo o área que atiende reclamos de datos personales.
- Política de devoluciones y reembolsos del pago en línea.
- Retención de datos (A0.3).
- ¿Reactivar App Check? (A3.4).
- ¿Aplica el RNBD? (A1.6, preguntarle al contador).
- Activar 2FA en las cuentas con acceso a la consola y alertas de presupuesto.

## Bitácora

| Fecha | Qué pasó |
|---|---|
| 2026-10-07 | Se crea el plan. Hallazgo inicial: Firebase Analytics carga sin consentimiento de cookies; no hay CSP ni `nosniff`; archivos internos verificados en 404. |
| 2026-10-13 | A2.2/A2.3/A2.5: aviso de cookies; Analytics solo con "Aceptar" y solo en la app de clientes. A3.6, reglas: `trabajadores` ya no lo lee cualquier cliente con login (solo admin la lista, cada uno su perfil); `solicitudes` completa solo para el personal, cada mesa sigue pública pero con forma y tamaño acotados (productos de `productsMesa`, qty 1–99, sin campos extra); `contadores` solo personal; `errorLogs` solo los campos de `errors.js`; `cashSettlements` exige domiciliario con acceso. 7 pruebas nuevas en el emulador. Probado en local con navegador y **desplegado el mismo día** (reglas, rodizio-cliente y los 3 sitios de la tienda). `privacidad.html#cliente` actualizada con el pago en línea. |
| 2026-10-13 | A3.1: CSP en modo solo reportar (`tienda/firebase.json`) con reportes a la función `reporteCsp`; los botones "Recargar" ya no usan `onclick`. A3.5: límite de 10 intentos por cliente cada 10 minutos en `crearPedido`/`crearPagoEnLinea` (`resource-exhausted`, mensaje visible en el checkout). 1 prueba nueva (41/41). Documento de datos para el negocio creado en Claude Docs. **Desplegado el mismo día** (funciones + 3 sitios); `reporteCsp` verificado. |
| 2026-10-13 | A3.4: App Check conectado en modo solo enviar (reCAPTCHA Enterprise, clave pública en `js/firebase-config.js`, solo app de clientes, no en local); CSP permite reCAPTCHA; SW v147. Desplegado. |
| 2026-10-13 | Licor (Ley 124/1994 y Ley 30/1986, a validar por abogado): la tienda vende 25 productos con alcohol. `esAlcohol()` en `js/reglas-pedido.js` (categorías `cervezas-3-cordilleras`, `cocteles` y subGroup `cervezas`); el checkout pide "Confirmo que soy mayor de 18 años" con la leyenda legal, el servidor exige `mayorDeEdad` y lo guarda en el pedido; leyenda en el detalle del producto. Probado en local y desplegado (funciones + 3 sitios, SW v148). |
