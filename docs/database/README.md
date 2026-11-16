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
- `0007_delivery_geography_coverage` (F09, `specs/008-delivery-zones-coverage`, ADR-0013; **migración existente, sin aplicar a bases reales;
  requiere aprobación humana**): incremental y no destructiva (solo `CREATE` + seed). No es relanzable el DDL; el seed sí es idempotente.
  - **Tablas**: `departments` y `municipalities` (DBML tal cual + CHECK `name` no vacío y sin espacios en bordes; UNIQUE `name` y
    `(department_id, name)`); `delivery_zones` (DBML + `zone_key`, `version`, `created_at`, `updated_at`); `branch_delivery_settings`
    (PK = `branch_id`, 1:1 con `branches`; defaults `own_delivery_zones_enabled=false`, `pedidosya_enabled=true`; fila ausente = defaults, sin backfill).
  - **`delivery_zones`**: `UNIQUE delivery_zones_branch_municipality_zone_key (branch_id, municipality_id, zone_key)` sobre todas las filas
    (activas e inactivas); `zone_key = ''` representa la cobertura general (zona NULL), por lo que no hay hueco de NULL. CHECK:
    `delivery_zones_base_fee_range` (0..99999.99), `delivery_zones_version_positive`, `delivery_zones_label_key_coherent`,
    `delivery_zones_label_valid` (sin espacios en bordes, 1..60), `delivery_zones_key_normalized` (minúsculas, sin bordes ni espacios
    consecutivos). La BD no calcula `zone_key` (no hay `unaccent` inmutable): lo hace la API (D6). `version`/`updated_at` los mantiene la API (sin triggers).
    El `23505` sobre el UNIQUE se mapea a 409 `DELIVERY_ZONE_DUPLICATE`.
  - **Índices**: el UNIQUE sirve la consulta de cobertura (`zone_key IN (clave, '')`), el listado por sucursal y la FK de `branch_id`;
    `delivery_zones_municipality_idx (municipality_id)` sirve la FK y el filtro por municipio. Sin trigram.
  - **FKs `ON DELETE RESTRICT`** en todas (la sucursal no se borra; el catálogo geográfico tampoco mientras tenga hijos).
  - **RLS/privilegios**: RLS habilitado sin políticas en las 4 tablas + `REVOKE ALL FROM PUBLIC` y, solo si existen, `anon`/`authenticated` (igual que 0006).
  - **Dinero**: `base_fee numeric(12,2)`; en Prisma `Decimal`. Leer/escribir como `Prisma.Decimal`/`::text`, nunca `number`.
  - **Seed** (`ON CONFLICT DO NOTHING`, sin `id` fijos: los UUID son por entorno y se busca por nombre): 22 departamentos y 17 municipios del
    departamento de Guatemala (lista del negocio; cotejar con INE antes de producción). **Pendiente**: municipios de los otros 21 departamentos
    (fuente oficial verificada por una persona; migración posterior).
  - Cierra la brecha B7 (municipio + zona, no radio). No toca RBAC (0005), `customer_addresses` (F05) ni `audit_events`.
    Reversión manual descrita en el encabezado del SQL (eliminar las 4 tablas, sin dependientes hasta F05).
  - Pruebas: `sushimon-api/test/migration-0007.int-spec.ts` (PostgreSQL plano desechable vía `DATABASE_URL_TEST`; se omite sin ella o si
    `auth.users` es la de Supabase real). Los mismos casos (salvo la carrera concurrente, que requiere varias conexiones) se comprobaron
    aplicando 0001..0007 en PGlite 0.4.3 en memoria.
  - **Fuente de verdad**: `docs/references/monsushi_dbdiagram.dbml` NO se edita; la evolución del modelo (columnas y tabla nuevas, `UNIQUE`
    sobre `zone_key`, CHECK) vive en la migración + ADR-0013.
