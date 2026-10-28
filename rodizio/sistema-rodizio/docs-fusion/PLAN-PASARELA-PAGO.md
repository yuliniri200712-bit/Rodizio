<!-- Rodizio Cucuta - ParaTouch (DJG . djgv . Mxi . 0808 . 0724 . uwu) -->
# Plan — Pasarela de pago

**Estado:** 🟢 mecanismo de pago y de confirmación **probados y funcionando**.
Bloqueado para cobrar de verdad por dos cosas, ninguna de código: el plan
Blaze de Firebase sin pagar (sección 5b) y el botón de pago en modo producción
en vez de prueba (sección 4b).
**Última actualización:** 2026-09-22

> Este documento vive en `docs-fusion/` y se sube a GitHub como el resto del
> repo. **Nunca escribas aquí una llave, token o contraseña real** — ni de
> prueba/sandbox. Los valores reales van en `tienda/functions/.env` (archivo
> local, ignorado por git — ver `.gitignore`). Este documento solo nombra
> qué variables existen, nunca sus valores.

## 1. Por qué

Hoy el pedido del marketplace se confirma **sin cobro dentro de la app**
(efectivo contra-entrega, o transferencia coordinada aparte y marcada a mano
en `panel-caja`). El usuario quiere conectar una pasarela de pago para que el
cliente pueda pagar en línea al hacer el pedido.

## 2. Bloqueante de seguridad — resolver ANTES de aceptar el primer pago real

