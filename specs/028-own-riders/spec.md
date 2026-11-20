# F27 — Motoristas propios y disponibilidad

**Rama**: `feature/F27-own-drivers` (desde `develop` con F24) · **Dueño**: B · **Prioridad**: P0 · **Tipo**: API + WEB (motoristas propios en el backoffice)
**Dependencias**: F07 (sucursales), F03 (RBAC granular, aal2, alcance por sucursal) · **Integración**: F09 (`ownDeliveryZonesEnabled`, solo lectura), F36/`AuditService` · **Integración posterior**: F28 (entregas propias; consume `RiderEligibilityService` y reemplaza el adaptador del puerto), F30/F33 (tarjeta de motoristas agregada) · **Decisiones**: `docs/adr/0031-repartidores-propios.md` · **Pendientes**: P92–P103 en `docs/business-rules/decisiones-pendientes.md`
**Estado de integración inicial: `CONTRACT_DEFINED`** (operaciones `listAdminRiders`, `createAdminRider`, `getAdminRider`, `updateAdminRider`, `updateAdminRiderStatus`, `updateAdminRiderAvailability` y esquemas `AdminRider`, `AdminRiderSummary`, `AdminRiderPage`, `CreateRiderRequest`, `UpdateRiderRequest`, `UpdateRiderStatusRequest`, `UpdateRiderAvailabilityRequest`, `RiderVehicleType`, `RiderAvailability`, `RiderAvailabilityFilter`, `RiderOperationalState` en `openapi.yaml`, tag `admin-riders`; sin migración aplicada, API ni web). `pnpm contracts:generate` ejecutado; `pnpm contracts:check` queda rojo SOLO por esas 6 operaciones sin implementar (igual que F24). Estado de la feature en el backlog: no se edita aquí. PedidosYa: `BLOCKED_EXTERNAL`/fuera de alcance. La feature solo pasa a `READY` con código real, BD, seguridad, web y pruebas.

> **Nomenclatura oficial** (backlog y DBML): tabla `app.riders`, rutas `/v1/admin/riders`, permisos `riders.read|create|update|assign`. No se usa «drivers» en ningún nombre público.

## 1. Alcance y fuera de alcance

Dentro:

- **API**: CRUD administrativo de motoristas propios por sucursal (listar, detalle, alta, edición con traslado de sucursal, activar/desactivar, disponibilidad manual) con paginación, filtros y orden.
- **Datos**: migración 0021 aditiva (`app.riders`, CHECKs, `UNIQUE(phone)`, índices, trigger de guarda, RLS sin políticas + REVOKE).
- **Servicio reutilizable** `RiderEligibilityService` (lectura de elegibilidad para F28) y puerto `RiderActiveDeliveriesPort` con adaptador por defecto «sin entregas».
- **Auditoría** `rider.created|updated|activated|deactivated|availability_changed|branch_changed` en la misma transacción, sin PII.
- **Backoffice (web)**: sección Motoristas (§12).

Fuera (ver §17 «Qué NO hace F27»): asignación de pedidos, entregas y su historial, cobro/efectivo/rendición del motorista, GPS/ubicación, documentos, fotos, turnos, notificaciones, PedidosYa (F29), cuentas de Google/Auth para motoristas, uso de `staff_users` como riders y activación de `ownDeliveryZonesEnabled`.

Reutiliza SIN cambiar su comportamiento: `@RequireStaff` (aal2, permiso por operación, `grants` por sucursal), `AuditService.record(tx, …)`, filtro global de errores (`code`, `current`), `DbGate` (`common/concurrency`), throttler (`common/throttle`), patrón de paginación `page/pageSize/total` de F03/F09 y de `expectedVersion` de F09/F15, `BranchDeliverySettings` de F09 (solo lectura).

## 2. Modelo de datos y migración 0021

Evolución del DBML con migración + ADR (el DBML de referencia no se edita). `app.riders` no existe aún en las migraciones (última: `0020_payments_hash_not_null`). Numeración: la siguiente libre tras `git fetch` y revisar `origin/develop` (provisional `0021_own_riders`). NO se crea `app.deliveries` (F28).

### 2.1 Diseño (resumen)

- Columnas del DBML (`id, branch_id, full_name, phone, vehicle_type, license_plate, active`) + `name_key` (búsqueda y orden sin acentos, calculada por la API), `availability` (manual), `version`, `created_at`, `updated_at`.
- **`UNIQUE(phone)`** global: una persona = un registro; traslado = cambio de `branch_id`.
- **`active = false ⇒ availability = 'UNAVAILABLE'`** (CHECK): un inactivo jamás es asignable.
- `version` obligatoria y monótona (trigger): detecta escrituras que olvidan subirla.
- Sin `DELETE` (trigger): la baja es desactivar. Sin FK a `staff_users`, sin cuentas de Auth.
- `branch_id` apunta a `branches` (`ON DELETE RESTRICT`); el trigger exige sucursal destino ACTIVA al insertar o mover.

### 2.2 DDL propuesto (database-engineer implementa; aquí la referencia)