- `0009_customer_favorites` (F06, `specs/010-customer-favorites`, ADR-0015; **migración aplicada por el usuario en su Supabase de pruebas; otros entornos requieren aprobación humana**): incremental y no
  destructiva (solo `CREATE`). `app.customer_favorites (customer_id, product_id, created_at)`: PK `(customer_id, product_id)` (como el DBML), FK a `customers`
  `ON DELETE CASCADE`, **sin FK a `products`** (la tabla no existe en 0001–0007 ni en Prisma; F10/F11 pendientes) y `created_at timestamptz DEFAULT now()` (nuevo respecto al DBML).
  Índice `customer_favorites_customer_created_idx (customer_id, created_at DESC, product_id)` para el listado paginado. RLS habilitado sin políticas + `REVOKE ALL FROM PUBLIC`
  y, solo si existen, `anon`/`authenticated` (igual que 0006/0007). El tope de 200 favoritos por cliente vive en la API (transacción con `FOR NO KEY UPDATE` sobre el cliente), no en CHECK.
  El `product_id` solo se persiste tras validarse con el catálogo: hasta F11 la tabla permanece vacía en entornos reales. **F11** añadirá la FK `NOT VALID` + `VALIDATE`
  con `ON DELETE CASCADE` (el DBML decía sin acción; los productos son soft-delete por `active`) y `customer_favorites_product_idx (product_id)`. El DBML NO se edita.
  Reversión manual: eliminar la tabla `app.customer_favorites` (sin dependientes). Pruebas: `sushimon-api/test/migration-0009.int-spec.ts` (PK/duplicado, `ON CONFLICT`, cascada, plan del índice, RLS/REVOKE y carrera del tope con varias conexiones; PostgreSQL plano desechable vía `DATABASE_URL_TEST`, se omite sin ella o con `auth.users` real). En PGlite 0.4.3 (0001..0009, con `btree_gist`) se comprobaron PK, `ON CONFLICT`, FK y cascada, `Index Only Scan` sin `Sort` con `enable_seqscan=off` y RLS; NO se verificaron REVOKE a `anon`/`authenticated` (roles ausentes) ni la concurrencia (conexión única).
- `0010_revoke_client_roles` (hallazgo M6 de la auditoría F00-F09; **existe en el repo, SIN APLICAR: requiere aprobación humana antes de ejecutarla en cualquier entorno**): no destructiva e idempotente (solo `REVOKE`).
  Revoca `ALL` a `PUBLIC` y, solo si existen, a `anon`/`authenticated` sobre `branches`, `customers`, `staff_users`, `roles`, `permissions`, `role_permissions`, `staff_assignments` y `audit_events`
  (0002/0003/0005 solo activaron RLS sin REVOKE; 0006-0009 ya lo hacían para sus tablas, no se repiten) y, de forma defensiva, sobre las secuencias del esquema `app` (hoy no hay). No toca RLS, datos ni otras migraciones.
  El REVOKE no afecta a la conexión de la API (rol propietario/BYPASSRLS). **Verificación manual pendiente tras aplicarla en Supabase**: (1) la API sigue funcionando (`GET /v1/health/ready`, `GET /v1/me`);
  (2) `SELECT has_table_privilege('anon'|'authenticated', 'app.<tabla>', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')` devuelve `false` para las 8 tablas.
  Reversión manual (no recomendada): `GRANT` explícito a esos roles. Pruebas: `sushimon-api/test/migration-0010.int-spec.ts` (PostgreSQL plano desechable vía `DATABASE_URL_TEST`; se omite sin ella o con `auth.users` real; la aserción de `anon`/`authenticated` se omite si esos roles no existen).
  En PGlite 0.4.3 (0001..0010) se comprobaron: aplicación, idempotencia, RLS intacto, sin entrada ACL para PUBLIC en las 8 tablas y, creando `anon`/`authenticated` con `GRANT ALL` previo, que tras 0010 no queda ningún privilegio. NO se ejecutó el `.int-spec` contra PostgreSQL real ni sobre Supabase.
