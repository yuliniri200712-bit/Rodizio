# Hosting multi-sitio — un dominio por panel

Cada panel se publica en **su propio sitio de Firebase Hosting**, sin ver el
código de los otros. Todos en el proyecto **`rodiziomarketplace`** (junto a la
tienda, que tiene sus 3 sitios: `rodiziomarketplace`,
`rodizio-admin-domicilios`, `rodizio-driver`).

| Target (`firebase.json`) | Sitio / URL | Sirve |
|---|---|---|
| `mesero`  | `rodizio-mesero.web.app`   | login + `mesero-app/` |
| `cocina`  | `rodizio-cocina.web.app`   | login + `panel-cocina/` |
| `caja`    | `rodizio-caja.web.app`     | login + `panel-caja/` |
| `admin`   | `rodizio-admin.web.app`    | login + `panel-admin/` — **admin principal** (trabajadores, mesas/QR) |
| `cliente` | `rodizio-cliente.web.app`  | `panel-cliente/` en la raíz (sin login, QR) |

> `rodizio-admin.web.app` es el admin **principal** del sistema. El admin de la
> tienda (`tienda/admin.html`, solo logística de domicilios) se movió a
> `rodizio-admin-domicilios.web.app`.

Cada sitio incluye **solo su panel** + la infraestructura común (`index.html`
de login, `shared/`, `icons/`). Las carpetas de los otros 4 paneles se excluyen
con `ignore` en `firebase.json`.

- El login raíz detecta el dominio (`panelDedicado()` en `app.js`) y entra
  directo al único panel del sitio — no muestra el elegidor de rol. En
  `rodizio-admin` exige rol `admin`.
- Los QR de mesa (`panel-admin`) apuntan a `https://rodizio-cliente.web.app/`
  siempre que no se corra en localhost (constante `CLIENTE_URL_PROD` en
  `panel-admin/app.js`; en `localhost`/`127.0.0.1` usa `../panel-cliente/`).
- `panel-cliente` no es PWA (sin `sw.js`), así que su sitio no cachea shell.

## Primer despliegue (una sola vez)

```bash
firebase use rodiziomarketplace            # el classifier bloquea  -P rodiziomarketplace

# 1. crear los 5 sitios (los nombres tienen que estar libres a nivel global)
firebase hosting:sites:create rodizio-mesero
firebase hosting:sites:create rodizio-cocina
firebase hosting:sites:create rodizio-caja
firebase hosting:sites:create rodizio-admin
firebase hosting:sites:create rodizio-cliente

# 2. enlazar cada target con su sitio (ya está en .firebaserc, esto lo confirma)
firebase target:apply hosting mesero  rodizio-mesero
firebase target:apply hosting cocina  rodizio-cocina
firebase target:apply hosting caja    rodizio-caja
firebase target:apply hosting admin   rodizio-admin
firebase target:apply hosting cliente rodizio-cliente
```

Si algún nombre está tomado, elegí otro y actualizá el mismo nombre en
`.firebaserc` (`targets.rodiziomarketplace.hosting`) y — si es el de cliente —
la constante `CLIENTE_URL_PROD` en `panel-admin/app.js` y `docs-fusion`.

## Desplegar

```bash
firebase use rodiziomarketplace

firebase deploy --only hosting                 # los 5 de golpe
firebase deploy --only hosting:admin           # solo uno
firebase deploy --only hosting:mesero,hosting:caja
```

La tienda se sigue desplegando aparte desde `tienda/` con su propio
`firebase.json` (`firebase deploy --only hosting` dentro de esa carpeta).

## Notas

- `.firebaserc` está en `.gitignore` — ya lo dejé configurado en esta máquina;
  en otra hay que repetir el `target:apply` o copiar el bloque `targets`.
- `database` y `functions` viven en el `firebase.json` de la raíz; un
  `firebase deploy --only hosting` no los toca.
- El sitio viejo `rodiziocucuta21` (proyecto `rodizio-eb49a`) queda obsoleto
  con este esquema; se puede archivar cuando los 5 nuevos estén probados.