```sql
-- 0021 · F27 motoristas propios (specs/028-own-riders §2, ADR-0031). CREA app.riders. Aditiva: solo CREATE.
-- Relanzable (IF NOT EXISTS, CREATE OR REPLACE, trigger guardado por catálogo). Guarda inicial como 0018/0019: si app.riders
-- ya existe con otra definición (falta columna o restricción esperada) => RAISE EXCEPTION sin modificar nada. Requiere 0003 (branches).
-- Reversión manual (destructiva; solo si no hay motoristas que conservar; aprobación humana):
--   DROP TABLE app.riders; DROP FUNCTION app.riders_guard();

CREATE TABLE IF NOT EXISTS "app"."riders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,                       -- añadida: nombre sin acentos, minúsculas, espacios colapsados (la API la calcula)
    "phone" TEXT NOT NULL,
    "vehicle_type" TEXT,
    "license_plate" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "availability" TEXT NOT NULL DEFAULT 'UNAVAILABLE',   -- añadida: manual; BUSY NO existe aquí (derivado de F28)
    "version" INTEGER NOT NULL DEFAULT 1,           -- añadida: concurrencia optimista
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "riders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "riders_phone_key" UNIQUE ("phone"),
    CONSTRAINT "riders_branch_id_fkey" FOREIGN KEY ("branch_id")
        REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "riders_phone_chk" CHECK ("phone" ~ '^\+502[0-9]{8}$'),
    CONSTRAINT "riders_name_chk" CHECK (char_length(btrim("full_name")) BETWEEN 2 AND 80
        AND "full_name" = btrim("full_name") AND "full_name" !~ '[[:cntrl:]]' AND btrim("name_key") <> ''),
    CONSTRAINT "riders_vehicle_chk" CHECK ("vehicle_type" IS NULL
        OR "vehicle_type" IN ('MOTORCYCLE', 'BICYCLE', 'CAR', 'ON_FOOT')),
    CONSTRAINT "riders_plate_chk" CHECK ("license_plate" IS NULL OR "license_plate" ~ '^[A-Z0-9]{4,10}$'),
    CONSTRAINT "riders_availability_chk" CHECK ("availability" IN ('AVAILABLE', 'UNAVAILABLE')),
    CONSTRAINT "riders_inactive_unavailable_chk" CHECK ("active" OR "availability" = 'UNAVAILABLE'),
    CONSTRAINT "riders_version_chk" CHECK ("version" >= 1)
);
-- Índices (toda consulta está acotada por sucursal o por id):
CREATE INDEX IF NOT EXISTS "riders_branch_name_idx" ON "app"."riders" ("branch_id", "name_key", "id");   -- listado por sucursal (alcance acotado) + orden por nombre; cubre la FK
CREATE INDEX IF NOT EXISTS "riders_name_idx" ON "app"."riders" ("name_key", "id");                         -- listado global (admin) ordenado por nombre
CREATE INDEX IF NOT EXISTS "riders_branch_assignable_idx" ON "app"."riders" ("branch_id")
    WHERE "active" AND "availability" = 'AVAILABLE';                                                         -- candidatos de F28 y filtro availability=AVAILABLE
-- NO se indexa `phone` aparte (el UNIQUE ya lo hace) ni `created_at`/`updated_at` (volumen: decenas de filas; se mide con EXPLAIN si crece).

CREATE OR REPLACE FUNCTION "app"."riders_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.allow_order_cleanup', true) = 'on' THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'app.riders no admite DELETE: se desactiva' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'INSERT' OR NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
        IF NOT EXISTS (SELECT 1 FROM app.branches b WHERE b.id = NEW.branch_id AND b.active) THEN
            RAISE EXCEPTION 'app.riders: la sucursal debe existir y estar activa' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'app.riders: id y created_at son inmutables' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
            RAISE EXCEPTION 'app.riders: todo UPDATE debe subir version en 1' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END; $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'riders_guard' AND tgrelid = 'app.riders'::regclass) THEN
        CREATE TRIGGER "riders_guard" BEFORE INSERT OR UPDATE OR DELETE ON "app"."riders"
            FOR EACH ROW EXECUTE FUNCTION "app"."riders_guard"();
    END IF;
END $$;

-- Privilegios: igual que 0018/0019 (RLS sin políticas + REVOKE a PUBLIC/anon/authenticated, incl. la función). Solo vía API.
ALTER TABLE "app"."riders" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "app"."riders" FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."riders_guard"() FROM PUBLIC;
-- (+ bloque DO $$ que repite el REVOKE para los roles anon y authenticated si existen, como 0019 §7)
COMMENT ON TABLE "app"."riders" IS 'F27. Motorista propio: una persona = una fila (UNIQUE phone). active ≠ availability; BUSY es derivado (F28). Sin DELETE.';
```

Notas para database-engineer: (1) la guarda de `riders_guard` en `INSERT` consulta `branches`; el seed de pruebas debe crear sucursal activa. (2) `schema.prisma`: modelo `Rider` (`@@map("riders")`, `@@schema("app")`, `@@unique([phone])`, índices con `map:`) y `riders Rider[]` en `Branch`; sin `@updatedAt` (SQL explícito). (3) Pruebas de migración `migration-0021.int-spec.ts` (patrón `migration-0019`): relanzable, CHECK de teléfono/placa/vehículo/disponibilidad, `inactive ⇒ UNAVAILABLE`, `UNIQUE(phone)` (`23505`), `DELETE` rechazado (`42501`), UPDATE sin subir `version` rechazado, mover a sucursal inactiva rechazado, RLS sin políticas y REVOKE. (4) Esta migración NO toca `role_permissions` (P93).

## 3. Rutas y matriz de endpoints

Convenciones reales de F03/F09 (`/v1/admin/...`, `page/pageSize/total`, `expectedVersion`, `@RequireStaff`). Todas: JWT + aal2 + personal activo + permiso + alcance de sucursal en SQL; `Cache-Control: private, no-store`; throttle `ADMIN_RIDERS_READ` (lecturas) o `ADMIN_RIDERS_COMMAND` (escrituras).

