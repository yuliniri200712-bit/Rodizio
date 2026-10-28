# Preguntas pendientes — Rodízio Cúcuta

Resultado de la auditoría (Fase 0) del sitio de pedidos y del panel de administración. Cada pregunta tiene quién la responde y para qué sirve. Escribe la respuesta en la columna final.

Fecha: 2026-10-20.

## Ya resuelto (no hay que volver a preguntar)

- Ubicación del restaurante: la del RUT (Av. Libertadores 10-121, II Etapa Malecón, Barrio La Riviera).
- Borrar historial: no se borra nada; las listas se filtran por día para que no salga todo junto.
- Los lugares y tarifas de domicilio se ajustan más adelante (ver sección 3).

## 1. Para el negocio

| # | Tema | Pregunta | Para qué se usa | Respuesta |
|---|---|---|---|---|
| 1 | Opciones de pago | ¿Qué es «T.C» que hay que quitar de las opciones? ¿Es «Efectivo / Datáfono», los botones «Tarjeta» de caja u otra cosa? ¿Dónde se ve? | No aparece como texto en el código; sin saber cuál es, no se puede quitar. | |
| 2 | WhatsApp | ¿Los números que reciben pedidos reciben todos los pedidos, funcionan por horario, o hay uno principal y uno de respaldo? (La respuesta fue «ambas»: indicar cuáles dos.) | Hoy hay un solo número fijo en el código. | |
| 3 | Inventario | ¿Qué fue lo que «ya se ajustó» con la disponibilidad? ¿Cuáles de estos estados debe ver el cliente: disponible, con unidades, quedan pocas, agotado, oculto? | Hoy se pueden combinar y confunden. | |
| 4 | Turnos de domiciliarios | ¿«Turno» es solo el cierre de caja del domiciliario, o hay que registrar inicio y fin de jornada? | Hoy solo existe el cierre de caja. | |
| 5 | Nombre del sitio | Cuando el cliente dice «marketplace», ¿se refiere al sitio público de pedidos? | Para no tocar la parte equivocada. | |
| 6 | Botón «Borrar historial» | El botón de Configuración › Avanzado ya no funciona (las reglas lo rechazan). ¿Se quita o se deja y se arregla solo para el registro de errores? | No se borra nada, pero el botón sigue ahí. | |
| 7 | Reportes | ¿Cuáles métricas quiere ver el dueño? Ventas por día/semana/mes, nº de pedidos, ticket promedio, platos más vendidos, pedidos por estado (con cancelados), pedidos y domicilios por domiciliario, pedidos por zona, horas pico, método de pago. | No se construyen todas; el dueño elige. | |

## 2. Del documento «Datos para la página Rodízio» (siguen en Pendiente)

| # | Tema | Pregunta | Para qué se usa | Respuesta |
|---|---|---|---|---|
| 8 | Reclamos de datos | ¿Qué correo y qué persona atienden los reclamos sobre datos personales? (La ley da 10 días hábiles para consultas y 15 para reclamos.) | Política de datos. | |
| 9 | Nombre comercial | ¿Rodízio Cúcuta tiene matrícula propia o es el establecimiento «Pizza Rio Parrilla y Pinchos»? ¿La marca «Rodízio» está registrada? | Pie de página y términos. | |
| 10 | Reembolsos | Para pagos en línea cancelados: ¿los 5 días son hábiles o calendario? ¿Reversión por AAvance o transferencia? | Términos de venta. | |
| 11 | Licor | ¿Qué avisos legales deben ir en la tienda por la venta de licor (menores de 18 y advertencia de salud)? | Términos y avisos. | |
| 12 | Revisión legal | ¿Hay un abogado que revise la política y los términos antes de publicarlos? ¿Quién? | Los borradores quedan en `docs/legal/` hasta esa revisión. | |

## 3. Aplazado: lugares y tarifas de domicilio

Se retoma después. Se deja registrado para no perderlo.

| # | Tema | Pregunta | Respuesta |
|---|---|---|---|
| 13 | Distancia | ¿Se mide en línea recta o por vía? | |
| 14 | Referencia | ¿Qué significa «más allá de Postobón» (qué sede, en qué dirección)? ¿Qué tarifa va entre 4 km y Postobón? | |
| 15 | Límite | ¿Hay una distancia máxima donde no se entrega? ¿Se entrega fuera de Cúcuta (Los Patios, Villa del Rosario)? | |
| 16 | Cobro del envío | ¿El envío se paga en línea junto con el pedido, o lo cobra el domiciliario en efectivo? | |
| 17 | Barrios | Si la cobertura es por barrio, hace falta el listado completo de barrios de Cúcuta. No se encontró una lista oficial única; opciones: pedirla a Planeación Municipal, extraerla de las fichas por comuna de la Alcaldía, o dejar que se vaya completando. | |
| 18 | Tarifa por barrio | ¿Quién asigna cada barrio a su tarifa ($8.000, $10.000, $12.000, $14.000)? ¿El dueño a mano o por distancia calculada y revisada por él? | |

## 4. Para el desarrollador

| # | Tema | Pregunta | Respuesta |
|---|---|---|---|
| 19 | Navegador | ¿Se autoriza abrir el navegador para medir la carga y reproducir el problema del plato en móvil (360×800, 390×844, 412×915, 768×1024 e iOS Safari)? | |
| 20 | Documento Word del cliente | El enlace de OneDrive no se pudo leer. Exportarlo a `.docx` o `.md` dentro del proyecto. | |
| 21 | Archivos sin commitear | Hay 347 archivos modificados desde antes de esta revisión. ¿Se trabaja sobre ellos o se commitean primero? | |
| 22 | Autor de los commits | ¿`deyvidjgv` o «DJG»? | |