- `0011_categories` (F10, **propuesta en el repo, SIN APLICAR: requiere aprobación humana antes de ejecutarla en cualquier entorno**): incremental, no destructiva y relanzable (`IF NOT EXISTS`/`OR REPLACE`).
  `app.categories` según el DBML (`id`, `parent_id`, `slug` UNIQUE, `name`, `description`, `sort_order`, `active`) más `created_at`/`updated_at` (nuevos; `updated_at` lo mantiene la API, sin trigger) y CHECK nuevos:
  slug `^[a-z0-9]+(-[a-z0-9]+)*$` y ≤ 80, `btrim(name)` 1..80, descripción ≤ 500, `sort_order >= 0`, `parent_id IS DISTINCT FROM id`. FK `parent_id -> categories(id) ON DELETE RESTRICT`. Índice `categories_parent_sort_idx (parent_id, sort_order, name, id)`.
  Trigger `BEFORE INSERT OR UPDATE OF parent_id` (`app.categories_enforce_hierarchy`): rechaza ciclos (`ERRCODE 23514`, mensaje `categories_parent_cycle`) y profundidad > 3 niveles contando el subárbol (`23514`, `categories_max_depth`), con CTE recursivo acotado a 10 iteraciones.
  **Concurrencia**: el trigger toma `pg_advisory_xact_lock(1100110)` antes de recorrer ancestros; la API debe tomar el MISMO bloqueo (`SELECT pg_advisory_xact_lock(1100110)`) al inicio de su transacción de alta/reparentado, en READ COMMITTED (en REPEATABLE READ/SERIALIZABLE no basta).
  RLS habilitada sin políticas y `REVOKE ALL` a `PUBLIC` y, solo si existen, a `anon`/`authenticated` (tabla y función). El listado de raíces (`parent_id IS NULL`) usa el índice pero requiere un `Sort` trivial. El DBML NO se edita; la desviación se justifica en el ADR de F10.
  Reversión manual (sin dependientes hasta F11): eliminar trigger, función y tabla. Pruebas: `sushimon-api/test/migration-0011.int-spec.ts` (PostgreSQL plano desechable vía `DATABASE_URL_TEST`; se omite sin ella o con `auth.users` real).
  Verificado en PGlite 0.4.3 (0001..0011, reaplicación incluida): CHECK, UNIQUE, ciclo directo/indirecto/auto-padre, profundidad 4 (alta y reparentado de subárbol), RESTRICT, FK, RLS/ACL, REVOKE a `anon`/`authenticated` y plan `Index Only Scan` sin `Sort` para hermanos. NO verificada la concurrencia (PGlite es de una sola conexión) ni el `.int-spec` completo contra PostgreSQL real.