| Operación (`operationId`)      | Método y ruta                              | Permiso y alcance                                             | Éxito                | Errores                                                                                                                                |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `listAdminRiders`              | `GET /v1/admin/riders`                     | `riders.read`, sucursales del alcance                         | 200 `AdminRiderPage` | 400, 401, 403 (`MFA_REQUIRED`/sin permiso), 429, 503 `RIDERS_BUSY`                                                                     |
| `getAdminRider`                | `GET /v1/admin/riders/{id}`                | `riders.read` en su sucursal                                  | 200 `AdminRider`     | 400, 401, 403, 404 `RIDER_NOT_FOUND`, 429, 503                                                                                         |
| `createAdminRider`             | `POST /v1/admin/riders`                    | `riders.create` en `branchId`                                 | 201 `AdminRider`     | 400, 401, 403 `RIDER_ACTION_FORBIDDEN`, 409 `RIDER_PHONE_TAKEN`, 422 `BRANCH_NOT_AVAILABLE`, 429, 503                                  |
| `updateAdminRider`             | `PATCH /v1/admin/riders/{id}`              | `riders.update` en origen (y en destino si cambia `branchId`) | 200 `AdminRider`     | 400, 401, 403, 404, 409 `RIDER_VERSION_CONFLICT`/`RIDER_PHONE_TAKEN`/`RIDER_HAS_ACTIVE_DELIVERY`, 422 `BRANCH_NOT_AVAILABLE`, 429, 503 |
| `updateAdminRiderStatus`       | `PATCH /v1/admin/riders/{id}/status`       | `riders.update`                                               | 200 `AdminRider`     | 400, 401, 403, 404, 409 `RIDER_HAS_ACTIVE_DELIVERY`, 429, 503                                                                          |
| `updateAdminRiderAvailability` | `PATCH /v1/admin/riders/{id}/availability` | `riders.update`                                               | 200 `AdminRider`     | 400, 401, 403, 404, 409 `RIDER_INACTIVE`/`RIDER_HAS_ACTIVE_DELIVERY`, 429, 503                                                         |

`riders.assign` NO lo usa ninguna ruta de F27 (reservado a F28). Rutas aditivas respecto del backlog: `PATCH …/status`. Sin `DELETE`. La fila obsoleta `GET /v1/backoffice/riders` de `planned-endpoints.md` queda sustituida.

Roles con los permisos hoy (migraciones 0002 + 0005; las ediciones manuales vía F03 pueden diferir): `admin` (global) `read, create, update, assign`; `manager` `read` y `assign` (remapeo de `orders.dispatch`; NO `create` ni `update`); `kitchen` y `staff`: ninguno. Consecuencia: hasta que negocio apruebe P93, solo un `admin` global puede crear, editar, activar y marcar disponibilidad; el encargado ve su sucursal. Esto NO se «arregla» en F27.

### 3.1 Listado (`GET /v1/admin/riders`)

- Filtros: `q` (nombre, contiene, sin acentos ni mayúsculas, ≤ 80; `position(key in name_key)`; NO busca teléfono ni placa, P103), `branchId`, `active`, `availability` (`AVAILABLE|UNAVAILABLE|BUSY`), `sort` (`fullName|createdAt|updatedAt`, por defecto `fullName` sobre `name_key`), `order`, `page` (≤ 10000), `pageSize` (≤ 100, 20 por defecto). Desempate por `id`.
- Semántica de `availability`: `UNAVAILABLE` = columna `UNAVAILABLE` (incluye inactivos); `AVAILABLE` = activo + columna `AVAILABLE` + NO ocupado; `BUSY` = activo + ocupado (vacío mientras `busyKnown=false`). Para `AVAILABLE`/`BUSY` el servicio obtiene los ids ocupados del puerto y los inyecta como `id = ANY($)`/`id <> ALL($)` (acotado: decenas de motoristas); no se hace JOIN con entregas.
- Ítem (`AdminRiderSummary`): `id, branchId, branchName, fullName, phoneMasked (+502****5678), vehicleType, active, availability, busy, busyKnown, operationalState (INACTIVE|UNAVAILABLE|BUSY|AVAILABLE), version, createdAt, updatedAt`. Sin teléfono completo ni placa. `branchId` fuera de alcance o inexistente ⇒ página vacía (no distingue).
- Respuesta: `{items, page, pageSize, total}`; total con `count(*) OVER()` en la misma sentencia (si la página pedida queda vacía y `page > 1`, una sentencia extra de conteo).

### 3.2 Alta, edición, estado y disponibilidad

- **Alta**: `branchId, fullName, phone` obligatorios; `vehicleType`, `licensePlate` opcionales. Nace `active=true`, `availability=UNAVAILABLE`, `version=1`. `branchId` fuera del alcance de `riders.create` ⇒ 403 `RIDER_ACTION_FORBIDDEN`; sucursal inexistente/inactiva ⇒ 422 `BRANCH_NOT_AVAILABLE`.
- **Normalización** (servidor, antes de validar): `fullName` NFC, recortado, espacios colapsados, 2–80 y sin caracteres de control; `name_key` = NFKD sin diacríticos, minúsculas, espacios colapsados; `phone` exactamente `^\+502[0-9]{8}$` (sin reformatear: lo que no cumple es 400); `licensePlate` en mayúsculas sin espacios ni guiones y `^[A-Z0-9]{4,10}$`; `vehicleType` conjunto cerrado.
- **Edición** (`PATCH`): `expectedVersion` obligatorio; al menos un campo editable; `active`/`availability` y campos desconocidos ⇒ 400 (`additionalProperties: false`). `vehicleType`/`licensePlate` aceptan `null`. Valores idénticos a los vigentes ⇒ 200 sin escribir, sin subir `version` y sin auditar.
- **Traslado** (`branchId` distinto): exige `riders.update` en origen y destino; destino activo; lo deja `UNAVAILABLE` (debe re-habilitarse en la nueva sucursal); bloquea con 409 si hay entrega activa (§8). Mueve el mismo `id`.
- **Estado** (`PATCH …/status`): `active` explícito, idempotente (último gana, sin `expectedVersion`); desactivar fuerza `availability=UNAVAILABLE` y exige no tener entrega activa; reactivar no marca disponible; `reason` ≤ 200 opcional.
- **Disponibilidad** (`PATCH …/availability`): `AVAILABLE|UNAVAILABLE` explícito, idempotente; `BUSY` ⇒ 400; `AVAILABLE` con inactivo ⇒ 409 `RIDER_INACTIVE`; `UNAVAILABLE` con entrega activa ⇒ 409 `RIDER_HAS_ACTIVE_DELIVERY`.

