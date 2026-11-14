# Base de datos

**Línea base**: `docs/references/monsushi_dbdiagram.dbml` (PostgreSQL, esquema `app`, `auth.users` de Supabase).
Inmutable. Estado: ✅ analizada · 📐 sin migraciones · sin base de datos conectada.

El DBML advierte que **CHECK e índices parciales no están expresados**: deben implementarse en migraciones SQL.

## Inventario (45 tablas = `auth.users` + 44 en `app`)

| Dominio          | Tablas                                                                                                                  | Pantallas relacionadas (prototipos)            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Sucursales       | `branches`, `branch_hours`, `branch_closures`                                                                           | Sucursales (BO); selector de sucursal (tienda) |
| Cobertura        | `departments`, `municipalities`, `delivery_zones`                                                                       | Sucursales (BO); dirección/checkout            |
| Clientes         | `customers`, `customer_addresses`, `customer_favorites`                                                                 | Mi cuenta, Mis direcciones, Favoritos          |
| Staff y permisos | `staff_users`, `roles`, `permissions`, `role_permissions`, `staff_assignments`                                          | Usuarios (BO)                                  |
| Catálogo         | `categories`, `products`, `product_media`, `branch_products`, `modifier_groups`, `modifiers`, `product_modifier_groups` | Productos, Categorías (BO); Menú               |
| Promociones      | `promotions`, `promotion_branches`, `promotion_products`, `promotion_weekdays`                                          | Promociones (BO); Happy Hour                   |
| Pedidos          | `orders`, `order_addresses`, `order_items`, `order_item_modifiers`, `order_promotions`, `order_status_history`          | Pedidos, Detalle (BO); Checkout, Seguimiento   |
| Pagos            | `payment_methods`, `payments`, `refunds`                                                                                | Checkout (Neonet simulado)                     |
| Entregas         | `riders`, `deliveries`, `delivery_status_history`                                                                       | Entregas, Despachar (BO)                       |
| Incidencias      | `incident_types`, `incidents`, `incident_items`, `incident_updates`                                                     | Reclamos (tienda)                              |
| Transversal      | `notifications`, `audit_events`                                                                                         | Reportes/auditoría                             |
| RR. HH.          | `job_applications`                                                                                                      | Trabaja con nosotros                           |

Detalle de brechas y propuestas: [`schema-gap-analysis.md`](./schema-gap-analysis.md).

## Reglas

Ver `.claude/rules/database.md` y skill `database-integrity`. Ninguna migración se aplica a bases reales
desde el agente; las propuestas pasan por ADR + revisión humana.

## Migraciones versionadas (`sushimon-api/prisma/migrations`)

- `0003_branches_management` (F07, propuesta sin aplicar a bases reales): amplía `branches` (`address`, `latitude`,
  `longitude`, `active`, `created_at`), crea `audit_events` (DBML) con RLS, CHECK e índices. `code`, `name` y
  `address` se restringen con CHECK `NOT VALID` (filas previas a F07 no se rechazan; validar tras sanear con
  `VALIDATE CONSTRAINT`). `audit_events.actor_id` no tiene FK a `staff_users` (el historial no debe bloquear ni
  perderse con el empleado); `branch_id` es `ON DELETE RESTRICT`. Brecha conocida: `audit_events` no es
  append-only a nivel BD (sin trigger que impida UPDATE/DELETE); pendiente para F36.
- `0005_staff_rbac` (F03, ADR-0010, **propuesta sin aplicar; requiere aprobación humana**): añade `roles.is_system`
  (solo `admin`), `staff_users.created_at/linked_at/created_by` (+ CHECK `linked_at` requiere `auth_user_id`), el rol
  `staff`, 43 permisos `modulo.accion`, remapea `role_permissions` desde los gruesos y **borra 9 filas** de
  `permissions` (`orders.accept` se conserva: está en el catálogo nuevo; el ADR habla de 10). Aborta con `RAISE` si hay
  asignaciones `branch_id NULL` con rol distinto de `admin`, o `admin` con sucursal, o si el remapeo queda incompleto.
  Trigger `staff_assignments_admin_global_guard` impone «branch_id NULL <=> admin». Índices: `staff_assignments(branch_id)
WHERE active`, `role_permissions(permission_id)`, `lower(full_name)`, `created_by`, `created_at`. No toca `audit_events`
  (sigue append-only por 0004). Impacto: filas previas de `staff_users` reciben `created_at = now()` y `linked_at` NULL.
  Orden: aplicar 0005 y desplegar la API de F03 juntas (la API anterior consulta permisos gruesos que dejan de existir),
  y **antes** de `staff:bootstrap`. Probar antes contra una copia desechable. Reversión manual descrita en el encabezado
  del SQL.