- `0012_products` (F11, **propuesta en el repo, SIN APLICAR: requiere aprobación humana antes de ejecutarla en cualquier entorno**): incremental, no destructiva y relanzable (`IF NOT EXISTS`/`OR REPLACE`/guardas por catálogo); no borra datos.
  `app.products` según el DBML más `updated_at` (nuevo; lo mantiene la API) y CHECK nuevos: `sku` NULL o `^[A-Za-z0-9][A-Za-z0-9._-]*$` ≤ 40 (UNIQUE), slug kebab ≤ 80 (UNIQUE), `btrim(name)` 1..120, descripción ≤ 2000, `0 < base_price <= 999999.99` (`numeric(12,2)`). FK `category_id -> categories(id) ON DELETE RESTRICT`. Índices `(category_id, active, name, id)` y `(active, name, id)`. Sin índice de búsqueda ILIKE: no se crea `pg_trgm` (no garantizado en Supabase); con catálogo pequeño basta seq scan.
  `app.product_media` según el DBML más CHECK: `media_url` `^https://` sin espacios ni control y ≤ 2048, `alt_text` ≤ 200, `sort_order >= 0`; FK `product_id -> products(id) ON DELETE CASCADE`. `UNIQUE (product_id, sort_order) DEFERRABLE INITIALLY DEFERRED` (se evalúa al COMMIT para reordenar/reemplazar en una transacción; consecuencia: `ON CONFLICT` no puede usarla como árbitro, el servicio hace DELETE+INSERT o UPDATE; su índice ya cubre `(product_id, sort_order)`, no se añade otro).
  Tope de 8 imágenes por producto: servicio + trigger de defensa `product_media_limit_trg` (`BEFORE INSERT OR UPDATE OF product_id`; `SELECT ... FOR NO KEY UPDATE` sobre el producto serializa antes de contar; `ERRCODE 23514`, mensaje `product_media_max_items`; exige READ COMMITTED y, al reemplazar la lista, borrar antes de insertar en la misma transacción).
  FK `customer_favorites.product_id -> products(id) ON DELETE CASCADE` (aplazada desde 0009): se añade `NOT VALID` y se ejecuta `VALIDATE CONSTRAINT` solo si no hay favoritos huérfanos; si los hay emite `RAISE NOTICE` y queda NOT VALID (rechaza nuevos huérfanos, conserva los viejos; limpieza manual y `VALIDATE` posterior). Como `products` nace vacía, CUALQUIER favorito existente es huérfano. Añade `customer_favorites_product_idx (product_id)` para la cascada.
  RLS habilitada sin políticas y `REVOKE ALL` a `PUBLIC` y, solo si existen, a `anon`/`authenticated` (ambas tablas y la función). El DBML NO se edita; desviaciones (`updated_at`, CHECK, RESTRICT explícito, UNIQUE aplazable, trigger, FK de favoritos) a anotar en el ADR de F11 (ADR-0017 aún no existe en el repo).
  Reversión manual: quitar FK e índice de favoritos, trigger, función, `product_media`, `products` (en ese orden). Pruebas: `sushimon-api/test/migration-0012.int-spec.ts` (PostgreSQL plano desechable vía `DATABASE_URL_TEST`; se omite con `auth.users` real de Supabase).
  Verificado en PGlite 0.4.3 (0001..0012, reaplicación incluida; script fuera del repo): CHECK de slug/sku/precio (0, negativo, 1e9), URL http/javascript:/espacios/tab/2049 caracteres, UNIQUE sku y sort_order, tope de 8 (trigger), RESTRICT de categoría, cascada de media y de favoritos, FK de favoritos NOT VALID con huérfano previo conservado (y validada en base sin huérfanos), RLS y sin privilegios para `anon`/`authenticated`. NO verificadas con PGlite la concurrencia del trigger ni el `.int-spec` completo contra PostgreSQL real.