## 4. Errores

Formato `ErrorResponse` con `code` estable (los clientes ramifican por `code`, nunca por `message`).

| Estado | `code`                      | Cuándo                                                                                                                                                         |
| ------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | (validación; `details`)     | Forma inválida, teléfono/placa/vehículo fuera de formato, `expectedVersion` ausente, cuerpo sin campos, campos no permitidos, `BUSY` enviado, UUID mal formado |
| 401    | —                           | Token ausente, inválido o expirado                                                                                                                             |
| 403    | `MFA_REQUIRED` / genérico   | No es personal activo, falta el permiso o la sesión no es aal2 (mensaje genérico; el motivo queda en el log sin PII)                                           |
| 403    | `RIDER_ACTION_FORBIDDEN`    | Ve el motorista (`riders.read`) pero no tiene el permiso de la operación en esa sucursal; destino de traslado/alta fuera del alcance                           |
| 404    | `RIDER_NOT_FOUND`           | Inexistente O fuera del alcance de `riders.read` (la misma respuesta)                                                                                          |
| 409    | `RIDER_PHONE_TAKEN`         | Teléfono ya registrado (activo, inactivo o de otra sucursal); no revela quién                                                                                  |
| 409    | `RIDER_VERSION_CONFLICT`    | `expectedVersion` no coincide; incluye `current` (versión vigente), sin guardar                                                                                |
| 409    | `RIDER_HAS_ACTIVE_DELIVERY` | Desactivar, `UNAVAILABLE` o trasladar con entrega activa (solo cuando el puerto la reporta)                                                                    |
| 409    | `RIDER_INACTIVE`            | Marcar `AVAILABLE` a un inactivo                                                                                                                               |
| 422    | `BRANCH_NOT_AVAILABLE`      | Sucursal de alta/destino inexistente o inactiva (código reutilizado de F09/F13)                                                                                |
| 429    | `RATE_LIMITED`              | Throttle                                                                                                                                                       |
| 503    | `RIDERS_BUSY`               | `DbGate` saturado; reintentable (`Retry-After`)                                                                                                                |

Precedencia: 401 → 403 (permiso/aal2) → 400 (forma) → 404 → 403 `RIDER_ACTION_FORBIDDEN` → 422 → 409. Los 403 y 404 no incluyen detalles del motorista.

## 5. Reglas de negocio

1. Una persona = un registro: `phone` único; traslado = `UPDATE branch_id`; reactivar en vez de duplicar.
2. `active` ≠ `availability`. `BUSY` solo derivado de una entrega activa real de F28; nunca persistido.
3. Inactivo ⇒ siempre `UNAVAILABLE` (CHECK) y no elegible.
4. Con `busyKnown=false` (sin F28) la API responde `busy=false` + `busyKnown=false`; `operationalState` nunca es `BUSY`; la UI debe mostrar «ocupación no disponible» y no «libre».
5. Tener motoristas (activos o disponibles) NO habilita `ownDeliveryZonesEnabled` (F09); la bandera se cambia solo por `PATCH /v1/admin/branches/{id}/delivery-settings` y la elegibilidad responde `OWN_DELIVERY_DISABLED` mientras esté apagada. F27 no la lee ni escribe fuera del servicio de elegibilidad.
6. Un motorista nunca es un `staff_users` ni tiene cuenta de Google/Auth.
7. Ningún comando reasigna ni cancela entregas.

## 6. Autorización, anti-IDOR y datos personales

- `@RequireStaff('riders.read'|'riders.create'|'riders.update')` por operación (aal2 incluido). El alcance sale de `req.staff.grants` (cero sentencias) y se aplica EN SQL (`branch_id = ANY($ids)`; alcance global = sin filtro). La visibilidad de un id se mide con el alcance de `riders.read`; si el actor lo ve pero no tiene el permiso de la operación en esa sucursal ⇒ 403 `RIDER_ACTION_FORBIDDEN`; si no lo ve ⇒ 404 `RIDER_NOT_FOUND` (respuesta idéntica a «no existe», mismo cuerpo y misma latencia aproximada: sin consulta extra en el camino negativo).
- Traslado/alta: el alcance de `riders.update`/`riders.create` se comprueba para cada sucursal involucrada ANTES de escribir. Sucursal destino inexistente fuera del alcance ⇒ 403 (indistinguible de «existe pero no autorizada»).
- PII (nombre, teléfono, placa): solo a quien tiene `riders.read`; el listado entrega el teléfono enmascarado y sin placa; sin respuestas públicas, sin caché (`private, no-store`), nunca en logs (el interceptor/filtro de errores no vuelca cuerpos; las pruebas lo verifican) ni en URLs (no hay búsqueda por teléfono). `AdminRider*` no incluye documentos, fotos, GPS ni historial de entregas.
- Auditoría (`AuditService.record(tx, …)`, `entityType: 'rider'`, `entityId` = id, `branchId`, `actorId` = `staff.staffId`; en la misma transacción):

| Acción                                  | Cuándo                  | `oldValues` → `newValues` (sin PII)                                                                        |
| --------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `rider.created`                         | alta                    | — → `{branchId, vehicleType, active: true, availability: 'UNAVAILABLE'}`                                   |
| `rider.updated`                         | edición con diff real   | `{changedFields: ['fullName','phone','vehicleType','licensePlate']}` (solo nombres de campo; sin valores)  |
| `rider.branch_changed`                  | traslado real           | `{branchId: origen}` → `{branchId: destino, availability: 'UNAVAILABLE'}`; `branchId` del evento = destino |
| `rider.activated` / `rider.deactivated` | cambio real de `active` | `{active}` → `{active, availability}`; `reason` opcional                                                   |
| `rider.availability_changed`            | cambio real             | `{availability}` → `{availability}`                                                                        |

