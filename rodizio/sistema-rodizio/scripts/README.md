# scripts/ — utilidades de la fusión

## Cargar el menú real a RTDB (Fase 2)

El menú de 162 ítems vivía fijo en `shared/menu.js`. Ahora vive en
Realtime Database (`categories` / `products` / `sugerencias` /
`sugerenciasPorProducto`), que es lo que leen `shared/menu-loader.js`
(mesa) y `tienda/js/catalog.js` (domicilios).

### 1. Generar los JSON (determinístico, ya commiteados)

```bash
node scripts/build-menu-data.mjs
```

Lee `shared/menu.js` y escribe `scripts/menu-seed/*.json`. Re-ejecutable.
Correlo de nuevo si se edita `shared/menu.js`.

### 2. Subir a RTDB

Necesita el Firebase CLI logueado (`firebase login`) con acceso al
proyecto destino.

```bash
firebase use rodiziomarketplace     # o rodizio-eb49a mientras se prueba

firebase database:set /categories            scripts/menu-seed/categories.json
firebase database:set /products              scripts/menu-seed/products.json
firebase database:set /sugerencias           scripts/menu-seed/sugerencias.json
firebase database:set /sugerenciasPorProducto scripts/menu-seed/sugerenciasPorProducto.json
```

> `database:set` **reemplaza** el nodo completo. En `rodiziomarketplace`
> eso pisa los 16 productos genéricos de la semilla vieja (`tienda/js/data.js`)
> — es lo que queremos (ver Fase 6 del plan).

> ⚠️ **Y también borra las traducciones al inglés** (`nameEn`/`descriptionEn`),
> que no viven en `shared/menu.js`. Después de cualquier `database:set` del
> menú, volver a aplicarlas (paso 4).

### 3. Fotos de los platos

`products/*.image` guarda rutas tipo `icons/menu/en1.webp`. Desde 2026-10-06
cada foto existe en dos tamaños, en `icons/menu/` (apps de mesa) y en la copia
`tienda/icons/menu/` (la tienda publica solo su carpeta):

- `icons/menu/<f>.webp` — 320 px, para la lista.
- `icons/menu/hd/<f>.webp` — hasta 800 px, para el detalle del producto.
  `menu-loader.js` (`imgHd`) y `tienda/js/ui.js` (`fotoHd`) derivan la ruta
  HD de la normal; si falta, caen a la de 320.

Las de 150 px que había se reemplazaron con las originales de Ola Click
(`assets.olaclick.app/companies/products/images/800/<uuid>.jpg`), emparejadas
por comparación de imagen, no por nombre. Una foto nueva necesita las dos
versiones (si solo se pone la de 320, el detalle la usa igual).

### 4. Traducciones al inglés

`menu-seed/traducciones-en.json` tiene `nameEn`/`descriptionEn` de los 134
productos, `nameEn` de las 15 categorías y las descripciones en español que
estaban cortadas con "…". Para (re)aplicarlas:

```
node scripts/aplicar-traducciones.mjs        # arma el parche, no escribe
MSYS_NO_PATHCONV=1 firebase database:update / scripts/menu-seed/parche-traducciones.json --project rodiziomarketplace
```

Solo escribe en registros que ya existen en cada nodo. Al editar un plato en
los paneles, la traducción se conserva salvo que cambie el texto en español
(ver `conservarTraducciones` en `tienda/js/catalog.js`).