- `0013_product_modifiers` (F12, **propuesta en el repo, SIN APLICAR: requiere aprobación humana antes de ejecutarla en cualquier entorno**): incremental, no destructiva y relanzable; no borra datos. Requiere 0012 aplicada (las FKs cruzan hacia `app.products`). NO crea `order_item_modifiers` (F20).
  `app.modifier_groups` (DBML + `active`, `created_at`, `updated_at`): `btrim(name)` 1..80, `0 <= min_select <= max_select <= 20` y `max_select >= 1`; UNIQUE sobre `lower(btrim(name))` (índice de expresión, no expresable en Prisma: el servicio captura 23505).
  `app.modifiers` (DBML + `active`, `sort_order >= 0`, fechas): `group_id -> modifier_groups ON DELETE RESTRICT`, `btrim(name)` 1..80, `extra_price` 0..9999.99, UNIQUE `(group_id, lower(btrim(name)))` y `UNIQUE (group_id, sort_order) DEFERRABLE INITIALLY DEFERRED`. Desviación: no se crea el índice `(group_id, sort_order, name, id)` porque el índice de esa UNIQUE ya sirve el listado ordenado y cubre el FK (name/id nunca desempatan).
  `app.product_modifier_groups` (DBML + `sort_order >= 0`): PK `(product_id, group_id)`, `product_id -> products ON DELETE CASCADE`, `group_id -> modifier_groups ON DELETE RESTRICT`, índice `(group_id)` para el FK, `UNIQUE (product_id, sort_order) DEFERRABLE INITIALLY DEFERRED` (ON CONFLICT no puede usarlas como árbitro; el servicio reordena asignando 0..n-1).
  Topes por trigger de defensa (`BEFORE INSERT OR UPDATE OF <fk>`, `SELECT ... FOR NO KEY UPDATE` sobre el padre antes de contar, `ERRCODE 23514`): 30 opciones por grupo (`modifier_group_max_options`) y 10 grupos por producto (`product_max_modifier_groups`); exigen READ COMMITTED y borrar antes de insertar al reemplazar listas.
  RLS habilitada sin políticas y `REVOKE ALL` a `PUBLIC` y, solo si existen, a `anon`/`authenticated` (tablas y funciones). El DBML NO se edita.
  Reversión manual: triggers, funciones, `product_modifier_groups`, `modifiers`, `modifier_groups` (en ese orden). Pruebas: `sushimon-api/test/migration-0013.int-spec.ts` (PostgreSQL plano desechable vía `DATABASE_URL_TEST`; se omite con `auth.users` real de Supabase).
  Verificado en PGlite 0.4.3 con `btree_gist` (0001..0013, reaplicación incluida; script fuera del repo): CHECK, UNIQUE case-insensitive, UNIQUE aplazable, topes 30/10 (alta y reasignación), RESTRICT, CASCADE, RLS/ACL e índices sin Sort. NO verificadas: concurrencia de los triggers (PGlite es de una sola conexión) ni el `.int-spec` contra PostgreSQL real (se omite sin `DATABASE_URL_TEST`).
  **Orden de despliegue (obligatorio)**: aplicar la 0013 ANTES de desplegar la API de F12. `GET /v1/store/products/{slug}` consulta `app.modifier_groups` y NO captura ese error (decisión consciente: un fallo de BD no se oculta como «sin extras»); con la API nueva y sin la 0013 la ficha pública responde 500. Revertir la API es seguro; la 0013 es solo aditiva. `/v1/health/ready` no cambia. Incluir esta nota en el PR de F12.
- `0014_branch_products` (F13, **propuesta en el repo, SIN APLICAR: requiere aprobación humana antes de ejecutarla en cualquier entorno**): incremental, no destructiva y relanzable; no borra datos. Requiere 0003 y 0012 aplicadas. Crea `app.branch_products` (PK `(branch_id, product_id)`, `price_override numeric(12,2)` NULL con CHECK `NULL OR (0 < p <= 999999.99)`, `available boolean NOT NULL DEFAULT true`, `created_at`/`updated_at`; FKs `ON DELETE RESTRICT` a `branches` y `products`; RLS sin políticas + REVOKE a PUBLIC/`anon`/`authenticated` guardado por existencia de rol).
  Semántica: **ausencia de fila = disponible al precio base**; la API elimina la fila al volver al estado por defecto (sin trigger de "fila por defecto"); sin stock numérico; no sustituye `products.active`. Índices: la PK sirve las consultas por sucursal; `branch_products_product_idx (product_id)` sirve al FK y a la consulta por producto; NO se crea `(branch_id, available)` (tabla acotada a excepciones, 3-5 sucursales; reevaluar si crece). Desviaciones respecto al DBML (sin editarlo): `created_at`/`updated_at` añadidos (`updated_at` lo mantiene la API), CHECK de rango, FKs con acción explícita.
  Reversión manual: eliminar la tabla `app.branch_products` (solo sin datos que conservar). Pruebas: `sushimon-api/test/migration-0014.int-spec.ts` (PostgreSQL plano desechable vía `DATABASE_URL_TEST`; se omite con `auth.users` real de Supabase).
  Verificado en PGlite 0.4.3 con `btree_gist` (0001..0014, reaplicación incluida; script fuera del repo): CHECK (NULL, 0.01, 999999.99 válidos; 0, negativo, 1000000 rechazados), PK compuesta, FK, RESTRICT desde `branches` y `products`, RLS y 0 privilegios PUBLIC, recorrido por índice por sucursal (PK) y por producto (`branch_products_product_idx`) con `enable_seqscan=off`. El `.int-spec` se omitió (8 omitidas) en este entorno: no hay PostgreSQL plano utilizable. REVOKE a `anon`/`authenticated` no verificado (esos roles no existen en PGlite).
  **Orden de despliegue**: aplicar la 0014 ANTES de desplegar la API de F13; sin `app.branch_products`, `GET /v1/store/menu` responde 500 (no se captura el error ni se toca `/v1/health/ready`). Línea para el PR: «Despliegue: aplicar la migración 0014_branch_products antes de desplegar la API.»
