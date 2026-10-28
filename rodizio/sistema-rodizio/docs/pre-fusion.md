# Estado PRE-fusión — Rodizio Cúcuta

> ⚠️ **Esto describe el sistema ANTES de la fusión.** Varias cosas de acá **ya no son ciertas**
> en la rama `fusion` (que es la rama de trabajo actual): los datos van por SDK y no por REST+SSE,
> `/pedidos` pasó a ser `orders`, `estado` pasó a `status`, etc. — el resumen de los cambios está
> en el banner de `CLAUDE.md`, y la foto exacta en `docs-fusion/ESTADO-ACTUAL.md`.
>
> Se conserva porque buena parte de la lógica de producto (rondas, estado por ronda, cancelación,
> mesas sin nodo) se mantuvo conceptualmente en la fusión, y porque explica el **por qué** de
> decisiones que siguen vigentes.
>
> **No se carga en contexto.** Antes de confiar en algo de acá, verificá contra
> `docs-fusion/ESTADO-ACTUAL.md`.

---

## Arquitectura de datos pre-fusión: REST + SSE, sin SDK

> En `fusion` esto cambió: `shared/firebase.js` ahora usa el SDK
> (`shared/firebase-app.js` = `initializeApp` único) y `escucharSSE(path, onData, onStatus)`
> envuelve `onValue`. Ver `docs-fusion/PLAN-FUSION.md` Fase 2b.

Firebase Realtime Database **sin el SDK de Firebase** para leer/escribir datos: todo por la REST
API pública (`GET/PUT/PATCH/POST/DELETE {DB_URL}{path}.json`) y streaming en vivo con `EventSource`
(Server-Sent Events). Cero dependencias, cero build.

El SDK de Firebase **sí** se usaba, pero solo para Authentication (`shared/auth.js`, único archivo
de `shared/` cargado como módulo ES, importa el SDK desde el CDN de gstatic).

## Esquema pre-fusión

> En `fusion`: una sola colección `orders` (antes `/pedidos`), campo `status` (antes `estado`), con
> `origen: "mesa" | "domicilio" | "recoger"`. Helpers en `shared/util.js`: `origenDe`, `statusDe`,
> `tsDe`, `nombreLinea/precioLinea/notaLinea`.

```
/pedidos/{pushId}
  codigo        "P-014"                  # correlativo diario, ver siguienteCodigo()
  mesa          "Mesa 7"                 # NOMBRE de la mesa — lo que muestran cocina y caja
  mesaId        "mesa-7"                 # id local de la mesa
  mesero        "Juan Pérez"
  meseroUsuario "juanp"
  cliente       "María"                  # opcional — solo si el pedido vino de una solicitud
                                         # confirmada; si falta, panel-cocina muestra el mesero
  lineas        [{id, nombre, cat, qty, precio, nota, ronda}]
  total         123400
  estado        "enviado" | "preparacion" | "listo" | "entregado" | "cancelado"
                                         # RESUMEN calculado (salvo "cancelado") — no se edita a
                                         # mano, se recalcula en cada cambio
  ts            1690000000000            # creación (ronda 1)
  tsCambio      1690000000000            # último cambio de estado de cualquier ronda
  rondaActual   1                        # número de la última ronda agregada
  rondas        {"1": 1690000000000}     # ronda -> timestamp, para mostrar "hace X min"
  rondaEstados  {"1": "listo", "2": "enviado"}   # estado de CADA ronda por separado
  rondaPrepInicio {"2": 1690000000000}   # opcional — ronda -> cuándo se tocó "Empezar"
  tsUltimaRonda 1690000000000            # cambia con cada ronda nueva — dispara aviso en cocina
  avisoCambio   {mensaje, mesero, ts}    # opcional — ver "Avisar cambio a cocina"
  pagado        true                     # opcional — lo pone panel-caja al cobrar
  tsPago        1690000000000            # opcional
  metodoPago    "efectivo" | "tarjeta"   # opcional
  cajero        "Laura Gómez"            # opcional — quién confirmó el cobro
  cajeroUsuario "laurag"                 # opcional
  canceladoPor  "Juan Pérez"             # opcional — solo si estado === "cancelado"
  tsCancelado   1690000000000            # opcional
  motivoCancelacion "Cliente se arrepintió"   # opcional — texto libre, lo pide un prompt()

/solicitudes/{mesaId}          # carrito pendiente de un cliente vía QR
  lineas       [{id, nombre, cat, qty, precio, nota}]   # mismo shape que pedidos.lineas
  mesa         "Mesa 7"                  # nombre visible, para que mesero-app pueda registrar
                                         # la mesa aunque no la conociera aún
  cliente      ""                        # opcional — viaja a pedidos.cliente si el mesero confirma
  actualizado  1690000000000

/contadores/{YYYY-MM-DD}       # último correlativo del día, ETag condicional (evita choques)

/trabajadores/{uid}            # uid = UID de Firebase Authentication
  nombre
  usuario                      # sin "@rodizio.local" — ver usuarioAEmail() en shared/auth.js
  rolesPermitidos              # ARRAY pre-fusión. En `fusion` es un MAPA ({"admin": true}).
  estado                       # "activo" | "inactivo" — inactivo = fuera de todas las apps
  creado / actualizado
```

