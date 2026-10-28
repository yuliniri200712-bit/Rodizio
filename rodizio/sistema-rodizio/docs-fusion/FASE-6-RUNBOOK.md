# Fase 6 — Limpieza y cutover (runbook)

Todo esto necesita tu login de Firebase CLI (`firebase login`) y/o la consola.
El código de las fases 2b–5 ya está en la rama `fusion`.

## Orden

### 1. Backups (por disciplina)

```bash
firebase use rodiziomarketplace
firebase database:get / -o docs-fusion/backup-marketplace-$(date +%Y%m%d).json
firebase auth:export docs-fusion/auth-marketplace.json --format=json

firebase use rodizio-eb49a
firebase database:get / -o docs-fusion/backup-eb49a-$(date +%Y%m%d).json
firebase auth:export docs-fusion/auth-eb49a.json --format=json
```

### 2. Probar la rama `fusion` contra `rodizio-eb49a` (reglas abiertas)

Antes de mover nada, revertí temporalmente `shared/firebase-app.js` a
`rodizio-eb49a` (o hacelo en una copia) y probá las 5 apps de mesa + la tienda
con un server local. El menú ya está cargado en `rodizio-eb49a` (Fase 2).
Verificá el flujo completo mesa y el flujo domicilio→cocina.

### 3. Publicar las reglas nuevas en `rodiziomarketplace`

**Coordinar con el compañero** — cambia las reglas de su proyecto.

```bash
firebase use rodiziomarketplace
firebase deploy --only database
```

### 4. Subir el menú real a `rodiziomarketplace`

Pisa los 16 productos genéricos de la semilla vieja (es lo que queremos).

```bash
node scripts/build-menu-data.mjs   # regenera scripts/menu-seed/*.json
firebase database:set /categories             scripts/menu-seed/categories.json
firebase database:set /products               scripts/menu-seed/products.json
firebase database:set /sugerencias            scripts/menu-seed/sugerencias.json
firebase database:set /sugerenciasPorProducto scripts/menu-seed/sugerenciasPorProducto.json
```

### 5. Recrear las cuentas de personal en el Auth de `rodiziomarketplace`

Las cuentas de `/trabajadores` viven en el Auth de `rodizio-eb49a`. Hay 2
(`rodizio`, `maria`) — es más rápido recrearlas a mano que migrar hashes.

Por cada trabajador:
1. Firebase Console (`rodiziomarketplace`) → Authentication → Users → Add user.
   Email `USUARIO@rodizio.local`, una contraseña. Copiá el UID.
2. Realtime Database → `/trabajadores/{ESE_UID}`:
   ```json
   { "nombre": "Nombre", "usuario": "USUARIO", "rolesPermitidos": { "admin": true }, "estado": "activo", "creado": 1725000000000 }
   ```
   (`rolesPermitidos` solo para el admin; los demás no lo llevan.)

> Si preferís migrar en vez de recrear: `firebase auth:import auth-eb49a.json
> --hash-algo=...` con los parámetros de hash del proyecto viejo (Console →
> Auth → ⋮ → Password hash parameters), preservando los UID. Después copiás
> `/trabajadores` del backup de `rodizio-eb49a` a `rodiziomarketplace`.

### 6. Borrar los datos de prueba de `rodiziomarketplace`

```bash
firebase database:remove /orders
firebase database:remove /consents
firebase database:remove /errorLogs
firebase database:remove /cashSettlements
firebase database:remove /driverRatings
# opcional, cuentas de cliente de prueba:
firebase database:remove /users
```
(No borres `/settings` ni `/drivers` si querés conservar el domiciliario real.)

### 7. Deploy

- Reglas: ya en el paso 3.
- Hosting / Functions: falta decidir la topología de sitios (ver Fase 5 en
  `PLAN-FUSION.md`). El `firebase.json` de la raíz solo sirve el sistema de mesas
  hoy.

### 8. Archivar `rodizio-eb49a`

Dejalo de solo lectura (no borrarlo) hasta que el fusionado lleve semanas
estable. Firebase Console → Realtime Database → Reglas → `{ "rules": { ".read": true, ".write": false } }`.