- `0006_branch_hours_closures` (F08, `specs/007-branch-hours-closures`, **propuesta sin aplicar; requiere aprobación
  humana**): migración incremental y no destructiva (solo `CREATE`); no toca `branches.manage_hours` ni roles de 0005.
  - **Extensión `btree_gist`** (`CREATE EXTENSION IF NOT EXISTS`, en el esquema `extensions` si existe, p. ej. Supabase):
    necesaria para los `EXCLUDE`. Es contrib estándar y Supabase la ofrece (según su documentación; **no verificado
    contra el proyecto real**: nada se aplicó). Si no se aprueba, alternativa: quitar ambos `EXCLUDE` y confiar en la
    verificación de la API bajo `SELECT … FOR UPDATE` de la fila de la sucursal (D5/D7), que no protege escrituras
    fuera de la API.
  - **`app.branch_hours`** (PK `(branch_id, weekday, opens_at)` como el DBML; `opens_at/closes_at` son `time(0)`): FK a
    `branches` `ON DELETE RESTRICT` (la sucursal no se borra; el horario es configuración). CHECK
    `branch_hours_weekday_iso` (1..7), `branch_hours_opens_before_closes` (`opens_at < closes_at`, estricto) y
    `branch_hours_minute_granularity` (segundos = 0; la API solo maneja `HH:mm`). `EXCLUDE branch_hours_no_overlap`
    sobre `(branch_id =, weekday =, tsrange(2000-01-01 + opens_at, 2000-01-01 + closes_at, '[)') &&)`: sin solapes,
    contiguos permitidos. Sin índices extra (la PK y el índice gist cubren las lecturas).
  - **`app.branch_closures`**: `id uuid default gen_random_uuid()`, FK `RESTRICT` (historial), CHECK
    `branch_closures_ends_after_starts` (`ends_at > starts_at`), `branch_closures_reason_valid` (NULL, o no vacío tras
    `btrim` y `char_length <= 200`), `EXCLUDE branch_closures_no_overlap (branch_id =, tstzrange(starts_at, ends_at,
'[)') &&)`. Índice `branch_closures_branch_starts_idx (branch_id, starts_at, ends_at)`: sirve listado por sucursal
    ordenado por fecha, «cierre vigente/próximo» (en PGlite el plan fue `Index Only Scan`) y el chequeo de la FK; no
    hay más índices.
  - **Convención ISO**: `weekday` 1=lunes … 7=domingo (nunca `Date.getDay()`).
  - **Medianoche y 24:00**: intervalos semiabiertos `[opens, closes)`. No hay cruce de medianoche (estrategia B de
    D4): un turno nocturno se guarda partido (vie `18:00-24:00` + sáb `00:00-02:00`). `closes_at = 24:00:00` es válido y
    PostgreSQL lo conserva (`'24:00'::time(0)::text = '24:00:00'`); `opens_at = 24:00` es imposible por el CHECK.
    El `EXCLUDE` usa `tsrange` sobre una fecha fija porque PostgreSQL no tiene `timerange`.
  - **Prisma y 24:00**: `BranchHour.opensAt/closesAt` son `DateTime @db.Time(0)`, que no representa 24:00. El
    adapter `pg` entrega el `time` como texto al motor de Prisma, que lo convierte a `DateTime`; el comportamiento con
    `24:00:00` **no está verificado contra una BD** y no debe asumirse. Mapeo seguro para el repositorio: leer con
    `$queryRaw` (`opens_at::text`, `closes_at::text`) y escribir con `$executeRaw` (`$1::time`), sin usar
    `findMany`/`create` tipados sobre `BranchHour`. `BranchClosure` (timestamptz) sí puede usar el cliente tipado.
  - **RLS/privilegios**: `ENABLE ROW LEVEL SECURITY` sin políticas en ambas tablas (acceso solo por la API), igual que
    0002/0003/0005. **Decisión nueva**: ninguna migración previa emite `REVOKE`; 0006 añade `REVOKE ALL … FROM PUBLIC`
    y, solo si los roles existen en `pg_roles` (en PostgreSQL plano no existen y se omite), `REVOKE ALL … FROM anon,
authenticated`, porque en Supabase los privilegios por defecto sobre tablas nuevas pueden dejarlos con permisos y RLS
    sería la única barrera. No se tocan propietario ni `service_role`/`postgres`. Las tablas previas (0002/0003/0005)
    siguen sin REVOKE: brecha pendiente de decidir si se replica. **Verificaciones manuales pendientes en Supabase**:
    (1) que el esquema `app` NO esté en «Exposed schemas» de PostgREST; (2) que la conexión Prisma (`DIRECT_URL`/pooler)
    sea propietaria de las tablas o tenga `BYPASSRLS`; si no, RLS sin políticas haría que la API viera 0 filas.
  - **Violaciones de EXCLUDE** devuelven SQLSTATE `23P01` (`exclusion_violation`), distinto de `23514` (CHECK): la API
    debe mapear `branch_closures_no_overlap` a 409 `CLOSURE_OVERLAP` y `branch_hours_no_overlap` a 422.
  - **No se hizo**: sin `cancelled_at` ni borrado lógico de cierres (D8); sin zona horaria por sucursal (horas de pared
    de America/Guatemala, UTC-6 sin DST; el cálculo «abierto ahora» es de la API); sin límite de duración (366 días),
    de antelación (2 años) ni «`ends_at` > ahora al crear» en BD (reglas de la API; un CHECK con `now()` no es estable).
  - Pruebas: `sushimon-api/test/migration-0006.int-spec.ts` (PostgreSQL plano desechable vía `DATABASE_URL_TEST`; se
    omite sin ella o si hay Supabase real). Las mismas restricciones se comprobaron aplicando 0001..0006 en PGlite
    0.4.3 en memoria. Reversión manual descrita en el encabezado del SQL.
