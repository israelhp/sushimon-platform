# F07 — Gestión de sucursales

**Rama**: `feature/F07-branches-management` (apilada sobre `feature/F02-backoffice-mfa`: F01/F02 aún no están en `develop`)
**Prioridad**: P0 · **Dependencias**: F00, F01, F02 · F03 (RBAC) **no disponible** · **Estado**: `CONTRACT_DEFINED`

## Alcance

Identidad y configuración básica de sucursales (`app.branches`) y su estado ADMINISTRATIVO (`active`).
Fuera: horarios/cierres/abierto-ahora (F08), zonas/cobertura/tarifas (F09), productos y precios (F13),
`/v1/store/bootstrap` (F17), estadísticas (F33), cancelación de pedidos (F20/F22).

## Endpoints (contrato: `packages/contracts/openapi/openapi.yaml`)

Públicos: `GET /v1/branches`, `GET /v1/branches/{id}`.
Admin (`@RequireStaff('branches')`: JWT → personal activo + permiso → aal2):
`GET|POST /v1/admin/branches`, `GET|PATCH /v1/admin/branches/{id}`, `PATCH /v1/admin/branches/{id}/status`.
Sin `DELETE` (integridad histórica): se desactiva con `active=false`.

## Decisiones

- **D1 Permisos**: el catálogo vigente (F01) solo tiene `branches`. Se usa para todas las operaciones admin. La división
  `branches.read/create/update` propuesta requiere migrar el catálogo y los roles: es de F03 (coordinar; no se toca aquí).
- **D2 Alcance por sucursal** (desde la BD, `StaffContext`): listado filtrado a `allBranches` o `branchIds`; detalle/PATCH/status
  fuera de alcance → 404 (no revela existencia); **crear** exige `allBranches` (alta global) → 403 si no.
- **D3 Estados distintos**: `active` (administrativo, F07) ≠ abierto por horario (F08) ≠ pausa operativa. La API NO expone
  `isOpenNow` ni `isAcceptingOrders`. **Pausa temporal**: no existe en el modelo; usar `active` la confundiría. Propuesta para F08:
  `branch_closures` con cierre manual/pausa con vigencia, y `isAcceptingOrders = active && abierto && !pausa`, calculado en un único
  servicio que checkout (F20) consuma.
- **D4 `code`**: se normaliza (trim + minúsculas), `^[a-z0-9]+(-[a-z0-9]+)*$`, 2–40; único (UNIQUE + 409 ante P2002, sin
  chequeo previo racy); **inmutable** tras la creación (PATCH con `code` → 400).
- **D5 Coordenadas**: ambas o ninguna; lat ±90, lon ±180; `numeric(10,7)` (CHECK en BD); sin valores ficticios.
- **D6 Estado**: desactivar exige `reason`; idempotente (sin escritura ni auditoría si no hay cambio). No cancela pedidos, no borra
  empleados/productos/repartidores. Política de pedidos en curso: **pendiente F20/F22** (hoy no existe la tabla `orders`).
- **D7 Auditoría**: `app.audit_events` (DBML) se crea con la migración 0003 (F36 la ampliará); se escribe en la MISMA transacción
  que el cambio, solo con diff real (old/new de los campos modificados).
- **D8 Caché**: público `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`; admin `no-store`. La API no
  puede purgar la CDN: la invalidación es por expiración. Con `s-maxage=300` + `stale-while-revalidate=600` una CDN que lo
  respete puede servir datos obsoletos hasta ~15 min (+60 s en el navegador) tras activar/desactivar (sin verificar contra el
  proveedor de despliegue, aún por definir). **Regla**: checkout/pedidos (F20) y cualquier validación usan
  `BranchesQueryService.existsActive` contra la BD, NUNCA datos cacheados de `/v1/branches`. F17 debe llamar a `listPublic()`
  una vez (sin N+1 por sucursal). En el cliente se invalidan las claves de TanStack Query.
- **D9 Sin tope de sucursales** en BD/API (el "5" del prototipo es una decisión comercial pendiente; la UI no lo impone).
- **D10 Migración 0003** (incremental, no destructiva): columnas `address`, `latitude`, `longitude`, `active`, `created_at`, tabla
  `audit_events`. Filas preexistentes (si las hay) reciben `address=''` y la restricción de no vacío se agrega `NOT VALID`
  (rige para filas nuevas/modificadas; se debe completar la dirección antes de validarla).

## Endurecimiento tras la revisión de seguridad

- **A1 Alcance por permiso**: el alcance de `branches` se calcula en `BranchScopeService` desde la BD con SOLO las asignaciones
  activas cuyo rol contiene ese permiso (`branch_id` NULL = todas). No se usa `StaffContext.allBranches/branchIds`, que mezcla roles:
  un rol sin `branches` con alcance global no amplía el de otro rol. Una consulta por solicitud.
- **M1**: update/status leen la fila con `SELECT ... FOR UPDATE` dentro de la transacción (sin lost updates ni doble auditoría);
  el par de coordenadas se valida sobre el valor bloqueado.
- **M2**: violaciones CHECK (P2004/23514) → 400 genérico; UNIQUE → 409 solo si es el de `code`.
- **M3 (migración 0004, NO aplicada)**: trigger que hace `app.audit_events` solo-añadir (UPDATE/DELETE lanzan excepción). Un DELETE
  se permite únicamente con `SET LOCAL app.allow_audit_cleanup = 'on'` en la transacción: lo usa solo `cleanupTestData`. Protege
  frente a bugs/cuentas de aplicación; no frena a un propietario que desactive el trigger (roles mínimos: F36).
- **M4**: `page` ≤ 1 000 000; la API rechaza además parámetros repetidos y cuerpos con `__proto__` (400).
- **B2**: `Cache-Control: no-store` en toda respuesta bajo `/v1/admin` (middleware por prefijo, incluye 401/403).
- **D10 (aviso)**: las filas legadas de `app.branches` (code libre, `address=''`) deben sanearse ANTES de
  `VALIDATE CONSTRAINT branches_code_format / branches_name_not_blank / branches_address_not_blank`; hasta entonces los CHECK
  `NOT VALID` solo rigen para filas nuevas o modificadas (un UPDATE de una fila legada inválida fallará con 400).

## Pendiente / dependencias

F03: integrar permisos granulares y roles de gerente por sucursal. F08: estado por horario y pausa. F09: cobertura. F13: precios.
F17: reutilizar `BranchesQueryService`. F20/F22: política para pedidos en curso al desactivar.
