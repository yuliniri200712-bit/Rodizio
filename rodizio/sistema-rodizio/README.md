# Rodizio Cúcuta — Sistema de Gestión y Pedidos

Sistema web liviano (PWA) de tiempo real para la gestión de comandas en restaurantes tipo Rodizio. Diseñado sin frameworks pesados ni pasos de compilación (Vanilla JS/CSS/HTML), conectado directamente a **Firebase Realtime Database** mediante el SDK de Firebase.

> **Rama activa: `fusion`.** `main` quedó pre-fusión: usaba REST + SSE, la colección `/pedidos` y otro esquema de estados. Para trabajar sobre este código, leer `CLAUDE.md` primero.

---

## 🚀 Despliegue en Firebase Hosting

Proyecto **`rodiziomarketplace`**, hosting multisitio: cada panel se publica en su propio sitio mediante targets.

| Target | Sitio | URL |
|---|---|---|
| `mesero` | `rodizio-mesero` | https://rodizio-mesero.web.app |
| `cocina` | `rodizio-cocina` | https://rodizio-cocina.web.app |
| `caja` | `rodizio-caja` | https://rodizio-caja.web.app |
| `cliente` | `rodizio-cliente` | https://rodizio-cliente.web.app |
| `admin` | `rodizio-admin` | https://rodizio-admin.web.app |

El marketplace de domicilios se publica aparte en https://rodiziomarketplace.web.app

El repo **no versiona `.firebaserc`**, y ese archivo lleva los cinco targets. En una máquina nueva no basta con elegir el proyecto: hay que volver a asociar cada target.

```bash
npm install -g firebase-tools        # instalación única del CLI
firebase login
firebase use --add                   # seleccionar rodiziomarketplace
firebase target:apply hosting mesero  rodizio-mesero
firebase target:apply hosting cocina  rodizio-cocina
firebase target:apply hosting caja    rodizio-caja
firebase target:apply hosting cliente rodizio-cliente
firebase target:apply hosting admin   rodizio-admin

firebase deploy --only hosting        # todos los sitios
firebase deploy --only hosting:caja   # uno solo
```

⚠️ Confirmá el proyecto con `firebase use` antes de desplegar. `rodiziocucuta21.web.app` sigue en línea con una versión vieja y **no es el destino**; los nombres `rodizio` y `rodizio-cucuta` quedaron reservados globalmente por el proyecto suspendido en agosto de 2026 y Firebase no los libera.

---

## 🛠️ Arquitectura y Estructura del Código

El proyecto ha sido modularizado separando la estructura (HTML), los estilos (CSS) y la lógica funcional (JS) de cada panel de forma desacoplada y mantenible.

```
sistema-rodizio/
├── index.html            ← Login único unificado
├── styles.css            ← Estilos del login principal
├── app.js                ← Lógica del login y redirecciones por rol
├── shared/               ← Módulos compartidos por todos los paneles
│   ├── auth.js           ← Autenticación y Guards de sesión Firebase
│   ├── firebase.js       ← Cliente de datos sobre el SDK de Firebase (escrituras pasan por el guard de solo-lectura)
│   ├── roles.js          ← Permisos y niveles de usuario
│   ├── util.js           ← Funciones de formato de moneda (COP), beeps y sanitización
│   ├── menu.js           ← Menú del seed únicamente; en runtime el menú vive en RTDB y lo carga menu-loader.js
│   ├── ui.js              ← Notificaciones Toast unificadas en tiempo real
│   ├── ui.css             ← Componentes UI comunes (Toasts, botones CTA, empty states)
│   └── theme.css         ← Variables de diseño global, paleta de colores y fuentes
├── icons/                ← Íconos y logo centralizados (incluye icons/menu/ con la foto de cada plato)
├── mesero-app/           ← PWA para Meseros (Toma de comandas, menú interactivo, carritos por mesa y confirmación de pedidos hechos por QR)
├── panel-cocina/         ← Panel Kanban de Cocina (Recepción, preparación y despacho)
├── panel-caja/           ← Panel de Caja (Facturación, cierre de cuentas y exportación a Excel)
├── panel-admin/          ← Panel de Administración (Gestión de personal y generación de QR por mesa)
└── panel-cliente/        ← Página pública sin login que se abre al escanear el QR de la mesa, para pedir desde el celular propio
```

---

## 📋 Módulos y Paneles Activos

1. **Login Unificado (`/`)**: Entrada global que verifica la sesión y deja elegir entre los paneles operativos (mesero, caja, cocina) a los que cualquier trabajador activo tiene acceso; el panel de administración solo lo ven quienes tienen ese rol asignado.
2. **PWA Meseros (`/mesero-app`)**: Interfaz táctil adaptada a celulares. Soporta persistencia de carritos por mesa, búsqueda en el menú, alertas instantáneas cuando la cocina marca un pedido como "Listo", y revisión/confirmación de los pedidos que un cliente arma desde su QR antes de mandarlos a cocina.
3. **Panel Cocina (`/panel-cocina`)**: Pantalla horizontal dividida en estados (*Nuevos*, *En preparación*, *Listos*). Cuenta con alertas sonoras diferenciales, incluyendo un aviso cuando el mesero necesita coordinar un cambio en un pedido que ya está en preparación.
4. **Panel Caja (`/panel-caja`)**: Control financiero para cobrar cuentas pendientes, historial del día y reporte descargable en formato Excel.
5. **Panel Administración (`/panel-admin`)**: Alta, edición y activación/desactivación de trabajadores, y generación/descarga de los códigos QR de cada mesa.
6. **Panel Cliente (`/panel-cliente`)**: Página pública sin login, pensada para abrirse al escanear el QR de la mesa. El comensal arma su pedido con fotos de cada plato y lo envía — el mesero lo revisa y confirma antes de que entre a cocina, así el cliente nunca escribe directo en las comandas.

---

## ⚡ Características Destacadas

- **Cero Build/Bundlers**: Carga instantánea directa en el navegador.
- **Instalable (PWA)**: Cada panel operativo incluye manifest y Service Worker independiente para pantalla de inicio (`panel-cliente` es la excepción a propósito: es una página liviana sin instalación, para abrir rápido desde el QR).
- **Sincronización SSE en Tiempo Real**: Todos los cambios de estado se reflejan en menos de 200ms sin recargar la página.
- **Normalización de Mesas**: Algoritmo tolerante a fallos que evita la duplicación de identificadores de mesas.
- **Pedido por QR con confirmación humana**: el cliente arma su carrito desde su propio celular, pero el mesero siempre es quien revisa y lo pasa a cocina — nunca se salta ese paso.