- `0015_media_assets` (F14, **propuesta en el repo, SIN APLICAR: requiere aprobación humana antes de ejecutarla en cualquier entorno**): incremental, no destructiva y relanzable. Requiere 0002 y 0012. Crea `app.media_assets` (tabla nueva, no está en el DBML): `kind` CHECK `('PRODUCT_IMAGE')` (ampliarlo exige migración), `object_key` UNIQUE con CHECK `^[a-z0-9][a-z0-9/_.-]*$`, sin `..` ni `//`, <= 200; `bucket` 1..63; `mime_type` en `image/jpeg|png|webp|avif`; `size_bytes` 1..5242880 (tope de 5 MiB como defensa en BD: **subirlo exige migración**); `checksum_sha256` hex de 64 en minúsculas; `status` `PENDING|READY` con coherencia (`READY` => `confirmed_at`, `PENDING` => `expires_at`); `created_by_staff_id` FK a `staff_users` `ON DELETE SET NULL`. Dedup: UNIQUE parcial `(kind, checksum_sha256) WHERE status='READY'` (varios PENDING iguales son válidos; el segundo READY recibe 23505). Índices: parcial `(status, expires_at) WHERE status='PENDING'` (purga), `(created_at DESC, id)` (listado admin). Añade `app.product_media.asset_id` (NULL, FK a `media_assets` `ON DELETE RESTRICT`, índice `(asset_id)`); `media_url` sigue NOT NULL/https; un asset puede estar en varias filas. RLS sin políticas + REVOKE a PUBLIC/`anon`/`authenticated` guardado por existencia de rol.
  Reversión manual: quitar FK `product_media_asset_id_fkey`, índice `product_media_asset_idx` y columna `asset_id`; luego eliminar la tabla `app.media_assets` (solo sin datos que conservar; los objetos en R2 no se tocan). Pruebas: `sushimon-api/test/migration-0015.int-spec.ts` (PostgreSQL plano desechable vía `DATABASE_URL_TEST`; se omite con `auth.users` real).
  Verificado en PGlite 0.4.3 con `btree_gist` (0001..0015, reaplicación incluida; script fuera del repo, 57 aserciones, 0 fallos): CHECKs de clave/kind/mime/bucket/tamaño/checksum/status/coherencia, UNIQUE de `object_key`, UNIQUE parcial solo entre READY (también al confirmar un PENDING duplicado), SET NULL de `created_by_staff_id`, RESTRICT desde `product_media`, recorrido por índice (purga, listado, `asset_id`) con `enable_seqscan=off`, RLS y 0 privilegios PUBLIC. El `.int-spec` se omitió (12 omitidas) por no haber `DATABASE_URL_TEST`. REVOKE a `anon`/`authenticated` no verificado (esos roles no existen en PGlite).
  **Orden de despliegue**: aplicar la 0015 ANTES de desplegar la API de F14.