**No existe un nodo `/mesas`.** Si en la base quedó uno de una versión anterior, es dato muerto:
ninguna app lo lee ni lo escribe.

## Flujos pre-fusión

**Flujo de un pedido:** mesero envía (`enviado`) → cocina pasa a `preparacion` → `listo` → mesero
marca `entregado` → caja confirma el cobro (`pagado: true`, sin tocar `estado`). Las apps escuchan
`/pedidos` en vivo por SSE, así que un cambio se ve al instante en todas las pantallas.

> En `fusion` la escalera es: `recibido → enviado → preparacion → listo → en_camino → entregado`
> (+ `cancelado`, `no_entregado`). `recibido`/`en_camino` no se cocinan.

**Flujo de un pedido iniciado por el cliente (QR):** el cliente escanea el QR de su mesa → abre
`panel-cliente` → arma su carrito, que se guarda en vivo en `/solicitudes/{mesaId}` → toca "Enviar
pedido al mesero". Eso **no** crea un pedido ni pasa a cocina — solo le avisa a `mesero-app`
(sonido + toast + indicador en la tarjeta de esa mesa) que hay un pedido esperando. El mesero se
acerca, revisa el detalle, y toca "Confirmar pedido": recién ahí se carga como comanda normal
(`enviado` en `/pedidos`) y se borra `/solicitudes/{mesaId}`. Si el mesero prefiere no usarlo,
puede "Descartar" sin crear nada. **El cliente nunca manda nada directo a cocina.**

Al armar el carrito, `panel-cliente` deja escribir un nombre opcional (`solicitudes.cliente`) que
viaja al pedido si el mesero confirma. Ese nombre es lo que `panel-cocina` muestra en el ticket
junto al mesero — si el mesero cargó la comanda directo (sin pasar por el QR) no hay nombre de
cliente, y el ticket muestra el nombre del mesero también en ese lugar en vez de dejarlo vacío.

### Rondas — pedir más en la misma mesa NO crea un pedido nuevo

Si el mesero envía una comanda a una mesa que ya tiene un pedido sin pagar (`pedidoActivoDeMesa()`
en `mesero-app/app.js`), lo que envía se **suma como una ronda nueva** al pedido existente
(`agregarRonda()`) en vez de crear un `/pedidos` aparte — antes sí creaba uno aparte, duplicando el
ticket en cocina y en la pestaña "Pedidos" del mesero para la misma mesa/sentada.

Cada línea guarda su `ronda` (1 = pedido original), y el pedido guarda `rondas` (timestamp de
cuándo se agregó cada una) y `tsUltimaRonda`. `mesero-app` (pestaña Pedidos) y `panel-cocina` (cada
ticket) muestran las líneas agrupadas por ronda con su propio encabezado ("Pedido inicial" /
"Ronda 2 · hace X min"), usando `agruparPorRonda()` de `shared/util.js`.

Por esto mismo, `cancelarPedido()` (borrar el pedido entero) y `editarPedido()` (sobreescribir
`lineas` completo) solo se permiten si `rondaActual` sigue en 1 — un pedido con más de una ronda ya
tuvo algo en curso o servido, así que no se puede tirar/reemplazar entero.

### Estado por ronda — cada ronda avanza y se sirve por separado

Si una mesa ya tenía una ronda `listo` (esperando al mesero) y llega una ronda nueva, la ronda
vieja **no se toca** — solo la ronda nueva arranca en `enviado`.

Antes, agregar una ronda ponía TODO el pedido de vuelta en `estado: "enviado"`, así que la parte ya
lista/servida parecía tener que prepararse de nuevo (confuso para cocina y para el mesero); se
corrigió siguiendo el patrón de fulfillment por ítem que usan Toast/Oracle KDS.