Un `PATCH` con datos y traslado escribe `rider.updated` Y `rider.branch_changed`. Sin cambio real: ni escritura ni evento. Las lecturas no se auditan (P98).

## 7. Concurrencia e integridad

- **Edición**: `UPDATE riders SET …, version = version + 1, updated_at = now() WHERE id = $id AND version = $expected [AND branch_id = $origen]` (comparación y cambio en una sentencia). 0 filas ⇒ una lectura distingue 404 / 409 `RIDER_VERSION_CONFLICT` (con `current`).
- **Estado y disponibilidad**: valor explícito; la sentencia compara el valor actual (`… AND active IS DISTINCT FROM $nuevo`) y sube `version`; el segundo escritor concurrente con el mismo valor ve «sin cambio» (200 sin auditar); con valores distintos gana el último.
- **Transiciones peligrosas** (desactivar, `UNAVAILABLE`, traslado): `SELECT … FOR UPDATE` de la fila del motorista (con el alcance en SQL) → `RiderActiveDeliveriesPort.findBusy` (solo cuando `known`) → `UPDATE` con `version` → auditoría, en UNA transacción corta (sin esperas de red). F28 toma el MISMO `FOR UPDATE` antes de insertar su entrega, así que una asignación y un desactivar/trasladar concurrentes se serializan: uno de los dos ve el estado del otro. Sin otro tipo de bloqueo; `lock_timeout` corto ⇒ 503 `RIDERS_BUSY`.
- **Alta**: `INSERT … SELECT` desde `branches` (sucursal activa); violación `23505` de `riders_phone_key` ⇒ 409 `RIDER_PHONE_TAKEN` (carrera de dos altas con el mismo teléfono: gana una). El trigger es la segunda barrera contra sucursal inactiva (carrera con desactivar sucursal).
- **Integridad en BD**: UNIQUE, CHECKs de formato/estado, trigger de versión/inmutabilidad/sin DELETE (§2.2).
- Sin `Idempotency-Key` (P102): doble clic en el alta ⇒ el segundo recibe 409 `RIDER_PHONE_TAKEN`.

## 8. Disponibilidad operativa, puerto de entregas y elegibilidad (F28)

### 8.1 `RiderActiveDeliveriesPort`

```ts
interface RiderActiveDeliveriesPort {
  /** known=false: el adaptador no puede afirmar nada (F28 inexistente). busyIds solo es fiable si known=true. */
  findBusy(
    q: { riderIds: string[] } | { branchIds: string[] | null },
    tx?: TxClient,
  ): Promise<{ known: boolean; busyIds: ReadonlySet<string> }>;
}
export const RIDER_ACTIVE_DELIVERIES_PORT = Symbol('RIDER_ACTIVE_DELIVERIES_PORT');
```

- **Adaptador por defecto** `NoActiveDeliveriesAdapter` (documentado «F28 no existe»): `{ known: false, busyIds: ∅ }`, 0 sentencias SQL. NO simula entregas ni inventa datos.
- Respuesta de la API mientras `known=false`: `busy=false`, `busyKnown=false`, `operationalState` ≠ `BUSY`. Los comandos peligrosos NO pueden bloquear (no hay entregas que consultar); riesgo aceptado hasta F28.
- **F28 reemplaza el binding** (provider del módulo) por un adaptador con `known=true` que consulta `deliveries` activas (índice parcial sobre `rider_id`). No hay que tocar controladores ni contrato de F27.

### 8.2 `RiderEligibilityService`

```ts
type RiderIneligibleReason = 'NOT_FOUND' | 'INACTIVE' | 'WRONG_BRANCH' | 'UNAVAILABLE' | 'BUSY' | 'OWN_DELIVERY_DISABLED';
interface RiderEligibility { riderId: string; branchId: string; riderBranchId: string | null; active: boolean; available: boolean;
  busy: boolean; busyKnown: boolean; eligible: boolean; reasons: RiderIneligibleReason[] }
evaluate(input: { riderId: string; branchId: string }, tx?: TxClient): Promise<RiderEligibility>;
```

- `branchId` = sucursal del pedido evaluado. `available` = activo Y columna `AVAILABLE`. `eligible` ⇔ `reasons` vacío. Orden estable de razones: `NOT_FOUND` (cortocircuito), `INACTIVE`, `WRONG_BRANCH`, `UNAVAILABLE`, `BUSY`, `OWN_DELIVERY_DISABLED`. `busyKnown=false` NO añade `BUSY` (la elegibilidad no es «libre confirmado»; F28 decide si lo tolera).
- `OWN_DELIVERY_DISABLED`: `branch_delivery_settings.own_delivery_zones_enabled` de `branchId` (fila ausente = `false`, igual que F09).
- Una sola sentencia (`riders LEFT JOIN branch_delivery_settings`) + una llamada al puerto. Es una LECTURA: NO reserva, NO asigna, NO bloquea y su resultado caduca al instante. F28 DEBE llamarlo dentro de su transacción de asignación tras `SELECT … FOR UPDATE` de la fila del motorista (misma regla de §7) y confiar además en un índice único parcial «una asignación activa por motorista» en `deliveries`.
- Sin ruta HTTP (se exporta desde `RidersModule`). La autorización del actor la hace F28 (`riders.assign`, `deliveries.assign`).

## 9. Integración con otras features

- **F09**: solo lectura de `ownDeliveryZonesEnabled`; nunca la modifica ni la sugiere (el panel puede mostrar «Reparto propio apagado en esta sucursal» como información).
- **F07/F03**: sucursales activas; RBAC y alcance existentes. Si una sucursal se desactiva, sus motoristas no se tocan (la elegibilidad se evalúa contra la sucursal del pedido).
- **F28/F30/F33**: consumen el servicio y el puerto; no hay dependencia circular.
- **Web `bo-deliveries`**: conserva su mock de despacho y su tipo `Rider` hasta F28; F27 no lo modifica.