- `0016_promotions` (F15, `specs/016-promotions-happy-hour`, ADR-0021; **propuesta en el repo, SIN APLICAR: requiere aprobación humana antes de ejecutarla en cualquier entorno**): incremental, no destructiva y relanzable (`IF NOT EXISTS`; una guarda inicial falla con mensaje claro si alguna de las 4 tablas ya existe con otra definición, sin modificar nada). **Crea** `app.promotions`, `promotion_branches`, `promotion_products` y `promotion_weekdays` (las 0001–0015 no las crean; `order_promotions` queda para F20 con `orders`). Requiere 0003, 0006 (`btree_gist`) y 0012.
  `promotions`: columnas del DBML más `description`, `version`, `created_at`, `updated_at`; `code` UNIQUE nullable (`NULL` = automática, `NOT NULL` = cupón; varias filas `NULL` permitidas) con CHECK `^[A-Z0-9][A-Z0-9_-]{2,31}$` (UNIQUE insensible a mayúsculas); `kind` CHECK `PERCENT|FIXED_AMOUNT`; `value` `numeric(12,2)` con `PERCENT` 0<v<=100 y `FIXED_AMOUNT` 0<v<=999999.99 (por unidad); `ends_at > starts_at`; `name` 1..120 (tras `btrim`), `description` <= 500, `version >= 1`; índice parcial `promotions_active_window_idx (ends_at, starts_at) WHERE active`.
  `promotion_branches`/`promotion_products`: PK compuesta, FK a `promotions` `ON DELETE CASCADE`, FK a `branches`/`products` `ON DELETE RESTRICT ON UPDATE CASCADE`, índices `promotion_branches_branch_idx (branch_id, promotion_id)` y `promotion_products_product_idx (product_id, promotion_id)`. Sin filas = todas las sucursales/productos (el contrato exige declararlo).
  `promotion_weekdays`: PK `(promotion_id, weekday, starts_at)`, `weekday` 1–7 (convención F08), `starts_at < ends_at` (`24:00` solo como fin; no cruza la medianoche), granularidad de minuto y `EXCLUDE gist (promotion_id, weekday, tsrange(2000-01-01 + starts_at, 2000-01-01 + ends_at, '[)'))` contra solapes (contiguos permitidos), como `branch_hours`; sin filas = sin restricción semanal.
  RLS habilitado sin políticas + `REVOKE ALL` a `PUBLIC` y a `anon`/`authenticated` (guardado por existencia de rol). Sin triggers: `version` y `updated_at` los mantiene la API. Modelos Prisma `Promotion`, `PromotionBranch`, `PromotionProduct`, `PromotionWeekday` (el índice parcial y el `EXCLUDE` solo existen en SQL).
  Reversión manual (solo sin datos que conservar y sin `order_promotions` apuntando a ellas): eliminar las 4 tablas en el orden `promotion_weekdays`, `promotion_products`, `promotion_branches`, `promotions`. Pruebas: `sushimon-api/test/migration-0016.int-spec.ts` (PostgreSQL plano desechable vía `DATABASE_URL_TEST`; se omite con `auth.users` real). **Orden de despliegue**: aplicar la 0016 ANTES de desplegar la API de F15.
  Verificación: `prisma validate` y `prisma generate` OK; el SQL y el `.int-spec` NO se han ejecutado contra ningún PostgreSQL (sin `psql`, Docker ni `DATABASE_URL_TEST` en el entorno de redacción): pendiente de ejecutarlos en un PostgreSQL plano desechable.
