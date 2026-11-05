# Rodízio Cúcuta

Sistema del restaurante: marketplace de domicilios y sistema de meseros, sobre
una sola base de datos de Firebase. Todo el código está en
`rodizio/sistema-rodizio/`.

## Dónde está cada cosa

```
rodizio/sistema-rodizio/
├─ tienda/            MARKETPLACE
│  ├─ index.html      lo que ve el cliente (js/app.js, js/ui.js)
│  ├─ admin.html      panel de domicilios: descuentos, menú, pedidos (js/admin.js)
│  ├─ driver.html     app del domiciliario (js/driver.js)
│  ├─ css/            estilos
│  ├─ js/             pantallas y reglas del pedido (js/reglas-pedido.js)
│  ├─ functions/      servidor: pedidos, pagos y avisos
│  └─ docs/           historial de cambios
│
├─ mesero-app/        SISTEMA DE MESEROS: meseros
├─ panel-caja/        caja y confirmación de domicilios
├─ panel-cocina/      cocina
├─ panel-admin/       trabajadores, carta de mesa y reportes
├─ panel-cliente/     carta QR de la mesa
├─ index.html         inicio de sesión del personal
│
├─ shared/            COMPARTIDO: código y colores de los paneles
├─ icons/             íconos y fotos del menú
├─ database.rules.json  permisos de la base de datos
├─ docs-fusion/, docs/  documentación y planes
└─ scripts/           herramientas, como el entorno local de pruebas
```

## Antes de cambiar algo

- **No muevas ni renombres carpetas** dentro de `sistema-rodizio`: las páginas se
  buscan entre sí por su ubicación y podrían dejar de funcionar o de publicarse.
- **Nada privado va en este repositorio:** ni documentos de la empresa, ni
  respaldos de la base de datos, ni el archivo `tienda/functions/.env`.
- **Reglas del proyecto para programar:** `rodizio/sistema-rodizio/CLAUDE.md` y
  `rodizio/sistema-rodizio/tienda/CLAUDE.md`.
- **Probar sin tocar producción:** `node scripts/entorno-local.mjs`, desde
  `rodizio/sistema-rodizio/`.

Subir cambios a GitHub no los publica en los links: publicar es un paso aparte
con Firebase.