El detalle vive en `pedido.rondaEstados` (`{ronda: estado}`) y `pedido.rondaPrepInicio`
(`{ronda: ts}`, para el cronómetro de preparación de esa ronda puntual) — `shared/util.js` expone:
- `estadoDeRonda(p, ronda)`: estado de una ronda puntual (con fallback a `p.estado` para pedidos
  anteriores a este campo).
- `rondaEstadosCon(p)`: el mapa completo con el mismo fallback, para usar como base al construir un patch.
- `estadoEfectivoTicket(p)`: la ronda pendiente MENOS avanzada (o `"entregado"` si ya se sirvieron
  todas) — esto es lo que se guarda en `pedido.estado` en cada cambio, así decide en qué columna
  aparece el ticket en `panel-cocina` y cuándo `panel-caja` puede cobrarlo, sin que ese panel
  necesite saber nada de rondas.

En `panel-cocina`, cada grupo de ronda dentro del ticket tiene su propio botón ("Empezar"/"Marcar
listo", `marcarRonda()`) y badge ("Esperando mesero"/"Servido"). En `mesero-app` (pestaña Pedidos),
"Marcar servido" (`marcarServido(id, ronda)`) también es por ronda — se puede recoger la ronda 1
sin esperar a que la ronda 2 esté lista.

### Cancelar un pedido no lo borra — lo marca `estado: "cancelado"`

`cancelarPedido()` en `mesero-app` hace `dbUpdate` (nunca `dbDelete`) para que el dueño tenga
registro de qué se canceló, cuándo, quién lo hizo (`canceladoPor`) y por qué
(`motivoCancelacion`, opcional).

Un pedido cancelado no ocupa la mesa (`mesaOcupada()`/`pedidoActivoDeMesa()` lo excluyen
explícitamente) y no aparece en el tablero de `panel-cocina` ni en `panel-caja` — ninguno de los
dos lo busca por `estado`, así que "cancelado" simplemente no calza en ningún filtro existente.
Sigue estando disponible en `/pedidos` para auditar cancelaciones directamente en Firebase; no hay
todavía una vista/reporte dedicado a esto.

### "Avisar cambio a cocina" es otra cosa distinta a una ronda

Ese botón (visible en `mesero-app` mientras el pedido está en `preparacion`/`listo`) es para cuando
el cliente quiere **modificar o quitar** algo que ya se está cocinando — cuelga un aviso
(`avisoCambio`) visible y sonoro en `panel-cocina` para que se coordinen de viva voz, pero **no**
toca `lineas` ni `estado`.

Agregar platos nuevos SIEMPRE pasa por el flujo de rondas (aparece como algo nuevo para preparar),
nunca por este aviso.

### División de responsabilidades por panel (pre-fusión)

A propósito, no se pisan:
- **`mesero-app`**: crea el pedido (`enviado`) y lo marca `entregado` cuando lo sirve. También
  revisa y confirma (o descarta) las solicitudes de `panel-cliente`.
- **`panel-cocina`**: avanza `enviado` → `preparacion` → `listo`. No toca cobros.
- **`panel-caja`**: solo ve pedidos ya `entregado` y confirma el pago (`pagado`/`tsPago`). **No**
  avanza el estado del pedido — eso es trabajo de cocina. Tampoco muestra el tablero
  Nuevos/Preparación/Listos: se quitó a propósito porque duplicaba `panel-cocina`.
- **`panel-admin`**: gestiona trabajadores (crear, editar, activar/desactivar, eliminar) y
  genera/imprime los QR de cada mesa. No toca pedidos.
- **`panel-cliente`**: sin login, deja al comensal armar y mandar su carrito a
  `/solicitudes/{mesaId}`. Nunca escribe en `/pedidos` directamente.

## Mesas — sin nodo en Firebase, ocupación calculada al vuelo

Vive todo en `mesero-app`, no hay CRUD de mesas en ningún panel:

- La grilla arranca con **Mesa 1 … Mesa 20**, generadas en memoria (`defaultMesas` en
  `mesero-app/app.js`). No se leen de Firebase.
- El botón **"+ Abrir otra"** deja escribir cualquier nombre ("Terraza 1", "VIP", "Barra 3") — se
  agrega a la grilla de esa pantalla al instante.
- Una mesa creada así **se propaga sola a los demás meseros** en cuanto tiene un pedido:
  `conectarPedidos()` reconstruye la lista de mesas a partir de los pedidos sin pagar que llegan
  por SSE. Si nunca se le manda una comanda, desaparece al recargar (es lo esperado — no era una
  mesa real).
- **Ocupada** = existe algún pedido de esa mesa sin `pagado`. Cálculo al vuelo (`mesaOcupada()`),
  no una bandera guardada, así que nunca puede quedar desincronizada.
- **Cualquier mesero puede entrar a cualquier mesa**, esté libre u ocupada, y mandarle una comanda
  nueva. No hay dueño, ni reserva, ni bloqueo — decisión consciente: más simple, sin el caso raro
  de "mesa ocupada para siempre porque alguien la tomó y nunca la usó", a cambio de no impedir que
  dos personas trabajen la misma mesa a la vez.
- Elegir mesa **no escribe nada en Firebase** — es estado de esa pantalla.
- El carrito **se guarda por mesa** mientras la app está abierta (`carritosPorMesa`), para poder
  saltar entre mesas sin perder lo que ya se había marcado.

> **Nota:** en 2x1 (el fork) esto cambió a un nodo `/mesas` real, porque los dos generadores de id
> independientes producían mesas fantasma. Lo que sí se conservó allá es la ocupación calculada al
> vuelo. Ver `2x1/docs/historial.md`.

## Limitaciones conocidas pre-fusión

**1. ~~Reglas de RTDB abiertas~~ — DESACTUALIZADO.** En la rama `fusion`, `database.rules.json`
(reglas cerradas, ownership-based) **ya está desplegado** tanto en `rodiziomarketplace` como en
`rodizio-eb49a` (ver `docs-fusion/ESTADO-ACTUAL.md` §4 y la ronda de hardening de seguridad
2026-09-19 en `tienda/CLAUDE.md`). `/solicitudes` sí tiene su regla de escritura pública aparte
(sin `auth != null`) porque `panel-cliente` no tiene login.
**Lo que SÍ sigue pendiente:** probar de punta a punta el flujo completo de mesas bajo estas reglas
cerradas (marcado como no probado en `docs-fusion/ESTADO-ACTUAL.md` §5). Si aparece un
`permission_denied` inesperado, diagnosticar la regla puntual — **nunca** volver a abrir con `true`
genérico.

**2. Restablecer contraseña por correo no funciona.** Los trabajadores usan `usuario@rodizio.local`
(correo sintético interno, sin bandeja real), así que Firebase no tiene a quién mandarle el link.
Resetear la contraseña de otro trabajador se hace a mano desde la consola de Firebase.

**3. Eliminar un trabajador** desde `panel-admin` borra su perfil de `/trabajadores` (con eso ya no
puede entrar), pero **no** borra su cuenta de Firebase Authentication — esa queda huérfana y hay
que borrarla desde la consola. No hay forma de automatizarlo sin backend (Admin SDK).

**4. Crear cuentas de otros trabajadores usa una segunda instancia de Firebase**
(`authSecundaria()` en `auth.js`) para que el admin no pierda su propia sesión al crear una. Es una
limitación conocida del SDK, no un bug nuestro.

**5. Sin backend real:** `siguienteCodigo()` usa ETag condicional como aproximación a una
transacción atómica. No es 100% a prueba de carreras con concurrencia muy alta (aceptable para el
volumen de un restaurante).

**6. Exportar a Excel** (`panel-caja`) carga ExcelJS desde CDN la primera vez (necesita internet);
después queda cacheado por el service worker.

**7. No hay forma de crear el primer admin desde la interfaz** — ver abajo.

## Cómo crear el primer admin (consola de Firebase)

1. Firebase Console → Authentication → Users → "Add user". Email: `TUUSUARIO@rodizio.local`,
   cualquier contraseña. Copia el UID.
2. Firebase Console → Realtime Database → crea el nodo `/trabajadores/{ESE_UID}`:
   ```json
   { "nombre": "Tu Nombre", "usuario": "TUUSUARIO", "rolesPermitidos": ["admin"], "estado": "activo", "creado": 1690000000000 }
   ```
   > ⚠️ En la rama `fusion`, `rolesPermitidos` es un **MAPA**: `{"admin": true}`.
3. Entra a `/index.html` con ese usuario y contraseña. De ahí en adelante, el resto de trabajadores
   se dan de alta desde `panel-admin`.

> En `fusion` hay que **recrear las cuentas de `/trabajadores`** en `rodiziomarketplace`.