## 10. Rendimiento y presupuesto de sentencias SQL

Volumen: decenas de motoristas (≤ ~15 por sucursal, 3→5 sucursales). Presupuesto por endpoint (sentencias de BD del request, sin contar `BEGIN/COMMIT` ni la lectura de `grants` de la autenticación, que ya existe):

| Endpoint                           | Típico | Máximo | Detalle                                                                                                                     |
| ---------------------------------- | ------ | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /riders`                      | 1      | 3      | filas + `count(*) OVER()` con JOIN `branches` (nombre); +1 conteo si página vacía; +1 solo si F28 (`findBusy` por sucursal) |
| `GET /riders/{id}`                 | 1      | 2      | fila + JOIN; +1 si F28 (`findBusy` por id)                                                                                  |
| `POST /riders`                     | 2      | 3      | `INSERT…SELECT` + auditoría; +0 en error de teléfono (`23505`)                                                              |
| `PATCH /riders/{id}`               | 3      | 5      | lectura (con `FOR UPDATE` si traslado) + puerto (solo traslado, F28) + `UPDATE` + 1–2 auditorías                            |
| `PATCH …/status`, `…/availability` | 3      | 4      | lectura (`FOR UPDATE` si peligrosa) + puerto (F28) + `UPDATE` + auditoría; sin cambio: 1                                    |
| `evaluate`                         | 1      | 2      | `riders LEFT JOIN branch_delivery_settings` + puerto (F28)                                                                  |

Sin N+1 (el listado no carga entregas ni PII extra); nunca más de `pageSize ≤ 100` filas; sin listas ilimitadas; transacciones de comando cortas y sin I/O externo; `DbGate` limita la concurrencia para no agotar el pool. Índices en §2.2 (`riders_branch_name_idx`, `riders_name_idx`, `riders_branch_assignable_idx`). `EXPLAIN` real de listado con alcance acotado y global: pendiente de implementación (§15).

## 11. Contrato (fuente: `openapi.yaml`)

Tag `admin-riders`; esquemas y operaciones ya escritos (§Estado). Puntos a respetar al implementar: `AdminRiderSummary` (listado) vs `AdminRider` (`allOf` + `phone` + `licensePlate`); `AdminRiderPage` con `{items,page,pageSize,total}`; códigos en `ErrorResponse.code`; `RiderAvailability` NO contiene `BUSY`; `UpdateRiderRequest` y demás con `additionalProperties: false`. DTOs de la API con `class-validator` + `@ApiProperty` alineados (patrón F09) y `pnpm contracts:check` verde al terminar. `planned-endpoints.md` actualizado (fila obsoleta de `/v1/backoffice/riders` reemplazada).

## 12. Web (backoffice; lo implementa web-engineer)

- **Ubicación**: feature nueva `sushimon-web/src/features/bo-riders` (listado, detalle/panel, formularios, modales, hooks) y ruta de la sección Motoristas del backoffice (convención de `bo-admin`/`bo-catalog`, protegida por el guard de personal existente). Servicio en `lib/data-access` con adaptadores `mock` y `http` (tipos desde `@sushimon/contracts`); modelo `AdminRider` NUEVO, separado del `Rider` de despacho (`bo-deliveries`), que no se toca.
- **Listado**: tabla/tarjetas responsive con búsqueda por nombre (debounce), filtros sucursal/estado (`active`)/disponibilidad (incl. «Ocupado» solo si `busyKnown`), orden, paginación por `page/pageSize`, estados de carga (esqueleto), vacío y error con reintento; badge de estado operativo (`INACTIVE|UNAVAILABLE|BUSY|AVAILABLE`); teléfono enmascarado.
- **Detalle**: teléfono completo, placa, vehículo, sucursal, fechas; acciones según permisos (el cliente solo oculta; el servidor decide): editar, trasladar (selector de sucursales activas), activar/desactivar (confirmación + motivo opcional), disponible/no disponible (interruptor con actualización optimista y reversión en error). Si `busyKnown=false`: texto «La ocupación se mostrará cuando existan entregas propias» (nunca «libre»). SIN historial ni métricas de entregas ficticios.
- **Formularios**: alta/edición con validación de teléfono `+502` + 8 dígitos, placa y vehículo; manejo de 409 (`RIDER_VERSION_CONFLICT` ⇒ recargar y reaplicar; `RIDER_PHONE_TAKEN`; `RIDER_HAS_ACTIVE_DELIVERY`; `RIDER_INACTIVE`) y 403/404 con mensajes claros; sin datos personales en `localStorage` ni en la URL.
- **Transversales**: i18n es/en (claves nuevas en ambos catálogos), tema claro/oscuro con los tokens existentes, responsive, accesibilidad (etiquetas, foco en modales, `aria-live` en errores). La tarjeta «Motoristas» del dashboard solo cuando F33 lo pida.
- **Modo `mock`**: fixtures tipadas con datos ficticios (`+5025550XXXX`), reglas idénticas (unicidad, versión, `busyKnown=false`); sin red externa. Tras integrar, el flujo no depende del mock cuando `DATA_SOURCE=http`.
- **Calidad**: Vitest (modelo, formularios, reglas de visibilidad), Playwright (flujo alta → disponible → traslado → desactivar con el mock), revisión `ui-ux-reviewer`.

## 13. Matriz de pruebas (U unitaria · S servicio con dobles · E e2e supertest · I int-spec contra PostgreSQL real · W Vitest web · P Playwright)

| #   | Caso                                                                                                                                                                    | Nivel |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| R01 | Normalización: nombre NFC/espacios, `name_key` sin acentos, placa a mayúsculas sin guiones, teléfono estricto                                                           | U     |
| R02 | Teléfono inválido (`+50255501122x`, sin `+502`, 7 dígitos) ⇒ 400; placa y vehículo inválidos ⇒ 400                                                                      | E     |
| R03 | Alta feliz ⇒ 201, `active=true`, `availability=UNAVAILABLE`, `version=1`, auditoría `rider.created` sin PII                                                             | E+I   |
| R04 | Alta con teléfono repetido (activo, inactivo, otra sucursal) ⇒ 409 `RIDER_PHONE_TAKEN` sin revelar el registro                                                          | E+I   |
| R05 | Dos altas simultáneas con el mismo teléfono ⇒ una 201 y una 409                                                                                                         | I     |
| R06 | Alta en sucursal fuera del alcance ⇒ 403 `RIDER_ACTION_FORBIDDEN`; sucursal inactiva/inexistente (alcance global) ⇒ 422                                                 | E     |
| R07 | Alta sin `riders.create` ⇒ 403; sesión aal1 ⇒ 403 `MFA_REQUIRED`; sin token ⇒ 401                                                                                       | E     |
| R08 | Detalle de otra sucursal e inexistente ⇒ el MISMO 404 `RIDER_NOT_FOUND` (cuerpo idéntico)                                                                               | E     |
| R09 | `manager` (solo read/assign) lista y ve su sucursal, no la ajena; PATCH/POST ⇒ 403                                                                                      | E     |
| R10 | Listado: filtros `q` (con acentos), `branchId`, `active`, `availability`; orden; `page/pageSize/total`; página vacía                                                    | E+I   |
| R11 | Listado fuera de alcance por `branchId` ajeno ⇒ página vacía; alcance acotado nunca devuelve filas ajenas                                                               | E+I   |
| R12 | Listado sin teléfono completo ni placa; detalle con ambos; `Cache-Control: private, no-store` en todas las respuestas                                                   | E     |
| R13 | PATCH datos: versión correcta ⇒ 200 y `version+1`; versión vieja ⇒ 409 `RIDER_VERSION_CONFLICT` con `current`; sin cambios ⇒ 200 sin subir versión ni auditar           | E+I   |
| R14 | PATCH con `active`/`availability`/campo desconocido/sin campos/sin `expectedVersion` ⇒ 400                                                                              | E     |
| R15 | PATCH `null` borra vehículo y placa                                                                                                                                     | E     |
| R16 | Dos PATCH concurrentes con la misma versión ⇒ uno 200 y uno 409                                                                                                         | I     |
| R17 | Traslado: mismo `id`, mismo teléfono, `UNAVAILABLE`, `rider.branch_changed` con origen y destino; no se crea otra fila                                                  | E+I   |
| R18 | Traslado exige `riders.update` en origen Y destino (falta uno ⇒ 403); destino inactivo ⇒ 422                                                                            | E     |
| R19 | Traslado con entrega activa (puerto doble `known=true`) ⇒ 409 `RIDER_HAS_ACTIVE_DELIVERY` sin cambios                                                                   | S+E   |
| R20 | `status`: desactivar ⇒ `active=false` y `availability=UNAVAILABLE`; reactivar NO lo deja disponible; repetir ⇒ 200 sin auditar                                          | E+I   |
| R21 | Desactivar con entrega activa ⇒ 409; sin entrega ⇒ 200                                                                                                                  | S+E   |
| R22 | `availability`: `AVAILABLE`/`UNAVAILABLE` idempotente; `BUSY` ⇒ 400; `AVAILABLE` a inactivo ⇒ 409 `RIDER_INACTIVE`                                                      | E     |
| R23 | `UNAVAILABLE` con entrega activa ⇒ 409                                                                                                                                  | S+E   |
| R24 | Adaptador por defecto: `busy=false`, `busyKnown=false`, `operationalState` nunca `BUSY`; filtro `availability=BUSY` ⇒ vacío                                             | S+E   |
| R25 | Con puerto doble `known=true`: `busy=true`, `operationalState=BUSY`; filtro `BUSY`/`AVAILABLE` correctos                                                                | S+E   |
| R26 | Elegibilidad: una prueba por razón (`NOT_FOUND`, `INACTIVE`, `WRONG_BRANCH`, `UNAVAILABLE`, `BUSY`, `OWN_DELIVERY_DISABLED`), combinaciones y `eligible`                | S+I   |
| R27 | Elegibilidad con fila de ajustes ausente ⇒ `OWN_DELIVERY_DISABLED`; crear motoristas NO cambia `ownDeliveryZonesEnabled`                                                | I     |
| R28 | Elegibilidad no escribe ni bloquea (cero `UPDATE`/`FOR UPDATE`); `busyKnown=false` no añade `BUSY`                                                                      | S     |
| R29 | Auditoría: acción, actor, sucursal y valores correctos; NINGÚN evento contiene nombre, teléfono ni placa; atómica con el cambio (si falla la auditoría, nada se guarda) | E+I   |
| R30 | Logs y errores no contienen teléfono/placa/nombre (spy del logger en 400/409/500)                                                                                       | E     |
| R31 | Throttle: 429 con `Retry-After`; `DbGate` saturado ⇒ 503 `RIDERS_BUSY`                                                                                                  | E     |
| R32 | Presupuesto: contador de sentencias por endpoint ≤ §10                                                                                                                  | I     |
| R33 | Migración 0021: relanzable, CHECKs, `UNIQUE(phone)`, `inactive ⇒ UNAVAILABLE`, sin DELETE, versión monótona, sucursal inactiva, RLS/REVOKE                              | I     |
| R34 | `contracts:check` verde tras implementar; DTOs coinciden con el YAML                                                                                                    | E     |
| R35 | `RiderActiveDeliveriesPort`: el binding por defecto se sustituye por un doble sin tocar controladores                                                                   | S     |
| W01 | Listado: carga, vacío, error+reintento, filtros, paginación, teléfono enmascarado                                                                                       | W     |
| W02 | Formularios: validaciones de teléfono/placa, errores 409/403/404 mapeados, `version` reenviada                                                                          | W     |
| W03 | Acciones ocultas sin permiso; `busyKnown=false` ⇒ texto informativo, nunca «libre»                                                                                      | W     |
| W04 | i18n es/en completo, tema claro/oscuro, responsive                                                                                                                      | W     |
| P01 | Flujo mock: alta → disponible → trasladar → desactivar                                                                                                                  | P     |

Trazabilidad usuario → matriz: CRUD y filtros R03–R17/R10; datos mínimos y PII R02/R12/R30; active ≠ disponibilidad y BUSY derivado R20–R25; puerto sin F28 R24/R35; elegibilidad R26–R28; concurrencia R05/R16; auditoría R29; seguridad R07–R09/R11/R18; rendimiento R32; web W01–W04/P01.

## 14. Riesgos aceptados y decisiones

- Sin F28 no se puede bloquear por entrega activa (el puerto no sabe) ⇒ `busyKnown=false`; F28 debe cerrar esta brecha (D3/D4, §8).
- Solo `admin` global escribe hasta aprobar P93; un encargado no puede registrar a su motorista (decisión de negocio, no se asume).
- `RIDER_PHONE_TAKEN` confirma la existencia de un teléfono a quien tiene `riders.create/update` (sin id ni nombre).
- Sin retención/anonimización (P98) ni turnos/retorno (P100).
- Decisiones P92–P103 con recomendación adoptada (ver `decisiones-pendientes.md`): disponibilidad manual + `BUSY` derivado (P92); roles (P93); puerto y política de entrega activa (P94); traslado (P95); unicidad del teléfono (P96); vehículo y placa (P97); PII (P98); sin borrado (P99); sin turnos (P100); sin tocar `ownDeliveryZonesEnabled` (P101); alta sin `Idempotency-Key` (P102); búsqueda solo por nombre (P103).

## 15. Reparto de trabajo (agentes) y orden

1. `database-engineer`: migración 0021 (§2.2), `schema.prisma`, `migration-0021.int-spec.ts`; numerar tras `git fetch`.
2. `api-engineer`: `RidersModule` (controlador, servicio de consultas, servicio de comandos, repositorio `$queryRaw`, DTOs, errores, throttles, `DbGate`), puerto + adaptador por defecto, `RiderEligibilityService`; pruebas R01–R32/R35; `pnpm contracts:check` verde.
3. `web-engineer`: sección Motoristas (§12), adaptadores mock/http, pruebas W01–W04/P01.
4. `security-reviewer` (alcance, anti-IDOR, PII, auditoría) y `qa-engineer`; `ui-ux-reviewer` y `performance-reviewer` (presupuesto §10, `EXPLAIN`).
5. Orden: base de datos → API → web → revisiones. F28 empieza después y sustituye el adaptador.

## 16. Estado (implementado · simulado · pendiente de proveedor · bloqueado)

| Pieza                                            | Estado                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Contrato OpenAPI y tipos (`admin-riders`)        | `CONTRACT_DEFINED` (hecho; `contracts:check` rojo solo por las 6 operaciones sin implementar) |
| Spec, ADR-0031, P92–P103, `planned-endpoints.md` | Hecho                                                                                         |
| Migración 0021, `schema.prisma`                  | Pendiente (propuesta en §2.2; requiere aprobación humana para aplicarse)                      |
| API (`/v1/admin/riders`, elegibilidad, puerto)   | Pendiente                                                                                     |
| Web (sección Motoristas)                         | Pendiente (mock tipado propio)                                                                |
| Ocupación (`BUSY`)                               | Simulado: adaptador «sin entregas» (`busyKnown=false`); real = F28                            |
| PedidosYa / Neonet                               | `BLOCKED_EXTERNAL`; fuera de alcance                                                          |

## 17. Qué NO hace F27

- No asigna motoristas a pedidos ni crea/lee entregas ni su historial (F28); no sincroniza estados de pedido.
- No registra cobro de efectivo del motorista, rendición de caja ni compensaciones (F24 ya registra el cobro de personal; F28/F26/F34).
- No guarda ni pide documentos, fotos, GPS, ubicación, turnos, horarios ni evaluaciones.
- No crea cuentas de Google/Supabase para motoristas ni usa `staff_users` como riders; no crea login de motorista.
- No cambia `ownDeliveryZonesEnabled` ni zonas (F09), ni activa reparto propio por existir motoristas.
- No integra PedidosYa (F29, `BLOCKED_EXTERNAL`) ni envía notificaciones (F31).
- No reasigna ni cancela entregas al desactivar/trasladar; solo bloquea (409).
- No cambia roles ni permisos sembrados (P93); no usa `riders.assign`.
- No ofrece `DELETE`, importación/exportación ni reportes (F34/F35).
- No agrega Redis, colas, microservicios ni librerías.

## 18. Cambio propuesto al backlog maestro (F27)

Texto sugerido (NO se edita `docs/BACKLOG.md` aquí; lo aplica quien coordine): rutas de la ficha F27 + `PATCH /v1/admin/riders/:id/status`; «Datos: `app.riders` (+ `availability`, `name_key`, `version`, `created_at`, `updated_at`; migración 0021)»; «Brecha resuelta: disponibilidad manual persistida y `BUSY` derivado de F28 por puerto; sin turnos ni retorno (P100)»; «Abiertas: P92–P103».

## 19. Verificación pendiente de implementación

- Confirmar con `EXPLAIN` que el listado usa `riders_branch_name_idx`/`riders_name_idx` y que `count(*) OVER()` no degrada con alcance global.
- Confirmar que Prisma 7 admite `SELECT … FOR UPDATE` y el `UPDATE … WHERE version` vía `$queryRaw` dentro de la transacción de la API, y el nombre real del contexto/`grants` (`req.staff`).
- Confirmar el nombre y la ruta reales de la sección en `features/bo-*` y el router del backoffice.
- Confirmar con negocio P93 antes de añadir cualquier `role_permissions`.