- `0017_banners` (F16, `specs/017-banners-campaigns`, ADR-0022; **propuesta en el repo, SIN APLICAR: requiere aprobación humana antes de ejecutarla en cualquier entorno**): incremental, no destructiva y relanzable (guarda por catálogo: si una tabla existe con otra definición falla con mensaje claro y no reescribe). Requiere 0003, 0005, 0011, 0012, 0015 y 0016. El DBML NO se edita (no contempla banners; desviación justificada en ADR-0022).
  `app.banners`: `code` UNIQUE con CHECK de formato (`^[a-z0-9][a-z0-9-]{2,63}$`; la inmutabilidad la impone la API, sin trigger), `image_asset_id` NOT NULL FK `RESTRICT` a `media_assets`, CTA estructurado (`cta_type` cerrado; FK `RESTRICT` a `categories`/`products`; CHECK «la referencia existe si y solo si el tipo la usa»; `cta_page` en lista blanca `CAREERS|TRACK_ORDER|INCIDENTS`; sin `EXTERNAL` ni `cta_url`), `promotion_id` FK `RESTRICT` opcional, `starts_at`/`ends_at` opcionales con `ends_at > starts_at`, `sort_order` 0..9999 NO único (desempate `created_at, id`), `version >= 1`. Estados derivados, nunca columnas. Índices: `banners_active_order_idx (sort_order, created_at, id) WHERE active`, `banners_image_asset_idx`, `banner_branches_branch_idx (branch_id, banner_id)`.
  `app.banner_translations` (PK `(banner_id, locale)`, `es|en`, textos recortados no vacíos con tope 80/160/40/200; la fila `es` exige `title` e `image_alt` por CHECK; su existencia y la coherencia `branchScope`/filas las impone el servicio) y `app.banner_branches` (ausencia de filas = todas las sucursales; hijas -> banners `CASCADE`, -> branches `RESTRICT`).
  `media_assets` (F14): `media_assets_kind_chk` pasa a `('PRODUCT_IMAGE','BANNER_IMAGE')` (solo si aún no lo admite), `media_assets_key_prefix_chk` (`PRODUCT_IMAGE` con `products/`, `BANNER_IMAGE` con `banners/`; falla con claridad si una fila existente no cumple, sin reescribir) y `media_assets_banner_size_chk` (1 MiB solo para banners; el genérico de 5 MiB no cambia). Permisos `banners.read|create|update` (catálogo 43 -> 46) asignados SOLO a `admin` (`ON CONFLICT DO NOTHING`, invariante «admin tiene todo»). RLS habilitada sin políticas y `REVOKE ALL` a `PUBLIC` y, solo si existen, a `anon`/`authenticated`.
  Reversión manual (solo sin datos): eliminar las tablas `banner_translations`, `banner_branches`, `banners` (en ese orden); si no hay assets `BANNER_IMAGE`, quitar `media_assets_kind_chk`, `media_assets_banner_size_chk` y `media_assets_key_prefix_chk` y recrear el kind con solo `PRODUCT_IMAGE`; borrar los 3 permisos (y sus `role_permissions`). Pruebas: `sushimon-api/test/migration-0017.int-spec.ts` (PostgreSQL plano desechable vía `DATABASE_URL_TEST`; se omite con `auth.users` real; aplica 0001..0016 con una fila `PRODUCT_IMAGE` previa y luego 0017). **Orden de despliegue**: aplicar la 0017 ANTES de desplegar la API de F16 (sin ella `GET /v1/store/banners` responde 500).
  Verificación: `prisma validate`, `prisma generate`, `tsc --noEmit`, ESLint y Prettier OK. Smoke del SQL en PGlite 0.4.3 (script fuera del repo; 0001..0016 + fila `PRODUCT_IMAGE` de 4 MiB + 0017 aplicada DOS veces sin error): rechazados con 23514 el banner de 1 MiB + 1 byte, el prefijo cruzado, `code` con mayúsculas, `CATEGORY` sin referencia, `PAGE` fuera de lista, periodo invertido, `sort_order` 10000 y fila `es` sin título; 23503 al borrar un asset en uso; 46 permisos y los 3 nuevos solo en `admin`. NO verificado: el `.int-spec` completo (sin `psql`, PostgreSQL ni `DATABASE_URL_TEST` en el entorno de redacción), el REVOKE a `anon`/`authenticated` (PGlite no tiene esos roles), los índices con `EXPLAIN`, ni su aplicación a Supabase.