Ya identificado y documentado en `tienda/CLAUDE.md` (sección "Seguridad —
reglas que no se deben romper"): `placeOrder()` (`tienda/js/auth.js`) guarda
`subtotal`/`shipping`/`total` **tal como los manda el navegador del cliente**,
sin que nada en el servidor los valide contra los precios reales de
`products`/`productsMesa`. Mientras el pago era contra-entrega esto era un
riesgo menor (el cajero ve el total raro al cobrar) — **en cuanto haya un
botón que de verdad mueva dinero, alguien con las herramientas de
desarrollador del navegador podría editar el total antes de pagar**.

La forma correcta: el monto que se le pide cobrar a la pasarela lo calcula un
backend de confianza (Cloud Function callable) recalculando desde los precios
reales en RTDB — nunca el número que manda el navegador. Esto es parte
obligatoria del plan de integración, no una mejora opcional.

## 3. Proveedor

**Confirmado 2026-09-21: PayWay, de Coopcentral**, dentro de su servicio
**"AAvance"** para comercios (de ahí el subdominio del panel/endpoint,
`merchantaavance.coopcentral.com.co`).
No es Wompi/PayU/Mercado Pago como asumían los documentos viejos del
proyecto — es un modelo distinto, más parecido a un "botón de pago" clásico
de banco:

- **No hay API/SDK ni JSON.** El comercio arma un `<form method="post"
  action="https://merchantaavance.coopcentral.com.co/cartaspago/redirect">`
  con campos ocultos (`merchant_id`, `form_id`, `terminal_id`, `order_number`,
  `amount`, datos del cliente, etc.) y lo envía — eso **redirige el navegador
  del cliente** a una página de pago alojada por PayWay (ahí elige PSE o
  tarjeta). Terminado el pago, PayWay redirige de vuelta a `response_url`.
- El botón de prueba inicialmente configurado (`form_id`) era de tipo **"abierto"**
  (`type_method: 2`). Sin embargo, gracias a la nueva documentación proporcionada
  por el usuario (2026-09-21), confirmamos que **sí existe un botón de "monto fijo"**.
  Para usarlo, simplemente se omite el campo `type_method` (y los de montos sugeridos/mínimos)
  y se envía directamente el campo `amount` con el valor total a cobrar. Esto es
  perfecto para nuestro caso de e-commerce.
- Los identificadores de prueba ya están guardados en
  `tienda/functions/.env` (`PASARELA_MERCHANT_ID`, `PASARELA_FORM_ID`,
  `PASARELA_TERMINAL_ID`) — van embebidos en un formulario que se sirve al
  navegador (PayWay los diseñó así), así que no son secretos como una llave
  privada, pero igual viven en el `.env`, no hardcodeados en el código.

- [x] Confirmar si existe un botón/modo de "monto fijo" más apropiado para
      checkout de e-commerce que el "abierto" ya configurado. (Resuelto: Sí,
      usando el formulario estándar sin `type_method`).
- [x] ~~Confirmar si ya hay cuenta de comercio en producción o si esto sigue
      siendo 100% sandbox.~~ Resuelto en sección 4b: no existe sandbox, todo
      corre contra la red real.

### Decisión 2026-09-23: botón de pago (formulario) en vez de link de pago

AAvance ofrece dos mecanismos posibles:

| | **Botón de pago** (el que ya usamos) | **Link de pago** (`POST link-de-pago/create`) |
|---|---|---|
| Cómo se arma | `<form>` que el navegador del cliente manda directo a AAvance, con `amount` en un campo oculto | Una llamada server-to-server (Cloud Function + `ApiKey`) que crea el link con el monto ya fijado del lado de AAvance |
| ¿El monto es alterable? | Sí, en teoría — viaja por el navegador. `merchant_id`/`form_id` no son secretos, así que hasta se podría armar un formulario propio | No — el cliente solo recibe una URL, no puede tocar el monto |
| ¿Necesita Cloud Function? | No para el pago en sí (sí para el checkout seguro, ver sección 2) | Sí, obligatorio |
| ¿Documentación disponible? | Sí, ya probado y funcionando | No, solo se conoce el nombre del endpoint |

**Decisión: seguimos con el botón de pago.** Es más simple, ya está probado
de punta a punta, y no depende de investigar un endpoint sin documentar. La
diferencia de seguridad se cierra igual sin necesidad del link de pago: la
Cloud Function que confirme un pago (sección 6, punto 2) **tiene que
comparar el `amount` que devuelve la consulta/webhook contra el total real
del pedido en Firebase — no alcanza con revisar solo si `idstatus` da
aprobado.** Si algún día el volumen de fraude lo justifica, el link de pago
queda como mejora futura, pidiendo su documentación a soporte.

## 4. ⚠️ PENDIENTE CRÍTICO — cómo se confirma un pago del lado del servidor

La documentación compartida hasta ahora **solo explica la redirección inicial y la integración del Widget de Frontend** (cómo enviar al cliente a la página de pago usando `<form>` o el script `widgetCheckout`). 

Como bien notó el usuario (2026-09-21), falta la documentación de la **API REST o de Webhooks** para que el servidor (Firebase Functions) verifique la transacción. Sin esto, **no alcanza para marcar un pedido como pagado** de manera segura. Si solo confiamos en que el usuario regrese a `response_url`, cualquiera podría visitar esa URL a mano y fingir un pago exitoso. De hecho, el Widget incluso expone el `ApiKey` en el Javascript, lo que corrobora que estos métodos documentados son puramente herramientas de cliente y no garantizan seguridad sin validación trasera.

**CONFIRMADO EMPÍRICAMENTE (2026-09-22): `response_url` no trae NINGÚN dato.**
Se probó dos veces en sandbox (transacciones `28438829` y `28439891`, ambas
"Transacción Fallida" en la pantalla de PayWay) y en los dos casos, al volver
al comercio, no llegó absolutamente nada — ni parámetros en la URL (probado
primero) ni un POST con cuerpo (se ajustó `tienda/server.js` para capturarlo
y confirmar; sigue llegando vacío). **`response_url` es puramente un redirect
de conveniencia para el navegador del cliente, sin ninguna función de
seguridad** — PayWay claramente sí tiene los datos completos de cada
transacción (se ven en su propia pantalla: id, monto, fecha, pagador), pero
no los comparte por ese camino bajo ninguna forma.

Esto cierra la duda: **la única vía posible es una API server-to-server**
usando `PASARELA_API_KEY` para consultar el estado de una transacción por su
`Id transacción` o `external order` — no hay atajo por el lado del
formulario/redirect, ya se descartó por completo.

**Estamos formalmente bloqueados en este punto hasta que AAvance / Coopcentral envíe la documentación sobre esa API de consulta.**

**RESUELTO 2026-09-22 — se leyó el portal de desarrolladores
(`https://developeraavance.coopcentral.com.co/`) y aparecen 22 endpoints.**
Los dos que nos importan:

**A. Consultar estado de una transacción — ✅ PROBADO Y FUNCIONANDO (2026-09-22):**
```
GET https://serviceregisteraavance.coopcentral.com.co/ClientAPI/ObtenerTransaccionByExternalOrder?external_order={external_order}
Header: Authorization: <PASARELA_API_KEY>      ← la llave CRUDA, sin prefijo
```

> ⚠️ **La documentación del portal dice `Api_key` y eso es INCORRECTO.**
> Probado en vivo contra el servidor real:
> | Cabecera enviada | Respuesta |
> |---|---|
> | `Api_key` / `ApiKey` / `x-api-key` | 403 — *"Tu petición no tiene cabecera de autorización"* (ni la mira) |
> | `Authorization: Bearer <llave>` | 403 — *"El api_key enviado no existe"* |
> | `Authorization: Basic <llave>` | 403 — igual |
> | `Authorization: <llave decodificada de base64>` | 403 — igual |
> | **`Authorization: <llave tal cual>`** | **200 + datos completos** ✅ |
>
> No "corregirlo" a `Bearer` más adelante — ya se probó y falla.

Se probó con `tienda/test-pasarela-consulta.js` (script de Node sin
dependencias, lee la llave de `functions/.env`, nunca la imprime). **No
necesita plan Blaze ni Cloud Functions** — corre en el PC:
```
cd tienda
node test-pasarela-consulta.js TEST-1790106268819
```

**Lo que devuelve** (transacción `28438829`, la primera prueba fallida), campos
que importan para la integración:

| Campo | Valor en la prueba | Para qué nos sirve |
|---|---|---|
| `idstatus.id` / `.nombre` | `36` / `"Fallida"` | **El estado real. `34` = aprobada** (según la doc del webhook). Es lo que decide si se marca `pagado`. |
| `externalorder` | `TEST-1790106268819` | Nuestro `order_number` — ata la transacción al pedido. |
| `amount` | `10000` | Monto en COP. **Ojo**: dentro de `jsonresponse.order.amount` viene `1000000`, o sea ×100 (centavos). Para validar contra nuestro total, usar el `amount` de primer nivel. |
| `idform.testmode` | `false` | **Si el botón está en modo prueba o producción — ver sección 4b.** |
| `idform.esabierto` | `false` | Confirma que el botón es de **monto fijo**, no "abierto" (cierra la duda de la sección 3). |
| `paymentmethod.nombre` | `CARD` | Tarjeta / PSE / efectivo. |
| `additionaldata` | `{"message":"","descripcion_pago":"..."}` | Campo libre que viaja de ida y vuelta — **acá podemos meter el id del pedido de Firebase**. |
| `jsonresponse.validation_hash` | (hash) | Posible verificación extra. Sin documentar todavía cómo se recalcula. |
| `jsonresponse.order.paid` | `false` | Confirmación redundante del pago. |

**✅ Y de paso queda resuelto lo del PCI-DSS**: el endpoint respondió 200 con
solo el ApiKey, sin ninguna certificación. El aviso "PCI and DSS certification
required" del portal es genérico de la plantilla, **no aplica a este endpoint
de solo consulta**. Ya no hace falta preguntarle eso a soporte.

**B. Webhook — mejor todavía que consultar a mano:**
AAvance puede **notificar solo** a un endpoint propio (POST) cada vez que
cambia el estado de una transacción — distinto de `response_url` (que ya
sabemos que no sirve). El payload trae `id`, `amount`, `externalorder`,
`idstatus`, `idperson`, `paymentmethod`, `idmerchant`, `additionaldata`.
Reglas: debe responder **200** si la transacción quedó aprobada
(`idstatus: 34`) o **201** para cualquier otro estado, y el endpoint **debe
ser HTTPS** (no aceptan HTTP). Con esto no haría falta ni consultar por
polling — es exactamente el patrón que ya usa
`tienda/functions/index.js` para las notificaciones push (Cloud Function
HTTP que recibe un POST y reacciona).

**RESUELTO 2026-09-22 — el webhook se configura en la TERMINAL, no en el
formulario.** Panel → *Terminales* → la terminal `21827` (la misma de
`PASARELA_TERMINAL_ID`), en
`merchantaavance.coopcentral.com.co/dashboard/terminal/21827/`. Ahí, bajo
"INFORMACIÓN TERMINAL", hay un campo **WEBHOOK** (hoy vacío) junto a otros
interruptores de la terminal:

| Campo | Valor actual | Qué implica |
|---|---|---|
| **WEBHOOK** | *(vacío)* | Acá va la URL HTTPS de nuestra Cloud Function. |
| REPROCESAR ESTADOS | Sí | Reintenta la notificación si falla — nos conviene, dejar en Sí. |
| **ACTIVAR NOTIFICACIONES** | **No** | Muy probablemente es el interruptor que enciende el envío del webhook. Hay que ponerlo en **Sí** al registrar la URL. |
| 3DS | No | Autenticación extra del banco. No tocar por ahora. |
| TOKENIZACIÓN DE TARJETAS | No (deshabilitado) | Guardar tarjetas del cliente. No lo necesitamos ni lo queremos (eso sí es terreno PCI-DSS). |
| RED REDEBAN | No | Red de adquirencia. No tocar. |

- [ ] Cuando exista la Cloud Function, pegar su URL en ese campo **WEBHOOK** y
      poner **ACTIVAR NOTIFICACIONES** en *Sí*. No hacerlo antes: si la URL
      queda puesta sin que exista la función, AAvance reintentaría contra un
      endpoint muerto.

**Ojo con "URL DE RETORNO PREESTABLECIDA"** (panel → *Mi perfil* →
"PARÁMETROS", debajo del APIKEY): ese campo NO es el webhook. Es el
equivalente global de `response_url` — el sitio al que se devuelve al cliente
si el formulario no manda uno. Como ya se comprobó que `response_url` no trae
datos, ese campo es solo comodidad de UX, no sirve para confirmar nada.

**⚠️ Aviso sin confirmar**: la página marca "PCI and DSS certification
required" en casi todos los endpoints, incluido el de solo *consultar*
estado — eso sería raro (consultar no toca datos de tarjeta). Puede ser un
aviso genérico de la plantilla de documentación, no específico de cada
endpoint. **Hay que preguntarle a soporte de AAvance, textual: "¿El endpoint
`ObtenerTransaccionByExternalOrder` (solo consulta, no maneja datos de
tarjeta) también requiere certificación PCI-DSS, o eso aplica solo a los
endpoints que crean transacciones con tarjeta?"** — si de verdad hace falta
certificación hasta para consultar, esto se vuelve un bloqueante real para un
comercio de nuestro tamaño y cambia todo el enfoque (habría que apoyarse
100% en el webhook en vez de la consulta).

- [ ] Solicitar a soporte técnico de AAvance el manual de **"Webhooks de confirmación"** o el **"Manual de Integración API REST"** (específicamente cómo un backend hace una petición POST/GET con el `ApiKey` para validar el estado de un pago).

**Mientras tanto — prueba manual del redirect (2026-09-22):** el usuario solo
tiene el `ApiKey` que ya compartió, no más documentación por ahora, y quiere
probar igual el botón (es sandbox, sin dinero real). Se armó un arnés de
prueba AISLADO del checkout real, para no tocar `app.js`/`auth.js` todavía
(siguen bloqueados por esta misma sección):
- `tienda/test-pasarela.html` — formulario con los datos de prueba
  (`merchant_id`/`form_id`/`terminal_id`, que sí pueden ir en el navegador),
  monto y número de orden editables.
- `tienda/test-pasarela-respuesta.html` — imprime en pantalla TODOS los
  parámetros que PayWay mande de vuelta a `response_url`. Sirve doble
  propósito: confirma que el redirect funciona, Y de paso puede revelar por
  sí sola si `response_url` trae algo verificable (firma/hash/status) — lo
  que resolvería esta sección sin esperar a soporte de AAvance.
- **Cómo probarlo**: `cd tienda && npm start` (o el `.bat` de siempre), abrir
  `http://localhost:8080/test-pasarela.html`, completar y enviar. Ninguna de
  las dos páginas está enlazada desde el sitio real ni se despliega a
  producción — quedan solo en el repo local.

## 4b. Por qué fallaron las 2 transacciones de prueba

Las dos (`28438829` y `28439891`) quedaron "Fallida". Causa más probable: **los
números de tarjeta usados no son los de prueba de AAvance.**

- Los números que sugirió otra IA (`4000 0000 0000 0002` aprobada /
  `4000 0000 0000 0001` rechazada / `5100 0000 0000 0000`) **no aparecen en
  ninguna parte de la documentación de AAvance.** Ese patrón `4000 00…` es el
  esquema de tarjetas de prueba de **Stripe**, una plataforma distinta — casi
  con seguridad la otra IA lo dio de memoria genérica, no leyendo AAvance.
- El único número de ejemplo que SÍ aparece en la documentación real de
  AAvance (`developeraavance.coopcentral.com.co`, ejemplos de
  `CrearTransaccionTC` y de tokenización) es el **Visa universal de pruebas
  `4111 1111 1111 1111`** (exp `06/26`, CVV `123`, titular `PEPITO PEREZ PA`).
- Síntoma que refuerza esto: en el historial del panel, la transacción
  `28438829` quedó registrada con medio de pago **DISCOVER** — o sea, el número
  tecleado ni siquiera se interpretó como Visa.

**✅ CONFIRMADA LA CAUSA DE FONDO (2026-09-22): el botón está en modo
PRODUCCIÓN, no en modo prueba.** La consulta a la API lo dice textualmente:

```
"idform": { "id": "25681", "name": "Sociedad Gastronómica S.A.S.",
            "testmode": false,  ← acá está el problema
            "esabierto": false, "status": true }
```

No existe un "sandbox" aparte en AAvance (ni URL ni credenciales distintas) —
lo que existe es un interruptor **Test / Producción por cada botón de pago**.
Con `testmode: false`, el botón manda las transacciones a la red real
(`CREDIBANCOECOMMERCE`), donde **ninguna tarjeta ficticia va a pasar jamás**.

Eso encaja con el error exacto que devolvió la red:
```
"error": "15 Negada, la institución no está en el IDF"
"brand": "DISCOVER", "country": "US", "bin": 457562
```
El número tecleado se interpretó como una tarjeta **Discover de Estados
Unidos**, y la red la rechazó por no reconocer el banco emisor. No fue un
problema de la integración ni de las credenciales — el formulario, el
`merchant_id`/`form_id`/`terminal_id` y el flujo completo funcionaron bien.

**Tercera prueba (2026-09-22, transacción `28452220` / `TEST-1790120874805`):
también fallida, y esta vez el dato es concluyente.** El usuario dijo haber
puesto el botón en Test, pero la transacción —creada ese mismo momento, así
que refleja el estado actual, no una foto vieja— sigue diciendo
`idform.testmode: false`. La tarjeta usada SÍ fue la correcta
(`bin: 411111`, `last4: 1111`, `06/26`), y el error volvió a ser
`15 Negada, la institución no está en el IDF` — código ISO 8583 15 =
"no existe el banco emisor", justo lo que pasa cuando una tarjeta ficticia
llega a la red real.

**Conclusión: el botón `25681` no está en modo Test.** O el cambio se hizo
sobre otro botón (la documentación original traía `form_id` **28613**), o no
se guardó. El registro del `25681` sigue con `updatedat: null`, o sea nunca
editado desde su creación el 2026-08-13.

*(Curiosidad sin importancia: la pasarela reporta `brand: "DISCOVER"`,
`country: "US"` para el BIN 411111, que es Visa. Su detector de marca falla,
pero no es lo que rechaza el pago.)*

### ❌ Hipótesis descartada: "el problema es que el botón no está en Test"

**Cuarta prueba (2026-09-23, transacción `28452672` / `TEST-1790121537919`),
esta vez con el botón `28613`:**

```
"idform": { "id": "28613", "name": "Checkout PWA - Pruebas",
            "testmode": true, "esabierto": true }
```

Ese botón **sí está en modo Test** — y la transacción falló **idéntica**:
mismo `idstatus: 36` (Fallida), mismo error `15 Negada, la institución no
está en el IDF`, mismo procesador `CREDIBANCOECOMMERCE`.

> ### 🔑 `testmode: true` NO es un simulador de tarjetas
>
> Aunque el botón esté en modo Test, la transacción **igual se enruta a la
> red real de Credibanco**. Por eso ninguna tarjeta ficticia va a funcionar
> nunca — ni la `4111…`, ni ninguna otra: no existe el banco emisor.
>
> Qué significa entonces `testmode` en AAvance: sin confirmar. Puede ser que
> marque el botón como no-productivo, que no liquide fondos, o que sea solo
> una etiqueta administrativa. **No hace lo que uno esperaría de un sandbox.**
>
> **Consecuencia práctica: no se puede conseguir una transacción APROBADA con
> datos inventados.** Hay que lograrla por otro camino (ver abajo).

**Caminos posibles para conseguir un pago aprobado y poder ver el
`idstatus: 34`:**

1. **PSE en vez de tarjeta.** La pasarela ofrece PSE y Efectivo además de
   tarjeta. Los flujos de PSE suelen traer un "banco de pruebas" que permite
   simular la aprobación sin dinero real. **Es la opción más prometedora y la
   que hay que intentar primero** — no cuesta nada probarla.
2. **Preguntarle a soporte de AAvance cuáles son sus tarjetas de prueba
   reales**, si es que las hay. Ya quedó claro que no son las genéricas de la
   industria; tendrían que ser BINs que su adquirente reconozca.
3. **Una tarjeta real, por un monto mínimo.** Último recurso. **Antes hay que
   confirmarle a soporte si con `testmode: true` se cobra de verdad o no** —
   no hacerlo a ciegas.

**Primer intento con PSE (2026-09-23, `28452884` / `TEST-1790121912438`):
falló, pero por un motivo distinto y fácil de corregir:**
```
"returnCode": "FAIL_DISABLEDUSEREMAIL"
"errorDetails": "El email del usuario se encuentra bloqueado para realizar transacciones."
```
El formulario de prueba mandaba `user@example.com` por defecto — **PSE/ACH
tiene vetados los dominios reservados de ejemplo**. Corregido en
`tienda/test-pasarela.html`: ahora exige un correo real.

*(De paso se corrigió otro tropiezo: al volver con el botón "atrás" el
navegador restauraba el `order_number` anterior y PayWay respondía "Ya existe
una transacción con número de orden X". Ahora el número se regenera justo
antes de enviar, no solo al cargar la página.)*

**Segundo intento con PSE (2026-09-23, botón `28613`, correo real) — se
completó todo el flujo hasta el paso 3 ("Selecciona un banco").** La lista
completa de bancos (27 en total) son todos reales: AVVILLAS, Banco Agrario,
Bancolombia, BBVA, Davivienda, Nequi, etc. **Ninguno es un banco de pruebas.**
No se llegó a elegir uno — hacerlo redirige a un login bancario real, así que
se cortó ahí para no arriesgar nada.

**Conclusión: tampoco hay ambiente de pruebas por el lado de PSE.** Con esto
se agotaron los dos métodos de pago disponibles (Tarjeta y PSE) sin encontrar
ningún mecanismo de simulación. Queda descartada la opción 1 de la lista de
caminos de arriba.

**Tercer intento (2026-09-23), lista de bancos más larga (44 entidades,
probablemente con "Persona Jurídica" en vez de "Persona Natural"):** mismo
resultado. Bancolombia, Nequi, Nu, DaviPlata, Movii, RappiPay, Ualá y el resto
— todas entidades reales de PSE Colombia. Ninguna de prueba. **Confirmado por
tercera vez, con dos listas de bancos distintas: no existe un banco de
pruebas en esta cuenta.**
- [ ] Si PSE no da, escribirle a soporte preguntando (a) cuáles son sus
      tarjetas de prueba y (b) qué hace exactamente `testmode`.

### Cuál botón usar en el checkout real

| `form_id` | Nombre | `testmode` | `esabierto` | ¿Sirve para el checkout? |
|---|---|---|---|---|
| `25681` | Sociedad Gastronómica S.A.S. | `false` | `false` (monto fijo) | **Sí** — es el de producción |
| `28613` | Checkout PWA - Pruebas | `true` | `true` (monto abierto) | No — el cliente elegiría cuánto pagar |

El `28613` sirve solo para probar: al ser de **monto abierto**, el cliente
escoge el valor entre un mínimo y un máximo, lo que no tiene sentido para
cobrar el total de un pedido. El de producción sigue siendo el `25681`
(`PASARELA_FORM_ID` en `.env`).

*(Detalle del botón abierto: el ejemplo oficial manda `amount=0`, pero el
servidor lo rechaza con "No se ha suministrado el monto o el monto es menor a
0" — hay que mandar el monto real, dentro del rango `min_amount`/`max_amount`.)*

## 5. Dónde viven las credenciales

`tienda/functions/.env` (ignorado por git — confirmado con
`git check-ignore -v tienda/functions/.env`). Variables ya guardadas:

| Variable | Qué es | ¿Puede viajar al navegador? |
|---|---|---|
| `PASARELA_PROVEEDOR` | `payway` | sí |
| `PASARELA_URL_REDIRECT` | endpoint de PayWay | sí |
| `PASARELA_MERCHANT_ID` / `PASARELA_FORM_ID` / `PASARELA_TERMINAL_ID` | identifican comercio y botón | sí (van en el `<form>`) |
| `PASARELA_AMBIENTE` | `sandbox` o `produccion` | sí |
| `PASARELA_API_KEY` | clave de la API REST de AAvance. Va en la cabecera **`Authorization`, cruda y sin prefijo** — ver sección 4 | **NO, nunca** |
| `PASARELA_URL_CONSULTA` | endpoint de consulta de estado | sí |

## 5b. 🔴 Bloqueante operativo — Firebase sigue en plan gratuito (Spark)

Confirmado por el usuario 2026-09-22: **todavía no se pagó el plan Blaze.**

Esto no es un detalle menor: el marketplace es un sitio **estático** (HTML/JS
servido por Hosting) — no hay ningún servidor propio. La única forma de tener
código de confianza es una **Cloud Function**, y las Cloud Functions requieren
Blaze. Sin eso:

- No se puede recibir el webhook de AAvance (necesita una URL HTTPS nuestra).
- No se puede recalcular el total en el servidor (sección 2).
- No se puede consultar la API de AAvance sin exponer el `ApiKey` en el
  navegador — que sería regalarle a cualquiera la llave del comercio.

**Por eso no se puede cobrar de verdad todavía, por más que la pasarela ya
funcione.** (Es el mismo bloqueo que tienen desde antes las 2 funciones de
notificaciones push ya escritas y sin desplegar — ver `tienda/CLAUDE.md`.)

**Lo que SÍ se puede hacer mientras tanto**, y es lo que se está haciendo:
probar el flujo completo a mano desde el PC (`test-pasarela.html` para el
pago, `test-pasarela-consulta.js` para la confirmación). Eso deja todo
verificado y el código listo para que, el día que se pague Blaze, sea
solo desplegarlo.

## 5d. 🎉 Primera transacción APROBADA (2026-09-23) — falta verificar del lado del servidor

El usuario hizo la prueba real con PSE/Nequi, botón `25681` (producción),
**$1.000 COP** — la pantalla de Nequi mostró "Transacción Aprobada":

| Campo | Valor |
|---|---|
| Id transacción | `28499250` |
| Descripción | Rodizio Cucuta - Prueba De Integracion |
| Empresa | Sociedad Gastronómica S.A.S. |
| Banco | NEQUI |
| Valor | $1.000,00 COP |

**Falta el `external_order` (número de `TEST-...`)** para poder consultarlo
con `test-pasarela-verificar-pago.js` y ver el `idstatus: 34` real — no sale
en la confirmación de Nequi, solo en el panel de AAvance (Transacciones →
expandir la fila del id `28499250`). El usuario no puede entrar al panel en
este momento, queda pendiente para retomar.

- [ ] Conseguir el `external_order` de la transacción `28499250` (panel de
      AAvance → Transacciones → expandir fila) y correr
      `node test-pasarela-verificar-pago.js <external_order> 1000` para
      confirmar `idstatus: 34` y cerrar de una vez la sección 4 con un caso
      aprobado real (hasta ahora solo se había probado con fallidas).

## 5c. Lógica real escrita y probada, sin Blaze (2026-09-23)

El usuario no puede pagar el plan Blaze todavía, pero preguntó si al menos se
podía probar la lógica directo desde el código. Sí — las dos piezas centrales
de la sección 2 y 6 ya están escritas como **funciones puras de Node**, sin
`firebase-admin` ni ninguna credencial de por medio (`products`/`productsMesa`
tienen `.read: true` público), probadas en vivo contra Firebase y contra la
API de AAvance:

- **`tienda/functions/lib/calcularTotal.js`** — `calcularSubtotalPedido(items,
  origen)`: recibe `[{id, qty}]` (el precio que mande el navegador se ignora
  a propósito) y devuelve el subtotal recalculado con los precios reales de
  Firebase. Probado: `node test-pasarela-calcular-total.js ENT-01:2 PAR-03:1`
  → trajo los precios reales (Crema de Pollo $24.000, Plato Mixto $68.000) y
  sumó bien. **Limitación conocida**: no replica todavía `currentShippingFee()`/
  `matchZone()` de `app.js` (el domicilio) — falta esa parte.
- **`tienda/functions/lib/consultarTransaccionAAvance.js`** —
  `consultarTransaccion(externalOrder)`: la llamada a la API de AAvance ya
  probada (cabecera `Authorization` cruda), ahora factorizada en un solo
  lugar en vez de vivir duplicada en cada script de prueba.
- **`tienda/functions/lib/confirmarPago.js`** — `verificarPago(externalOrder,
  montoEsperado)`: el corazón de la confirmación real. Consulta la
  transacción y **exige las dos cosas**: `idstatus === 34` (aprobada) Y que
  `amount` coincida exactamente con el total recalculado — no alcanza con
  mirar solo el estado, porque el monto viaja por un formulario que en
  teoría se puede alterar (ver "Decisión 2026-09-23" en sección 3). Probado
  contra la transacción `28438829` (fallida): correctamente devolvió
  `pagoValido: false` por estado. **Falta probar la rama de "monto no
  coincide"** contra una transacción aprobada de verdad — pendiente de la
  prueba real con PSE.

Scripts de prueba manual (todos desde `tienda/`, sin `npm start` siquiera):
```
node test-pasarela-calcular-total.js ENT-01:2 PAR-03:1
node test-pasarela-consulta.js TEST-xxxxxxxxxx
node test-pasarela-verificar-pago.js TEST-xxxxxxxxxx 10000
```

**Cuando se pague Blaze**, estas tres funciones se importan tal cual dentro
de `tienda/functions/index.js` (una función callable que llama
`calcularSubtotalPedido` al armar el formulario, y una función HTTP —el
webhook— que llama `verificarPago` al recibir la notificación de AAvance) —
no hay que reescribir la lógica, solo conectarla a Firebase Functions de
verdad y agregar el cálculo de domicilio que falta.

## 6. Plan de integración (borrador — falta cerrar la sección 4 antes de tocar código)

1. **Checkout** (`tienda/js/app.js`, `handleConfirmOrder`): en vez de armar el
   `<form>` a PayWay directo en el navegador con el total del carrito, se pide
   a una Cloud Function callable que: recalcule el total desde los precios
   reales de `products`/`productsMesa` (nunca el que manda el navegador —
   sección 2), genere un `order_number` único ligado al pedido, y devuelva ya
   armados los campos del formulario con ESE monto. El frontend solo pinta y
   envía el `<form>` que el backend le dio, nunca arma `amount` por su cuenta.
2. **Confirmación** — ya sabemos el camino (sección 4):
   - **Preferido**: nueva Cloud Function HTTP en `tienda/functions/index.js`
     (mismo patrón que las 2 que ya existen para notificaciones) registrada
     como webhook en el panel de AAvance (falta ubicar dónde se configura).
     Recibe el POST, valida `idstatus: 34` = aprobado, y recién ahí marca
     `orders/{id}.pagado = true`.
   - **Respaldo/verificación cruzada**: además del webhook, al abrir la
     pantalla de "mi pedido" el cliente puede disparar una consulta a
     `ObtenerTransaccionByExternalOrder` (si no requiere PCI-DSS — pendiente
     confirmar) para no depender 100% de que el webhook haya llegado.
   - `pagado` es el mismo campo que ya usa `panel-caja` para
     efectivo/transferencia (`docs-fusion/ESQUEMA-UNIFICADO.md`), así que
     reportes y caja no necesitan cambios.
3. **Reconciliación**: si el cliente cierra la página de PayWay sin terminar,
   el pedido queda sin `pagado` — pendiente decidir si se cancela solo pasado
   un tiempo o si caja lo revisa a mano.

## 7. Checklist de seguridad (no negociable antes de producción)

- [ ] Total recalculado en servidor, nunca confiado del navegador (sección 2).
- [ ] **Confirmación de pago verificada del lado del servidor, nunca solo
      por el regreso del navegador a `response_url`** (sección 4 — bloqueante
      hasta que se resuelva).
- [ ] Lo que sirva para verificar (firma/llave) solo en `tienda/functions/.env`
      / configuración de Firebase Functions — jamás en código del navegador.
- [ ] Probado primero en `sandbox`, con un pago de prueba de punta a punta,
      antes de cambiar `PASARELA_AMBIENTE` a `produccion`.
- [x] `tienda/functions/.env` confirmado como ignorado por git.

## 8. Bitácora

| Fecha | Qué pasó |
|---|---|
| 2026-09-21 | Se crea este documento + `tienda/functions/.env` + regla en `.gitignore`. |
| 2026-09-21 | Usuario comparte la documentación de PayWay (Coopcentral). Se guardan `merchant_id`/`form_id`/`terminal_id` de prueba en `.env`. Queda pendiente crítico: cómo se confirma un pago del lado del servidor (sección 4) — sin eso no se integra nada todavía. |
| 2026-09-21 | Usuario confirma que el servicio se llama **"AAvance"** dentro de Coopcentral. Sigue pendiente la sección 4. |
| 2026-09-21 | Usuario comparte un `ApiKey` (guardado en `.env`, no en este documento) y actualiza `form_id` a `25681`. La clave decodifica a un hash SHA-512 — pista de que existe una API REST aparte que podría resolver la sección 4. Pendiente que el usuario confirme dónde está esa documentación. |
| 2026-09-22 | Usuario confirma que no tiene más documentación por ahora — solo el `ApiKey`. Pide probar el botón igual (sandbox, sin riesgo). Se crean `tienda/test-pasarela.html` y `tienda/test-pasarela-respuesta.html`, aislados del checkout real, para probar el redirect y ver qué trae `response_url` de vuelta. |
| 2026-09-22 | **Prueba exitosa del redirect.** El formulario de `test-pasarela.html` llevó bien a la página de pago real de PayWay/AAvance — muestra el comercio correcto ("Sociedad Gastronómica S.A.S."), el número de orden, el monto ($10.000) y la descripción, todo tal cual se mandó. Confirma que `merchant_id`/`form_id`/`terminal_id` son válidos. Ofrece 3 métodos: Tarjeta, PSE, Efectivo. Falta completar un pago de prueba de punta a punta para ver qué llega a `response_url`. |
| 2026-09-22 | Primer intento de pago: transacción `28438829`, "Fallida". Al volver a `response_url`, sin parámetros en la URL. Se sospecha que PayWay confirma por POST en vez de GET — se ajusta `tienda/server.js` para capturar el cuerpo de un POST a `test-pasarela-respuesta.html` (nueva ruta especial, el resto del servidor sigue siendo estático). |
| 2026-09-22 | Segundo intento: transacción `28439891`, también "Fallida". Con la captura de POST ya activa, **sigue llegando vacío** — ni GET ni POST traen datos. **Confirmado: `response_url` no sirve para verificar nada, hace falta sí o sí la API de consulta con `PASARELA_API_KEY`.** Pendiente pedirle esa documentación a soporte de AAvance. |
| 2026-09-22 | Se encuentra por búsqueda web el portal de desarrolladores: `developeraavance.coopcentral.com.co`. Aviso encontrado: crear transacciones por API pediría certificación PCI-DSS (no aplica al negocio) — falta confirmar si consultar el estado de una transacción ya hecha tiene ese mismo requisito. |
| 2026-09-22 | Se lee el portal completo: 22 endpoints documentados. Encontrados los 2 que resuelven la sección 4: `GET .../ObtenerTransaccionByExternalOrder` (consulta de estado por `order_number`) y un mecanismo de **webhook** propio (POST a un endpoint del comercio, distinto de `response_url`, con `idstatus`/`externalorder`/etc.). Pendiente: (1) ubicar dónde se configura la URL del webhook en el panel, (2) confirmar con soporte si el PCI-DSS aplica también al endpoint de solo-consulta. |
| 2026-09-22 | Usuario guarda capturas del panel en `rodizio/psrelv de pgo/` (fuera del repo). **Se ubica el campo WEBHOOK: está en la TERMINAL** (`/dashboard/terminal/21827/`), junto al interruptor "ACTIVAR NOTIFICACIONES" (hoy en No) — cierra el pendiente (1) de la fila anterior. También se confirma que "URL DE RETORNO PREESTABLECIDA" (en Mi perfil → PARÁMETROS) es solo un `response_url` global, no el webhook. |
| 2026-09-22 | **La API de consulta FUNCIONA — sección 4 resuelta.** Se crea `tienda/test-pasarela-consulta.js` (Node, sin dependencias, sin Blaze) y se prueba contra el servidor real. Hallazgos: (1) la cabecera correcta es `Authorization: <llave cruda>`, NO `Api_key` como dice el portal; (2) devuelve `idstatus` (36 = Fallida, 34 = aprobada), `externalorder`, `amount` y todo el detalle — sirve perfecto para confirmar pagos desde el servidor; (3) **no requiere PCI-DSS**, respondió 200 con solo el ApiKey, así que ese aviso del portal era genérico; (4) `idform.esabierto: false` confirma que el botón es de monto fijo. |
| 2026-09-22 | **Causa de las transacciones fallidas confirmada: `idform.testmode: false`** — el botón `25681` está en modo PRODUCCIÓN. No hay sandbox aparte en AAvance, es un interruptor Test/Producción por botón. La red rechazó la tarjeta con "15 Negada, la institución no está en el IDF" (la leyó como Discover de EE.UU.). El flujo de integración en sí funcionó bien. Falta que el usuario ponga el botón en modo Test. Ver sección 4b. |
| 2026-09-22 | Tercera prueba (`28452220`): con la tarjeta correcta (`4111…`) pero **sigue fallida**, y la transacción nueva confirma `idform.testmode: false` — el botón `25681` no está en modo Test. Falta identificar cuál botón sí lo está (¿el `28613` de la documentación original?). Se deja el campo `form_id` editable en `test-pasarela.html` para poder probar otros sin tocar código. Ver sección 4b. |
| 2026-09-23 | Cuarta prueba (`28452672`) con el botón **`28613`, que sí tiene `testmode: true`** — y falló idéntica (mismo error 15, mismo procesador real). **Hipótesis del modo Test descartada: `testmode` no es un simulador de tarjetas, las transacciones van igual a la red real.** Ninguna tarjeta ficticia va a funcionar. Próximo intento: PSE, que suele traer banco de pruebas. Ver sección 4b. |
| 2026-09-23 | **Primera transacción APROBADA** (id `28499250`, $1.000 COP, botón `25681`, pagada con Nequi vía PSE) — confirmado por captura de Nequi. Falta el `external_order` para verificarla del lado del servidor con `test-pasarela-verificar-pago.js` — el usuario no puede entrar al panel de AAvance en este momento, queda pendiente. Ver sección 5d. |
| 2026-09-23 | El usuario pregunta si se puede avanzar el código sin Blaze. Se escriben 3 módulos puros de Node (`functions/lib/calcularTotal.js`, `consultarTransaccionAAvance.js`, `confirmarPago.js`) — sin `firebase-admin`, sin credenciales nuevas — y 2 scripts de prueba manual. Probado en vivo: el recálculo trae precios reales de Firebase, y la verificación detecta correctamente una transacción fallida. Falta probar la rama de "monto no coincide" con un pago aprobado real. |
| 2026-09-23 | Se prueba **PSE** con el botón `28613`, correo real. Se llega hasta el paso 3 ("Selecciona un banco") y se lista: son los 27 bancos reales de Colombia, ninguno de pruebas. **Se agotaron los dos métodos de pago (Tarjeta y PSE) sin encontrar ningún ambiente de simulación.** No se completó la transacción (elegir un banco redirige a un login real). Próximo paso: escribirle a soporte de AAvance. |
| 2026-10-07 | **Integración real desplegada** (ya con Blaze). ApiKey en Secret Manager. Funciones `crearPagoEnLinea`, `verificarPagoEnLinea`, `webhookAAvance` (us-central1). El pedido pagado en línea solo entra a `orders` cuando AAvance confirma aprobado + monto exacto; mientras tanto vive en `pagosPendientes`. El cliente no puede cancelar un pedido pagado; el domiciliario ve "Pagado en línea · no cobrar" y no le cuenta como efectivo. `settings.pagoEnLinea` sigue apagado hasta la prueba de punta a punta. Pruebas: 15 unitarias + 19 emulador. |
| 2026-10-07 | Se prende `pagoEnLinea` para la prueba real → la página de AAvance muestra "Espera — No se ha podido crear la transacción". Reproducido fuera del navegador: `POST /api/v1/console/verify/terminal-transaction` responde `{"error":true,"data":{"message":"No se ha podido crear la transacción."}}` con **todas** las variantes (datos actuales, teléfono 10 dígitos, con/sin documento, config idéntica a la prueba exitosa de sept., botón 28613, monto $1.000, `response_url` localhost). **Bloqueo del lado de AAvance** (botón/terminal/comercio inhabilitado o similar), no del código. Se apaga `pagoEnLinea` de nuevo. Pendiente: revisar panel o escribir a soporte (comercio 33048, botón 25681, terminal 21827) y registrar el webhook. |
| 2026-09-22 | **Descartadas las tarjetas de prueba que dio otra IA** (`4000 0000 0000 0002` etc.): no están en la documentación de AAvance, son el patrón de Stripe. La única de la documentación real es `4111 1111 1111 1111` (exp `06/26`, CVV `123`). Además la documentación no describe un sandbox aparte, sino botones en modo "Test" o "Producción" — hay que revisar en qué modo está el `form_id` `25681`. Ver sección 4b. |
