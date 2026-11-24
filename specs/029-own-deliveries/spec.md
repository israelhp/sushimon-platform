# F28 — Entregas con repartidores propios

**Rama**: `feature/F28-own-deliveries` (desde `develop` en `d751bca`, con F27) · **Dueño**: B · **Prioridad**: P0 · **Tipo**: API + WEB (entregas propias en el backoffice)
**Dependencias**: F20 (pedidos), F22 (transiciones y puertos), F27 (motoristas, elegibilidad, puerto de ocupación), F09 (`ownDeliveryZonesEnabled`, solo lectura), F03 (RBAC, aal2, alcance) · **Integración posterior**: F29 (PedidosYa, `BLOCKED_EXTERNAL`), F30 (seguimiento agregado), F31 (avisos), F32 (incidencias y entrega fallida), F33 (tarjeta de motoristas) · **Decisiones**: `docs/adr/0032-entregas-propias.md` · **Pendientes**: P105–P114 en `docs/business-rules/decisiones-pendientes.md`
**Estado de integración actual: `CONTRACT_DEFINED`** (9 operaciones `listAdminDeliveries`, `createAdminDelivery`, `getAdminDelivery`, `assignOwnRiderToAdminDelivery`, `unassignRiderFromAdminDelivery`, `markAdminDeliveryPickedUp`, `markAdminDeliveryDelivered`, `returnAdminDeliveryToBranch`, `cancelAdminDelivery` y esquemas `AdminDelivery*` en `openapi.yaml`, tag `admin-deliveries`; cambios aditivos en `cancelAdminOrder`, `AdminOrderAction*` y `OrderTrackingDelivery`). Sin migración aplicada, API ni web. `pnpm contracts:generate` ejecutado; `pnpm contracts:check` queda rojo SOLO por esas 9 operaciones sin implementar (como en F20/F21/F27). Estado de la feature en el backlog: no se edita aquí. PedidosYa real: `BLOCKED_EXTERNAL`/fuera de alcance (F29). La feature solo pasa a `READY` con código real, BD, seguridad, web y pruebas.

> **Nomenclatura oficial** (backlog y DBML): tablas `app.deliveries` y `app.delivery_status_history`, rutas `/v1/admin/deliveries`, permisos `deliveries.read|assign|update` y `riders.assign` (ya sembrados por 0005; no se crea RBAC nuevo). Un «repartidor» y un «motorista» son lo mismo (`app.riders`, F27).

## 1. Alcance y fuera de alcance

Dentro:

- **API**: crear (o reabrir) la entrega `OWN` de un pedido elegible; asignar/reasignar/desasignar motorista; confirmar recogida y entrega (que mueven el pedido por `OrderTransitionsService`); registrar el RETORNO del motorista al restaurante como evento SEPARADO; cancelar una entrega aún no recogida; listar y ver entregas con historial.
- **Datos**: migración 0022 aditiva (`app.deliveries`, `app.delivery_status_history`, índices únicos parciales, triggers de guarda, trigger de guarda en `app.orders`, RLS sin políticas + REVOKE).
- **Obligaciones heredadas de F27 y F22** (§11, ADR-0032 D9–D11): adaptador real de `RIDER_ACTIVE_DELIVERIES_PORT`, adaptador real de `OrderFulfillmentPort`, política de cancelación de pedido con entrega abierta, presupuesto de `DbGate`.
- **Auditoría** `delivery.*` en la misma transacción, sin PII.
- **Backoffice (web)**: lista/detalle de entregas propias, asignación, botones de estado, retorno, refresco dirigido (§13).
- **Seguimiento del cliente (F21)**: rellenar `delivery.status` con un estado público grueso, sin datos del motorista (§12, P113).

Fuera (ver §18 «Qué NO hace F28»): PedidosYa real (F29), cobro/efectivo/rendición del motorista, GPS/ubicación/ETA, prueba de entrega (foto/firma/PIN), entrega fallida o no entregada (P107 → F32), notificaciones (F31), cuentas para motoristas, reportes, activar `ownDeliveryZonesEnabled`, cambios de RBAC, borrado físico.

Reutiliza SIN cambiar su comportamiento: `@RequireStaff` (aal2 + permiso + `grants`), `AuditService.record(tx, …)`, filtro global de errores (`code`, `current`, `violations`), `DbGate`, throttler, patrón de cursor de F22, `OrderTransitionsService.apply` y su matriz (`allowOwnDispatch`), `RiderEligibilityService` y `maskPhone` de F27. Los únicos cambios a código existente están listados en §14 (aditivos).

## 2. Estado de partida verificado (evidencia)

| Hecho                                                                                                                                                                                                                                                                             | Evidencia                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Última migración aplicada: 0021; 0022 es la siguiente                                                                                                                                                                                                                             | `sushimon-api/prisma/migrations/` (0021_own_riders)                                                                                             |
| `app.deliveries` y `app.delivery_status_history` NO existen aún; DBML: `deliveries(id, order_id UNIQUE, rider_id, status default 'pending', assigned_at, picked_up_at, delivered_at, delivery_notes)`, `delivery_status_history(id, delivery_id, status, changed_by, changed_at)` | `docs/references/monsushi_dbdiagram.dbml:359-377`                                                                                               |
| Permisos `deliveries.read\|assign\|update` y `riders.assign` ya sembrados; `manager` los recibió por el remapeo de `orders.dispatch`; `staff` solo `deliveries.read`; `kitchen` ninguno; `admin` todos                                                                            | `prisma/migrations/0005_staff_rbac/migration.sql:114-117, 139-140, 195` y `0002_identity_staff` (`orders.dispatch` solo en `admin` y `manager`) |
| El pedido solo cambia por `OrderTransitionsService.apply(tx, …)`; `allowOwnDispatch: true` habilita `ready → on_the_way` y `on_the_way → delivered` solo para `OWN`                                                                                                               | `src/orders/admin/order-transitions.service.ts:30-37`, `order-transition.matrix.ts:96-132`                                                      |
| `apply` recibe un `TransitionTx`, pero la fábrica `txOf(client)` es PRIVADA en `AdminOrdersRepository`: F28 necesita una fábrica pública para pasar SU transacción                                                                                                                | `src/orders/admin/admin-orders.repository.ts:346` (`private txOf`), `admin-orders.types.ts` (`TransitionTx`)                                    |
| `NoDeliveryFulfillment` está enlazado en `OrdersModule` (`{ provide: ORDER_FULFILLMENT_PORT, useClass: NoDeliveryFulfillment }`)                                                                                                                                                  | `src/orders/orders.module.ts:84`, `src/orders/ports/order-fulfillment.port.ts`                                                                  |
| `NoActiveDeliveriesAdapter` (`known=false`) está enlazado en `RidersModule`                                                                                                                                                                                                       | `src/riders/riders.module.ts:34`, `src/riders/ports/rider-active-deliveries.port.ts`                                                            |
| `RiderEligibilityService.evaluate({riderId, branchId}, tx?)` devuelve `riderBranchId` (sucursal del motorista); una sentencia + `findBusy`                                                                                                                                        | `src/riders/rider-eligibility.service.ts`                                                                                                       |
| `findEligibilityRow` asume UUID (`::uuid`): un valor inválido sería un 500                                                                                                                                                                                                        | `src/riders/riders.repository.ts:128-150`                                                                                                       |
| `RIDERS_DB_GATE` reutiliza el cupo de pedidos (`splitGateBudget(...).orders`), de modo que los gates SUMAN `B + floor(B/4) > DB_POOL_MAX - 1` con cualquier pool ≥ 5 (p. ej. pool 10: 3+2+4+2 = 11 > 10)                                                                          | `src/riders/riders.module.ts:36-47`, `src/common/concurrency/db-gate.ts:83-92`                                                                  |
| `RidersQueriesService.get` llama a `findOne` y luego a `findBusy` en DOS `gate.run` distintos; `RidersCommandsService` hace `findBusy` en un `db()` aparte (línea ~265)                                                                                                           | `src/riders/riders-queries.service.ts:66-71`, `riders-commands.service.ts:260-265`                                                              |
| `dispatch` de F22 está SIEMPRE deshabilitada (`DISPATCH_NOT_AVAILABLE`)                                                                                                                                                                                                           | `src/orders/admin/order-transition.matrix.ts:190-198`                                                                                           |
| F21: `OrderTrackingDelivery.status` es `string` anulable «reservado para F28/F29», siempre `null`                                                                                                                                                                                 | `openapi.yaml` (`OrderTrackingDelivery`), `src/orders/order-tracking.mapper.ts:159`                                                             |
| F24 documenta «F28 añadirá `RIDER` como cobrador» (`PaymentCollectorType`)                                                                                                                                                                                                        | `openapi.yaml` (`PaymentCollectorType`) — **F28 NO lo hace** (P112); contradice esa nota                                                        |
| Mock web de despacho (`bo-deliveries`: PedidosYa simulado + repartidor propio) y `DispatchModal` en `bo-orders`                                                                                                                                                                   | `sushimon-web/src/features/bo-deliveries/**`, `bo-orders/use-dispatch-modal.tsx`, `dispatch-modal-host.tsx`                                     |

## 3. Modelo de datos y migración 0022

Evolución del DBML con migración + ADR (el DBML de referencia NO se edita). Numeración: la siguiente libre tras `git fetch` y revisión de `origin/develop` (provisional `0022_own_deliveries`).

### 3.1 Diseño (resumen)

- **`app.deliveries`**: columnas del DBML (`id, order_id, rider_id, status, assigned_at, picked_up_at, delivered_at, delivery_notes`) + añadidas `branch_id` (alcance y rendimiento sin JOIN; el trigger la obliga a igualar la del pedido), `returned_at`, `cancelled_at`, `version`, `created_at`, `updated_at`. `UNIQUE(order_id)` (DBML): una entrega por pedido; una cancelada se REABRE.
- **Catálogo de estados** (el DBML usa `'pending'` por defecto, que se conserva): `pending | assigned | picked_up | delivered | returned | cancelled`. Ocupan al motorista `assigned`, `picked_up` y `delivered` (hasta registrar el retorno). Terminales: `returned`, `cancelled` (esta última reabrible).
- **Una entrega activa por motorista**: índice único parcial `(rider_id) WHERE status IN ('assigned','picked_up','delivered')`.
- **Coherencia estado ↔ campos** (`CHECK`): cada estado exige exactamente su juego de marcas de tiempo y de `rider_id` (`pending`/`cancelled` sin motorista; `assigned`+ con motorista).
- **`delivery_notes`** (DBML) se conserva pero F28 NO lo escribe ni lo devuelve (texto libre = riesgo de PII; P110).
- **`app.delivery_status_history`** solo-añadir (trigger como `order_status_history`): añade `old_status`, `event`, `rider_id`, `reason`; `changed_by` = `staff_users.id` sin FK (criterio de `audit_events`).
- **Triggers** (defensa en profundidad; la API es la fuente de las reglas y una prueba barre todos los pares contra la matriz): guarda de `deliveries` (sin DELETE, inmutables, `version + 1`, grafo de estados, pedido DELIVERY+OWN de la misma sucursal, motorista activo de la misma sucursal), coherencia diferida entrega ↔ estado del pedido, y guarda en `orders` (no cancelar/rechazar con entrega abierta).

### 3.2 Máquina de estados de la entrega (tabla EXACTA)

| Comando (`POST /v1/admin/deliveries/…`)  | Permiso                               | Origen                | Destino     | Evento             | Efecto en el pedido                          | Motivo               |
| ---------------------------------------- | ------------------------------------- | --------------------- | ----------- | ------------------ | -------------------------------------------- | -------------------- |
| `POST /` (`createAdminDelivery`)         | `deliveries.assign`                   | (no existe)           | `pending`   | `created`          | ninguno                                      | no                   |
| `POST /` sobre entrega `cancelled`       | `deliveries.assign`                   | `cancelled`           | `pending`   | `reopened`         | ninguno                                      | no                   |
| `{id}/assign-own-rider`                  | `deliveries.assign` + `riders.assign` | `pending`             | `assigned`  | `rider_assigned`   | ninguno                                      | no                   |
| `{id}/assign-own-rider` (otro motorista) | `deliveries.assign` + `riders.assign` | `assigned`            | `assigned`  | `rider_reassigned` | ninguno                                      | no                   |
| `{id}/unassign-rider`                    | `deliveries.assign`                   | `assigned`            | `pending`   | `rider_unassigned` | ninguno                                      | opcional             |
| `{id}/mark-picked-up`                    | `deliveries.update`                   | `assigned`            | `picked_up` | `picked_up`        | `ready → on_the_way` (`order.dispatched`)    | no                   |
| `{id}/mark-delivered`                    | `deliveries.update`                   | `picked_up`           | `delivered` | `delivered`        | `on_the_way → delivered` (`order.delivered`) | no                   |
| `{id}/return-to-branch`                  | `deliveries.update`                   | `delivered`           | `returned`  | `returned`         | ninguno                                      | no                   |
| `{id}/cancel`                            | `deliveries.update`                   | `pending`, `assigned` | `cancelled` | `cancelled`        | ninguno                                      | OBLIGATORIO (3..280) |

Cualquier otro par (incluye saltos, retrocesos, `picked_up → cancelled`, `delivered → picked_up`, terminales) ⇒ 409 `DELIVERY_STATE_CONFLICT` con `current` (el comando no admite el estado vigente). Reabrir exige pedido todavía despachable (§6.1).

Reglas de estado del PEDIDO (leídas de `orders`, nunca del cliente):

| Operación                             | Estado del pedido requerido                                               |
| ------------------------------------- | ------------------------------------------------------------------------- |
| crear / reabrir / asignar / reasignar | `accepted`, `preparing` o `ready`, DELIVERY y `delivery_provider = 'OWN'` |
| desasignar / cancelar entrega         | cualquiera no terminal (no toca el pedido)                                |
| recoger                               | `ready` (si no ⇒ 409 `ORDER_STATE_CONFLICT`)                              |
| entregar                              | `on_the_way`                                                              |
| retorno                               | cualquiera (el pedido ya es `delivered`)                                  |

`PEDIDOSYA`: `createAdminDelivery` ⇒ 422 `DELIVERY_ORDER_NOT_ELIGIBLE` (`ORDER_PROVIDER_NOT_OWN`); ninguna ruta de F28 llama a un proveedor. Un mock jamás confirma una entrega real.

### 3.3 DDL propuesto (database-engineer implementa; aquí la referencia)

```sql
-- 0022 · F28 entregas propias (specs/029-own-deliveries §3, ADR-0032). CREA app.deliveries y app.delivery_status_history y AÑADE un trigger
-- de guarda a app.orders. Aditiva: solo CREATE. Relanzable (IF NOT EXISTS, CREATE OR REPLACE, triggers guardados por catálogo).
-- Guarda inicial como 0021: si app.deliveries ya existe con otra definición (falta columna o restricción esperada) => RAISE EXCEPTION sin
-- modificar nada. Requiere 0018 (orders), 0003 (branches) y 0021 (riders).
-- Reversión manual (destructiva; solo si no hay entregas que conservar; aprobación humana):
--   DROP TRIGGER orders_open_delivery_guard ON app.orders; DROP TABLE app.delivery_status_history; DROP TABLE app.deliveries;
--   DROP FUNCTION app.deliveries_guard(), app.deliveries_order_coherence(), app.delivery_status_history_append_only(), app.orders_open_delivery_guard();

CREATE TABLE IF NOT EXISTS "app"."deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,                                   -- añadida: = orders.branch_id (la fuerza el trigger)
    "rider_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assigned_at" TIMESTAMPTZ(6),
    "picked_up_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "returned_at" TIMESTAMPTZ(6),                                -- añadida: retorno SEPARADO de la entrega
    "cancelled_at" TIMESTAMPTZ(6),                               -- añadida
    "delivery_notes" TEXT,                                       -- DBML; F28 no lo escribe (P110)
    "version" INTEGER NOT NULL DEFAULT 1,                        -- añadida: compare-and-set (la reasignación cambia el motorista sin cambiar el estado)
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),          -- añadida
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),          -- añadida
    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deliveries_order_id_key" UNIQUE ("order_id"),
    CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deliveries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deliveries_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "app"."riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deliveries_status_chk" CHECK ("status" IN ('pending', 'assigned', 'picked_up', 'delivered', 'returned', 'cancelled')),
    CONSTRAINT "deliveries_version_chk" CHECK ("version" >= 1),
    CONSTRAINT "deliveries_notes_chk" CHECK ("delivery_notes" IS NULL OR char_length("delivery_notes") <= 280),
    CONSTRAINT "deliveries_lifecycle_chk" CHECK (
        ("status" = 'pending'   AND "rider_id" IS NULL     AND "assigned_at" IS NULL     AND "picked_up_at" IS NULL     AND "delivered_at" IS NULL     AND "returned_at" IS NULL     AND "cancelled_at" IS NULL)
     OR ("status" = 'assigned'  AND "rider_id" IS NOT NULL AND "assigned_at" IS NOT NULL AND "picked_up_at" IS NULL     AND "delivered_at" IS NULL     AND "returned_at" IS NULL     AND "cancelled_at" IS NULL)
     OR ("status" = 'picked_up' AND "rider_id" IS NOT NULL AND "assigned_at" IS NOT NULL AND "picked_up_at" IS NOT NULL AND "delivered_at" IS NULL     AND "returned_at" IS NULL     AND "cancelled_at" IS NULL)
     OR ("status" = 'delivered' AND "rider_id" IS NOT NULL AND "assigned_at" IS NOT NULL AND "picked_up_at" IS NOT NULL AND "delivered_at" IS NOT NULL AND "returned_at" IS NULL     AND "cancelled_at" IS NULL)
     OR ("status" = 'returned'  AND "rider_id" IS NOT NULL AND "assigned_at" IS NOT NULL AND "picked_up_at" IS NOT NULL AND "delivered_at" IS NOT NULL AND "returned_at" IS NOT NULL AND "cancelled_at" IS NULL)
     OR ("status" = 'cancelled' AND "rider_id" IS NULL     AND "assigned_at" IS NULL     AND "picked_up_at" IS NULL     AND "delivered_at" IS NULL     AND "returned_at" IS NULL     AND "cancelled_at" IS NOT NULL)),
    CONSTRAINT "deliveries_order_times_chk" CHECK ("picked_up_at" >= "assigned_at" AND "delivered_at" >= "picked_up_at" AND "returned_at" >= "delivered_at")
);
-- UNA entrega activa por motorista (doble asignación imposible incluso con una carrera o un bug). El motorista queda ocupado hasta registrar el retorno.
CREATE UNIQUE INDEX IF NOT EXISTS "deliveries_one_active_per_rider_idx" ON "app"."deliveries" ("rider_id")
    WHERE "status" IN ('assigned', 'picked_up', 'delivered');
-- Listado por sucursal/estado con orden estable y keyset (created_at, id); cubre la FK branch_id.
CREATE INDEX IF NOT EXISTS "deliveries_branch_status_created_idx" ON "app"."deliveries" ("branch_id", "status", "created_at" DESC, "id" DESC);
-- FK rider_id y consultas «entregas de un motorista» (historial por motorista, filtro riderId).
CREATE INDEX IF NOT EXISTS "deliveries_rider_idx" ON "app"."deliveries" ("rider_id") WHERE "rider_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "app"."delivery_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "old_status" TEXT,                                           -- añadida (NULL al crear)
    "status" TEXT NOT NULL,                                      -- DBML: estado NUEVO
    "event" TEXT NOT NULL,                                       -- añadida: distingue asignar/reasignar y crear/reabrir
    "rider_id" UUID,                                             -- añadida: motorista del evento (incl. el liberado); sin PII
    "reason" TEXT,                                               -- añadida: interno, solo cancelar/desasignar
    "changed_by" UUID,                                           -- staff_users.id SIN FK (criterio de audit_events); NULL = sistema
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "delivery_status_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_status_history_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "app"."deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "delivery_status_history_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "app"."riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "delivery_status_history_chk" CHECK (
        "status" IN ('pending', 'assigned', 'picked_up', 'delivered', 'returned', 'cancelled')
        AND ("old_status" IS NULL OR "old_status" IN ('pending', 'assigned', 'picked_up', 'delivered', 'returned', 'cancelled'))
        AND "event" IN ('created', 'reopened', 'rider_assigned', 'rider_reassigned', 'rider_unassigned', 'picked_up', 'delivered', 'returned', 'cancelled')
        AND ("reason" IS NULL OR char_length("reason") <= 500))
);
CREATE INDEX IF NOT EXISTS "delivery_status_history_delivery_idx" ON "app"."delivery_status_history" ("delivery_id", "changed_at", "id");
CREATE INDEX IF NOT EXISTS "delivery_status_history_rider_idx" ON "app"."delivery_status_history" ("rider_id") WHERE "rider_id" IS NOT NULL;

-- Solo-añadir (UPDATE/DELETE rechazados; DELETE permitido solo con app.allow_order_cleanup = 'on', que usan las pruebas).
CREATE OR REPLACE FUNCTION "app"."delivery_status_history_append_only"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_order_cleanup', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'app.delivery_status_history es solo-anadir (% rechazado)', TG_OP USING ERRCODE = 'insufficient_privilege';
END; $$;

-- Guarda de app.deliveries (defensa en profundidad; la API aplica las mismas reglas con mensajes de negocio).
CREATE OR REPLACE FUNCTION "app"."deliveries_guard"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.allow_order_cleanup', true) = 'on' THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'app.deliveries no admite DELETE: se cancela' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'pending' OR NEW.version <> 1 THEN
            RAISE EXCEPTION 'app.deliveries nace pending y version 1' USING ERRCODE = 'check_violation';
        END IF;
        -- Solo pedidos DELIVERY con reparto propio, y de la MISMA sucursal. F29 (PedidosYa) relajará esto con su propia migración.
        IF NOT EXISTS (SELECT 1 FROM app.orders o WHERE o.id = NEW.order_id AND o.fulfillment_type = 'DELIVERY'
                          AND o.delivery_provider = 'OWN' AND o.branch_id = NEW.branch_id) THEN
            RAISE EXCEPTION 'app.deliveries: el pedido debe ser DELIVERY OWN de la misma sucursal' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    -- UPDATE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'app.deliveries: id, order_id, branch_id y created_at son inmutables' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
        RAISE EXCEPTION 'app.deliveries: todo UPDATE debe subir version en 1' USING ERRCODE = 'check_violation';
    END IF;
    -- Grafo de estados (§3.2). Mismo estado solo para la reasignación (assigned → assigned con OTRO motorista).
    IF NOT ((OLD.status, NEW.status) IN (('pending','assigned'), ('assigned','pending'), ('assigned','picked_up'), ('picked_up','delivered'),
                                         ('delivered','returned'), ('pending','cancelled'), ('assigned','cancelled'), ('cancelled','pending'))
            OR (OLD.status = 'assigned' AND NEW.status = 'assigned' AND NEW.rider_id IS DISTINCT FROM OLD.rider_id)) THEN
        RAISE EXCEPTION 'app.deliveries: transicion % -> % no permitida', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    -- El motorista solo cambia al asignar (o se anula al volver a pending/cancelled).
    IF NEW.rider_id IS DISTINCT FROM OLD.rider_id AND NEW.status NOT IN ('assigned', 'pending', 'cancelled') THEN
        RAISE EXCEPTION 'app.deliveries: el motorista no puede cambiar en %', NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.rider_id IS NOT NULL AND NEW.rider_id IS DISTINCT FROM OLD.rider_id
       AND NOT EXISTS (SELECT 1 FROM app.riders r WHERE r.id = NEW.rider_id AND r.active AND r.branch_id = NEW.branch_id) THEN
        RAISE EXCEPTION 'app.deliveries: el motorista debe estar activo y ser de la sucursal del pedido' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END; $$;

-- Coherencia (diferida a COMMIT) entrega ↔ estado del pedido: red de seguridad contra escrituras que salten OrderTransitionsService.
CREATE OR REPLACE FUNCTION "app"."deliveries_order_coherence"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE v_status text;
BEGIN
    SELECT o.status INTO v_status FROM app.orders o WHERE o.id = NEW.order_id;
    IF NOT FOUND OR NOT (
         (NEW.status IN ('pending', 'assigned') AND v_status IN ('accepted', 'preparing', 'ready'))
      OR (NEW.status = 'picked_up' AND v_status = 'on_the_way')
      OR (NEW.status IN ('delivered', 'returned') AND v_status = 'delivered')
      OR (NEW.status = 'cancelled' AND v_status NOT IN ('on_the_way', 'delivered'))) THEN
        RAISE EXCEPTION 'app.deliveries: estado % incoherente con el pedido (%)', NEW.status, v_status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END; $$;

-- Guarda en app.orders: un pedido con entrega ABIERTA no se cancela ni se rechaza (se cancela antes la entrega). Se dispara SOLO al pasar a
-- cancelled/rejected (WHEN). Lee deliveries sin bloquearla; el orden de bloqueos de la API (motorista → entrega → pedido) lo hace libre de ciclos.
CREATE OR REPLACE FUNCTION "app"."orders_open_delivery_guard"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM app.deliveries d WHERE d.order_id = OLD.id AND d.status IN ('pending', 'assigned', 'picked_up')) THEN
        RAISE EXCEPTION 'ORDER_HAS_ACTIVE_DELIVERY' USING ERRCODE = 'restrict_violation';   -- 23001; la API lo traduce a 409 ORDER_HAS_ACTIVE_DELIVERY
    END IF;
    RETURN NEW;
END; $$;

-- Triggers (guardados por catálogo, como 0021): delivery_status_history_append_only (BEFORE UPDATE OR DELETE), deliveries_guard (BEFORE INSERT OR
-- UPDATE OR DELETE FOR EACH ROW), deliveries_order_coherence (CONSTRAINT TRIGGER AFTER INSERT OR UPDATE, DEFERRABLE INITIALLY DEFERRED),
-- orders_open_delivery_guard (BEFORE UPDATE OF status ON app.orders FOR EACH ROW WHEN (NEW.status IN ('cancelled','rejected') AND OLD.status IS DISTINCT FROM NEW.status)).

-- Privilegios: igual que 0018/0019/0021 (RLS sin políticas + REVOKE a PUBLIC/anon/authenticated en tablas y funciones). Solo vía API.
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY; REVOKE ALL ... FROM PUBLIC; + bloque DO $$ que repite el REVOKE para anon y authenticated si existen.
-- COMMENT ON TABLE/COLUMN para las columnas añadidas sobre el DBML.
```

Notas para database-engineer: (1) `CHECK … >=` con `NULL` pasa (comparación desconocida): es lo deseado. (2) `schema.prisma`: modelos `Delivery` (`@@map("deliveries")`, `@@unique([orderId])`, índices con `map:`; el índice único parcial y los triggers viven solo en SQL, como `customer_addresses_one_default_key`) y `DeliveryStatusHistory`; relaciones inversas en `Order`, `Branch` y `Rider`; sin `@updatedAt` (SQL explícito). (3) La migración NO toca `role_permissions`. (4) El trigger de `orders` añade un trigger sin cambiar columnas; no altera `orders_immutable_fields`. (5) Pruebas `test/migration-0022.int-spec.ts` (patrón `migration-0021`): relanzable; cada CHECK de ciclo de vida; `UNIQUE(order_id)` (`23505`); índice único parcial (segunda entrega activa del mismo motorista ⇒ `23505`; cancelada/`returned` NO cuenta); `pending → picked_up` rechazado; barrido de TODOS los pares de estados contra la tabla §3.2 (misma tabla que el servicio); `DELETE` rechazado; UPDATE sin subir `version` rechazado; motorista inactivo o de otra sucursal rechazado; pedido PICKUP/PEDIDOSYA rechazado; historial `UPDATE/DELETE` rechazados; cancelar/rechazar un pedido con entrega abierta ⇒ `23001`, y con entrega `returned`/`cancelled` ⇒ permitido; coherencia diferida (entrega `picked_up` con pedido `ready` ⇒ falla en COMMIT); RLS sin políticas y REVOKE.

## 4. Rutas y matriz de endpoints

Convenciones reales de F22/F27 (`/v1/admin/...`, `@RequireStaff` por operación, `Cache-Control: private, no-store` vía `privateNoStoreMiddleware` para `admin/deliveries*` excluido del `no-store` genérico, throttles propios). Todas: JWT + aal2 + personal activo + permiso + alcance por sucursal EN SQL.

| Operación (`operationId`)        | Método y ruta                                               | Permiso                               | Éxito                              | Errores                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------- | ------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listAdminDeliveries`            | `GET /v1/admin/deliveries`                                  | `deliveries.read`                     | 200 `AdminDeliveryPage`            | 400 (`DELIVERY_CURSOR_INVALID`), 401, 403, 404 `BRANCH_NOT_FOUND`, 429, 503                                                                                |
| `getAdminDelivery`               | `GET /v1/admin/deliveries/{id}`                             | `deliveries.read`                     | 200 `AdminDelivery`                | 400, 401, 403, 404 `DELIVERY_NOT_FOUND`, 429, 503                                                                                                          |
| `createAdminDelivery`            | `POST /v1/admin/deliveries` `{orderId}`                     | `deliveries.assign`                   | 201 (crea/reabre) · 200 `replayed` | 400, 401, 403 `DELIVERY_ACTION_FORBIDDEN`, 404 `ORDER_NOT_FOUND`, 409 `ORDER_STATE_CONFLICT`, 422 `DELIVERY_ORDER_NOT_ELIGIBLE`, 429, 503                  |
| `assignOwnRiderToAdminDelivery`  | `POST …/{id}/assign-own-rider` `{riderId, expectedVersion}` | `deliveries.assign` + `riders.assign` | 200 `AdminDeliveryCommandResult`   | 400, 401, 403, 404 `DELIVERY_NOT_FOUND`/`RIDER_NOT_FOUND`, 409 `DELIVERY_STATE_CONFLICT`, 422 `RIDER_NOT_ELIGIBLE`/`DELIVERY_ORDER_NOT_ELIGIBLE`, 429, 503 |
| `unassignRiderFromAdminDelivery` | `POST …/{id}/unassign-rider` `{expectedVersion, reason?}`   | `deliveries.assign`                   | 200                                | 400, 401, 403, 404, 409, 429, 503                                                                                                                          |
| `markAdminDeliveryPickedUp`      | `POST …/{id}/mark-picked-up` `{expectedVersion}`            | `deliveries.update`                   | 200                                | 400, 401, 403, 404, 409 (`DELIVERY_STATE_CONFLICT`/`ORDER_STATE_CONFLICT`), 422 `ORDER_TRANSITION_INVALID`, 429, 503                                       |
| `markAdminDeliveryDelivered`     | `POST …/{id}/mark-delivered` `{expectedVersion}`            | `deliveries.update`                   | 200                                | ídem                                                                                                                                                       |
| `returnAdminDeliveryToBranch`    | `POST …/{id}/return-to-branch` `{expectedVersion}`          | `deliveries.update`                   | 200                                | 400, 401, 403, 404, 409, 429, 503                                                                                                                          |
| `cancelAdminDelivery`            | `POST …/{id}/cancel` `{expectedVersion, reason}`            | `deliveries.update`                   | 200                                | 400 (`DELIVERY_REASON_REQUIRED`), 401, 403, 404, 409, 429, 503                                                                                             |

Rutas aditivas respecto de la ficha: `POST /v1/admin/deliveries` (crear; ver ADR-0032 D2), `unassign-rider` y `cancel`. Sin `PATCH` ni `DELETE`. Las filas `/v1/backoffice/deliveries*` y `orders/{id}/dispatch` de `planned-endpoints.md` quedan sustituidas para `OWN`; PedidosYa sigue simulado.

### 4.1 Cómo se CREA la entrega (decisión y alternativas)

**Recomendado**: `POST /v1/admin/deliveries {orderId}` explícito e idempotente por pedido (`UNIQUE(order_id)`); la web encadena «crear + asignar» al pulsar `dispatch` (dos llamadas cortas, ambas repetibles). Alternativas descartadas (ADR-0032 D2): (a) crear al asignar con una sola ruta `POST /v1/admin/orders/{id}/assign…` — mezcla dos recursos y pone un comando de entregas bajo `/admin/orders` (F22 no escribe entregas); (b) crear automáticamente en `mark-ready` — F22 no escribe tablas de entregas y obligaría a un hook en su transacción; (c) crear un `pending` por cada pedido DELIVERY al aceptar — filas inútiles si se cancela o se elige otro proveedor.

### 4.2 Listado (`GET /v1/admin/deliveries`)

- Filtros: `branchId` (fuera de alcance ⇒ 404 `BRANCH_NOT_FOUND`, como F22), `status` (por defecto los abiertos: `pending,assigned,picked_up,delivered`; sin ventana de fechas), `riderId` (fuera de alcance ⇒ vacío), `from`/`to` (instante de `created_at`, solo acotan `returned|cancelled`; por defecto `from = ahora − 7 días`, rango ≤ 92 días), `cursor`, `limit` (≤ 100, 25 por defecto). `status=delivered` es el filtro «esperando retorno».
- Orden fijo `(created_at DESC, id DESC)`, keyset con microsegundos (`createdAtKey`, como `placedAtKey` de F22); un cursor alterado ⇒ 400 `DELIVERY_CURSOR_INVALID`; sin conteo total. Predicado: `d.status = ANY($statuses) AND (d.status IN (abiertos) OR d.created_at >= $from)`.
- Ítem `AdminDeliverySummary`: `id, orderId, displayNumber, branchId, branchName, status, orderStatus, municipalityName, zone, rider{id, fullName, vehicleType, phoneMasked}|null, riderOccupied, awaitingReturn, version, assignedAt…cancelledAt, createdAt, updatedAt, availableActions[]`. Sin teléfono del cliente, dirección completa ni notas. UNA sentencia: `deliveries d JOIN orders o JOIN branches b LEFT JOIN order_addresses a LEFT JOIN riders r` con `branch_id = ANY($ids)` (alcance global = sin filtro).
- `availableActions` se calcula con una función pura `availableDeliveryActionsFor(delivery, orderStatus, canDo)` (patrón de `availableActionsFor` de F22): `canDo(permiso)` resuelve el permiso EN LA SUCURSAL DE LA ENTREGA; `NO_PERMISSION` ⇒ la web oculta; `ORDER_NOT_READY` (recoger con pedido aún en `accepted|preparing`) ⇒ deshabilitada.

### 4.3 Detalle (`GET /v1/admin/deliveries/{id}`)

`AdminDelivery` = resumen + `order{id, displayNumber, status, deliveryProvider}` + `contactVisible`, `customer{name, phone}`|null, `address{municipalityName, zone, addressLine, referenceNote}`|null + `history[≤50]` (cronológico; `event, oldStatus, status, riderId, riderName, reason, actorName, at`) + `historyTruncated`. 2 sentencias (fila con JOINs; historial). El contacto y la dirección se SELECCIONAN en SQL solo si se cumplen las condiciones de §8 (no se leen y se descartan después).

## 5. Errores

Formato `ErrorResponse` con `code` estable (ramificar por `code`, nunca por `message`).

| Estado | `code`                        | Cuándo                                                                                                                                                                            |
| ------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | (validación; `details`)       | UUID mal formado, cuerpo inválido, campos desconocidos, `expectedVersion` ausente                                                                                                 |
| 400    | `DELIVERY_REASON_REQUIRED`    | `cancel` sin motivo (3..280, sin caracteres de control; mismo saneado que F22) o `reason` inválido en `unassign-rider`                                                            |
| 400    | `DELIVERY_CURSOR_INVALID`     | Cursor alterado o de otra consulta                                                                                                                                                |
| 401    | —                             | Token ausente, inválido o expirado                                                                                                                                                |
| 403    | `MFA_REQUIRED` / genérico     | No es personal activo, falta el permiso base o la sesión no es aal2                                                                                                               |
| 403    | `DELIVERY_ACTION_FORBIDDEN`   | Ve la entrega (`deliveries.read`) pero no tiene el permiso del comando en su sucursal (incluye `riders.assign` en asignar)                                                        |
| 404    | `DELIVERY_NOT_FOUND`          | Inexistente O fuera del alcance de `deliveries.read` (misma respuesta, mismo cuerpo)                                                                                              |
| 404    | `ORDER_NOT_FOUND`             | `createAdminDelivery` con pedido inexistente o fuera del alcance (reutiliza el código de F22)                                                                                     |
| 404    | `RIDER_NOT_FOUND`             | Motorista inexistente o fuera del alcance de `riders.read` (reutiliza F27; NO devuelve su sucursal)                                                                               |
| 404    | `BRANCH_NOT_FOUND`            | Filtro `branchId` fuera de alcance (listado)                                                                                                                                      |
| 409    | `DELIVERY_STATE_CONFLICT`     | `expectedVersion` distinta o el estado no admite el comando; incluye `current {status, version}`                                                                                  |
| 409    | `ORDER_STATE_CONFLICT`        | El pedido no está en el estado requerido (recoger exige `ready`; entregar exige `on_the_way`); incluye `current` del pedido (reutiliza F22)                                       |
| 409    | `ORDER_HAS_ACTIVE_DELIVERY`   | (en `cancelAdminOrder`/`rejectAdminOrder` de F22) el pedido tiene entrega `pending                                                                                                | assigned  | picked_up`; incluye `current` del pedido                                                                      |
| 422    | `DELIVERY_ORDER_NOT_ELIGIBLE` | Pedido no DELIVERY `OWN` en `accepted                                                                                                                                             | preparing | ready` (`violations[].code`: `ORDER_STATUS_NOT_DISPATCHABLE`, `ORDER_NOT_DELIVERY`, `ORDER_PROVIDER_NOT_OWN`) |
| 422    | `RIDER_NOT_ELIGIBLE`          | Motorista no elegible (`violations[].code`: `INACTIVE`, `WRONG_BRANCH`, `UNAVAILABLE`, `BUSY`, `OWN_DELIVERY_DISABLED`); `BUSY` también cuando pierde la carrera del índice único |
| 422    | `ORDER_TRANSITION_INVALID`    | (reutiliza F22) la matriz rechaza la transición del pedido (p. ej. proveedor `PEDIDOSYA`)                                                                                         |
| 429    | `RATE_LIMITED`                | Throttle                                                                                                                                                                          |
| 503    | `DELIVERIES_BUSY`             | `DbGate` saturado o `lock_timeout`; reintentable (`Retry-After: 2`)                                                                                                               |

Precedencia: 401 → 403 (permiso base/aal2) → 400 (forma) → 404 (alcance) → 403 `DELIVERY_ACTION_FORBIDDEN` → 404 `RIDER_NOT_FOUND` → 422 (elegibilidad) → 409 (versión/estado). Los 403 y 404 no incluyen detalles de la entrega, del pedido ni del motorista.

## 6. Reglas de negocio

### 6.1 Creación, reapertura y asignación

1. Solo pedidos DELIVERY `OWN` en `accepted|preparing|ready` (P111): la cocina puede avisar/asignar con antelación; la RECOGIDA exige `ready`. `pending` (aún sin aceptar), terminales y `on_the_way` ⇒ 422.
2. `createAdminDelivery` es idempotente: existente abierta ⇒ 200 `replayed`; `cancelled` ⇒ se REABRE a `pending` (201, `reopened`, limpia `cancelled_at`; el historial conserva el ciclo anterior); `returned` ⇒ 409 (`DELIVERY_STATE_CONFLICT`; no se reabre: el pedido ya está entregado).
3. **Asignar** (`pending → assigned`) y **reasignar** (`assigned → assigned` con otro motorista, solo antes de la recogida, P108) comparten ruta. El motorista anterior queda libre en la misma transacción (su ocupación se deriva de la entrega, no se guarda). Asignar al MISMO motorista que ya tiene la entrega ⇒ 200 `replayed=true` sin escribir (estado deseado ya alcanzado).
4. **Elegibilidad** (misma regla que F27 §7/§8): dentro de la transacción, tras `SELECT … FOR UPDATE` de la fila del motorista, `RiderEligibilityService.evaluate({riderId, branchId: <sucursal del PEDIDO>}, tx)` ⇒ `eligible` exige activo, de la sucursal del pedido, `AVAILABLE` (manual, F27), no ocupado (`known=true` con el adaptador real) y `ownDeliveryZonesEnabled`. Sin `known=true` el servicio NO asigna (falla cerrado, 503 `DELIVERIES_BUSY`/error de configuración): jamás se asigna con el adaptador «sin entregas».
5. El motorista debe ser de la sucursal del pedido (`WRONG_BRANCH`); no se envía a un motorista de otra sucursal ni se crea una vía para hacerlo.
6. `ownDeliveryZonesEnabled=false` ⇒ `RIDER_NOT_ELIGIBLE`/`OWN_DELIVERY_DISABLED` al asignar. F28 NO lo activa (P101 de F27 sigue vigente).

### 6.2 Recogida, entrega y retorno (retorno separado)

1. `mark-picked-up`: entrega `assigned` + pedido `ready` ⇒ entrega `picked_up` y pedido `on_the_way` en la MISMA transacción. `mark-delivered`: `picked_up` + `on_the_way` ⇒ `delivered` (entrega) y `delivered` (pedido).
2. `return-to-branch` (`delivered → returned`) es un evento SEPARADO con su fila de historial y su marca `returned_at`; no toca el pedido. Libera la ocupación del motorista: `findBusy` deja de contarlo; su `availability` manual de F27 no cambia (si estaba `AVAILABLE`, vuelve a ser asignable).
3. **El motorista queda ocupado hasta registrar el retorno** (P105). Si nunca se registra: la entrega queda `delivered` («esperando retorno», visible con el filtro y el indicador `awaitingReturn`) hasta que alguien con `deliveries.update` ejecute `return-to-branch`, incluso días después (liberación manual con permiso, rastro en historial/auditoría y sin temporizadores ni jobs; P106). No existe forma de liberar a un motorista sin una transición válida registrada.
4. Entrega fallida/no entregada (cliente ausente, dirección inválida, pedido devuelto al restaurante): FUERA de F28 (P107 → F32). Efecto aceptado: con la entrega `picked_up` y sin salida, el motorista seguiría ocupado; la salvaguarda es operativa (la persona con acceso a BD aprobado documenta un procedimiento de soporte) hasta que F32 defina `mark-failed`. Riesgo explícito en §17.
5. Efectivo: F24 ya registra el cobro del personal; F28 NO registra cobro del motorista, no añade `RIDER` a `PaymentCollectorType` y no gestiona rendición (P112, contradice la nota de F24 y la deja pendiente en P85).

### 6.3 Cancelar entrega y cancelar pedido con entrega abierta (política, P114)

- `cancel` de la entrega: `pending|assigned`, motivo obligatorio, libera al motorista, NO toca el pedido. Terminal para la entrega (reabrible con `createAdminDelivery` mientras el pedido siga despachable).
- **Cancelar o rechazar un pedido con entrega `pending|assigned|picked_up` se RECHAZA** con 409 `ORDER_HAS_ACTIVE_DELIVERY` (alternativa descartada: liberar/cancelar la entrega dentro de la transacción de F22, que obligaría a F22 a escribir `deliveries` y crea un ciclo de bloqueos pedido→entrega contra la asignación entrega→pedido). Camino operativo: `cancelAdminDelivery` y luego `cancelAdminOrder`; la web ofrece encadenarlos. `on_the_way` ya estaba prohibido por la matriz de F22 (`ORDER_CANCEL_NOT_ALLOWED`); con entrega `picked_up` el pedido está `on_the_way`.
- Implementación: el trigger `orders_open_delivery_guard` (barrera, libre de carreras: la sentencia `UPDATE orders` bloquea la fila y el trigger lee `deliveries` ya confirmadas) + traducción de `restrict_violation` (23001) en `translateOrdersDbError` a 409 con `current` del pedido. `FOR SHARE` del pedido en asignar cierra la carrera inversa (§9).
- Con el adaptador real de `OrderFulfillmentPort`, `pendingActions` NO incluye `delivery_cancellation` para `OWN` (el caso ya no puede ocurrir tras un cancel exitoso); el valor queda reservado a F29 (PedidosYa).

## 7. Autorización, anti-IDOR y matriz de permisos

- `@RequireStaff('deliveries.read'|'deliveries.assign'|'deliveries.update')` por operación (aal2 incluido). El alcance sale de `req.staff.grants` (cero sentencias) y se aplica EN SQL (`branch_id = ANY($ids)`). Toda lectura previa de un comando se hace con ese predicado de `deliveries.read`: fila no visible ⇒ 404 `DELIVERY_NOT_FOUND` idéntico a «no existe» (sin consulta extra en el camino negativo); visible pero sin el permiso del comando en esa sucursal ⇒ 403 `DELIVERY_ACTION_FORBIDDEN`.
- `assign-own-rider` exige ADEMÁS `riders.assign` en la sucursal de la entrega y que el actor pueda VER al motorista (`riders.read` en la sucursal DEL MOTORISTA); si no, 404 `RIDER_NOT_FOUND` uniforme. La sucursal del motorista NUNCA se devuelve (obligación F27 nº 2): se mapea la elegibilidad a `violations[].code` sin `riderBranchId`.
- `createAdminDelivery`: pedido no visible (`deliveries.read` en su sucursal) ⇒ `ORDER_NOT_FOUND`; visible sin `deliveries.assign` ⇒ 403.
- Las transiciones del PEDIDO (`order.dispatched`/`order.delivered`) se autorizan con `deliveries.update` mediante el callback `authorize` de `apply` (no se exigen `orders.*`: el despacho es una acción logística; queda auditada con el actor).

| Rol (hoy; editable por F03, solo orientativo) | `deliveries.read` | `deliveries.assign` | `deliveries.update` | `riders.assign` | Efecto                                      |
| --------------------------------------------- | ----------------- | ------------------- | ------------------- | --------------- | ------------------------------------------- |
| `admin`                                       | sí                | sí                  | sí                  | sí              | todo                                        |
| `manager`                                     | sí                | sí                  | sí                  | sí              | todo en SU sucursal                         |
| `staff`                                       | sí                | NO                  | NO                  | NO              | solo ve la lista/detalle (acciones ocultas) |
| `kitchen`                                     | NO                | NO                  | NO                  | NO              | no ve entregas (404/403)                    |

No se cambia el RBAC sembrado. P110 pregunta si la cocina o el cajero deberían confirmar recogida (hoy no pueden).

## 8. Datos personales (PII)

- El motorista NO es usuario: no hay login, token ni ruta para él; el personal le transmite lo necesario fuera del sistema (F31 podrá avisarle más adelante).
- Lista: sin teléfono ni dirección del cliente (solo municipio/zona y número de pedido). Detalle: `customer` (nombre y teléfono) y `address` (línea, referencia) SOLO si la entrega está ABIERTA (`pending|assigned|picked_up|delivered`) Y el actor tiene `orders.read` en la sucursal (P110); si no, `contactVisible=false` y ambos `null`. No hay correo ni coordenadas.
- Motorista en entregas: `id`, `fullName`, `vehicleType`, `phoneMasked`; sin placa, sin teléfono completo y sin sucursal (esos datos son de `getAdminRider`, con `riders.read`).
- `reason` es texto interno libre: se valida y se guarda en historial/auditoría (como F22); la web avisa «no escribas datos personales». `delivery_notes` no se usa.
- `Cache-Control: private, no-store` en TODA respuesta (también 4xx/5xx), sin caché compartida y sin PII en URL ni logs (el filtro de errores no vuelca cuerpos; prueba con espía del logger).
- Auditoría y logs: solo ids, estados y nombres de campo.

## 9. Concurrencia, idempotencia y atomicidad

### 9.1 Orden de bloqueos (sin ciclos)

Orden global: **motorista → entrega → pedido**. Solo `assign` toma el bloqueo del motorista (`SELECT … FOR UPDATE`, el MISMO que F27 §7 en sus transiciones peligrosas); luego `SELECT … FOR UPDATE OF d FOR SHARE OF o` (entrega y pedido en una sentencia, la entrega se bloquea antes que el pedido dentro del plan de una sola fila); el resto de comandos toman la entrega y luego el pedido vía el `UPDATE … WHERE status = $expected` (compare-and-set) de `OrderTransitionsService`. F22 solo bloquea `orders` y nunca `deliveries` ni `riders`; F27 solo bloquea `riders`: ningún camino pide los recursos en orden inverso. El trigger `orders_open_delivery_guard` lee `deliveries` SIN bloquear. `SET LOCAL lock_timeout` (constante `COMMAND_LOCK_TIMEOUT` de F22) como primera sentencia; `55P03`/timeout de la transacción ⇒ 503 `DELIVERIES_BUSY`. Reasignación: solo se bloquea el motorista NUEVO (el anterior se libera por la propia fila de la entrega).

### 9.2 Algoritmo de `assign-own-rider` (una transacción `ReadCommitted`, 10 s, un solo `gate.run`)

```
gate.run(…)
BEGIN; SET LOCAL lock_timeout
 1 SELECT d.* , o.status, o.fulfillment_type, o.delivery_provider FROM deliveries d JOIN orders o … WHERE d.id=$1 AND <alcance deliveries.read>       -- sin bloqueo (404 uniforme / 403)
 2 SELECT r.id, r.branch_id FROM riders r WHERE r.id=$riderId FOR UPDATE                                                                        -- bloqueo del motorista (404 RIDER_NOT_FOUND si no existe o el actor no ve riders.read en r.branch_id)
 3 SELECT d.*, o.status … WHERE d.id=$1 FOR UPDATE OF d FOR SHARE OF o                                                                          -- relectura bloqueada (entrega, luego pedido)
   replay: status='assigned' AND rider_id=$riderId → 200 replayed (sin escribir)
   status ∉ (pending, assigned) o version ≠ expectedVersion → 409 DELIVERY_STATE_CONFLICT {current}
   pedido ∉ (accepted, preparing, ready) → 422 DELIVERY_ORDER_NOT_ELIGIBLE
 4 RiderEligibilityService.evaluate({riderId, branchId: d.branch_id}, tx)  -- 2 sentencias (fila de elegibilidad + findBusy real, mismo `tx`)
   razones ≠ ∅ → 422 RIDER_NOT_ELIGIBLE {violations[].code}   (sin riderBranchId)
 5 WITH upd AS (UPDATE deliveries SET status='assigned', rider_id=$riderId, assigned_at=clock_timestamp(), version=version+1, updated_at=clock_timestamp()
                 WHERE id=$1 AND version=$expected RETURNING …),
        hist AS (INSERT INTO delivery_status_history (delivery_id, old_status, status, event, rider_id, changed_by, changed_at) SELECT …)
   23505 de deliveries_one_active_per_rider_idx → 422 RIDER_NOT_ELIGIBLE (BUSY)
 6 AuditService.record(tx, { entityType:'delivery', action:'delivery.rider_assigned'|'delivery.rider_reassigned', … })
COMMIT
```

### 9.3 Algoritmo de `mark-picked-up` / `mark-delivered`

```
gate.run(…)
BEGIN; SET LOCAL lock_timeout
 1 SELECT d.*, o.status FROM deliveries d JOIN orders o … WHERE d.id=$1 AND <alcance> FOR UPDATE OF d               -- 404/403; versión y estado
   replay: d.status = destino AND d.version = expected+1 AND último evento = este comando → 200 replayed
   d.status ≠ origen o version ≠ expected → 409 DELIVERY_STATE_CONFLICT
 2 OrderTransitionsService.apply(tx', { orderId, expectedStatus: 'ready'|'on_the_way', to: 'on_the_way'|'delivered', actor: {kind:'staff', staffId},
       authorize: (order) => deliveries.update en order.branchId (si no, 403 DELIVERY_ACTION_FORBIDDEN), allowOwnDispatch: true,
       auditAction: 'order.dispatched'|'order.delivered' })      -- tx' = AdminOrdersRepository.transitionTx(client): 3 sentencias (lectura, CAS+historial, auditoría)
   pedido en otro estado → 409 ORDER_STATE_CONFLICT {current}; proveedor PEDIDOSYA → 422 ORDER_TRANSITION_INVALID
 3 UPDATE+INSERT historial (CTE) en deliveries con `version = $expected`
 4 AuditService.record delivery.picked_up|delivered
COMMIT
```

`apply` se llama DESPUÉS de bloquear la entrega y su CAS bloquea el pedido: orden entrega → pedido. Si `apply` informa `replayed=true` sin que la entrega lo fuera (estados divergentes) ⇒ 409 (falla segura; no puede ocurrir por la coherencia diferida).

### 9.4 Idempotencia (sin `Idempotency-Key`, como F22)

Repetir el MISMO comando = mismo resultado SIN duplicar historial ni auditoría (`transition.replayed=true`, `appliedByMe`): doble clic, reintento tras timeout, o dos personas con la misma intención. Condición estricta: la entrega ya está en el estado destino, `version = expectedVersion + 1` y el último evento es exactamente ese comando (para asignar, además el mismo motorista); si no, 409 (falla segura). `createAdminDelivery` y «asignar al mismo motorista» son idempotentes por estado. Una repetición exige la autorización completa. Dos personas con intenciones distintas (asignar vs cancelar): gana la primera en confirmar; la otra ve 409 con `current`.

### 9.5 Garantías en la base de datos

`UNIQUE(order_id)`; índice único parcial «una entrega activa por motorista»; CHECK de ciclo de vida; trigger de grafo y de `version`; historial solo-añadir; coherencia diferida con el estado del pedido; guarda de cancelación en `orders`. Una prueba de integración con PostgreSQL REAL demuestra: dos asignaciones simultáneas del mismo motorista a dos entregas ⇒ una gana; asignar vs desactivar al motorista (F27) ⇒ se serializan; dos `mark-picked-up` ⇒ una escribe y la otra es `replayed`; cancelar el pedido vs asignar ⇒ nunca queda una entrega abierta sobre un pedido cancelado.

## 10. Auditoría y trazabilidad

`AuditService.record(tx, …)` en la MISMA transacción, `entityType: 'delivery'`, `entityId` = id de la entrega, `branchId`, `actorId = staff.staffId`; `oldValues`/`newValues` solo con ids y estados: `{status, riderId, orderId}`; `reason` en su columna (cancelar/desasignar).

| Acción                                                                                | Cuándo                                                |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `delivery.created` / `delivery.reopened`                                              | crear / reabrir                                       |
| `delivery.rider_assigned` / `delivery.rider_reassigned` / `delivery.rider_unassigned` | asignar (`oldValues.riderId` en reasignar/desasignar) |
| `delivery.picked_up` / `delivery.delivered`                                           | recogida / entrega al cliente                         |
| `delivery.returned`                                                                   | retorno registrado                                    |
| `delivery.cancelled`                                                                  | cancelación (con `reason`)                            |

Además, `order.dispatched` y `order.delivered` (los escribe `OrderTransitionsService`) y la fila de `order_status_history` (`changed_by` = el personal). Cada comando deja UNA fila de `delivery_status_history`. Repeticiones idempotentes, conflictos y rechazos NO escriben nada. Las lecturas no se auditan. `changed_by` y `reason` nunca salen en F21.

## 11. Integración por puertos (obligaciones heredadas, decididas)

| #      | Obligación                                                       | Decisión de diseño                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Prueba que la verifica                                                                                                                                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F27-1  | Adaptador REAL de `RIDER_ACTIVE_DELIVERIES_PORT`                 | Clase `RiderActiveDeliveriesAdapter` en `src/riders/ports/` (lectura SQL de `app.deliveries`, `known: true`), enlazada en `RidersModule` en lugar de `NoActiveDeliveriesAdapter` (sin ciclo: `DeliveriesModule` importa `RidersModule`, no al revés; mismo patrón que `PaymentsReadAdapter` dentro de `OrdersModule`). `findBusy({riderIds})` = `SELECT DISTINCT rider_id … WHERE rider_id = ANY($) AND status IN ('assigned','picked_up','delivered')` (usa `deliveries_one_active_per_rider_idx`); `findBusy({branchIds})` filtra por `branch_id`. `NoActiveDeliveriesAdapter` solo queda para dobles de pruebas | R27: arrancar `AppModule`, resolver el token y comprobar que NO es `NoActiveDeliveriesAdapter` y que `findBusy` devuelve `known === true` (FALLA si el binding sigue siendo «sin entregas»); R28: int-spec con BD real (`busyIds` de `assigned/picked_up/delivered`, no de `pending/returned/cancelled`) |
| F27-2  | No reenviar `riderBranchId`                                      | El servicio de F28 mapea `RiderEligibility` a `violations[].code` y nunca copia `riderBranchId`; el 404 `RIDER_NOT_FOUND` cubre rider inexistente o no visible                                                                                                                                                                                                                                                                                                                                                                                                                                                     | R29: la respuesta serializada de un motorista de otra sucursal no contiene ningún UUID de sucursal ajeno                                                                                                                                                                                                 |
| F27-3  | UUID de `branchId` antes de `findEligibilityRow`                 | `branchId` proviene de `deliveries.branch_id` (BD), no del cliente, y `riderId` se valida con `@IsUUID` en el DTO; además `RiderEligibilityService.evaluate` valida ambos con `isUUID` y devuelve `NOT_FOUND` (cambio aditivo en F27)                                                                                                                                                                                                                                                                                                                                                                              | R30 (unitaria)                                                                                                                                                                                                                                                                                           |
| F27-4  | `findBusy` en el MISMO `gate.run`; suma de cupos ≤ `DB_POOL_MAX` | F28 hace TODO en un único `gate.run` y pasa `tx` a `evaluate`/`findBusy`. En F27 se corrigen `RidersQueriesService.get` (une `findOne` + `findBusy` en una sola tarea) y el `db()` aparte de `RidersCommandsService`. `splitGateBudget` pasa a repartir `{checkout, orders, store, riders, deliveries}` con `riders = deliveries = max(1, floor(B/8))` restados de `store` (pool 10: 3+2+2+1+1 = 9 ≤ 9); `RIDERS_DB_GATE` y `DELIVERIES_DB_GATE` usan cada uno el suyo. Requisito operativo: `DB_POOL_MAX ≥ 6` (con menos, la excepción documentada de pool pequeño: el mínimo de 1 por gate suma más que el pool) | R31: `db-gate.spec.ts` verifica `suma ≤ pool − 1` para pool 6..60 y que el cupo de cada gate ≥ 1 (la prueba ROJA con el reparto actual de F27)                                                                                                                                                           |
| F22-5  | Adaptador REAL de `OrderFulfillmentPort`                         | `DeliveriesFulfillmentAdapter` en `src/orders/ports/` (lectura SQL de `deliveries` por `order_id`, 1 sentencia; `activeDelivery = status IN ('pending','assigned','picked_up')`; `pendingActions: []` para `OWN` porque cancelar/rechazar con entrega abierta ya se rechaza; `delivery_cancellation` reservado a F29), enlazado en `OrdersModule` en lugar de `NoDeliveryFulfillment`. Solo lectura; F22 no escribe entregas                                                                                                                                                                                       | R32 (S) y R33 (I); F22 sigue verde (`NoDeliveryFulfillment` se conserva para sus dobles)                                                                                                                                                                                                                 |
| F22-5b | Acción `dispatch` de F22                                         | PASA A HABILITADA para `OWN` si el personal tiene `deliveries.assign` en la sucursal del pedido (solo en `ready`, como hoy); sigue deshabilitada con `PROVIDER_BLOCKED_EXTERNAL` para `PEDIDOSYA` y `NO_PERMISSION` sin permiso. NO es un comando de pedidos: la web abre Entregas (crear + asignar). `DISPATCH_NOT_AVAILABLE` queda en el enum (valor heredado, ya no se emite para `OWN`). Razón: mínima y aditiva, evita que la web duplique la regla; mantenerla informativa dejaría un botón muerto                                                                                                           | R34: `order-transition.matrix.spec.ts` actualizado                                                                                                                                                                                                                                                       |
| F22-6  | Cancelar pedido con entrega activa                               | §6.3: rechazo 409 `ORDER_HAS_ACTIVE_DELIVERY` + trigger + traducción en F22                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | R20–R22                                                                                                                                                                                                                                                                                                  |

## 12. Seguimiento del cliente (F21) — `delivery.status` (P113)

**Decisión: F28 lo rellena, de forma aditiva y sin PII del motorista**, como ÚLTIMA tarea del slice (no bloquea el resto). `OrderTracking.delivery.status` pasa de `null` a un estado público grueso derivado de la entrega: `PENDING` (sin motorista), `ASSIGNED`, `PICKED_UP`, `DELIVERED` (incluye el retorno); `null` si no hay entrega, está `cancelled` o el proveedor es `PEDIDOSYA` (F29). Nunca nombre, teléfono, vehículo, ubicación ni ETA del motorista. Cambio: un `LEFT JOIN app.deliveries` en la lectura del seguimiento (0 sentencias extra) y una función pura `publicDeliveryStatus`; el tipo del contrato sigue siendo `string` (sin romper clientes). Justificación: ya está definido el hueco (`status` «reservado para F28/F29»), el estado del pedido (`on_the_way`/`delivered`) ya es público y añadir `ASSIGNED` aporta el único paso intermedio que hoy falta sin exponer a una persona. Alternativa descartada: diferir a F30 — deja el hueco sin uso cuando ya existe la fuente. Riesgo: las pruebas de F21 que fijan `status: null` se actualizan; sigue sin filtrar datos.

## 13. Web (backoffice; lo implementa web-engineer)

- **Ubicación**: reconvertir `sushimon-web/src/features/bo-deliveries` en la pantalla REAL de Entregas propias (ruta existente `app/(backoffice)/backoffice/(app)/entregas`), con servicio en `lib/data-access` (adaptadores `mock` y `http`, tipos desde `@sushimon/contracts`). Modelo `AdminDelivery*` NUEVO. **El mock de PedidosYa se CONSERVA rotulado «Simulación — no es un envío real»** (cotizar/solicitar/seguir sigue siendo `MOCK_ONLY`/`BLOCKED_EXTERNAL`; nunca confirma entregas reales) y se separa visualmente de «Reparto propio».
- **Lista**: tabla/tarjetas responsive, filtros sucursal/estado (por defecto abiertos)/motorista, indicador «Esperando retorno» (`awaitingReturn`), cursor «Cargar más», esqueleto, vacío, error con reintento; polling dirigido (TanStack Query, `refetchInterval` acotado, pausa con pestaña oculta, invalidación de la fila tras un comando — «refresco dirigido»).
- **Detalle/drawer**: pedido, motorista (nombre, vehículo, teléfono enmascarado), línea de tiempo del historial, contacto y dirección solo si `contactVisible`, acciones según `availableActions` (el cliente solo oculta; el servidor decide): asignar/reasignar (selector de motoristas ELEGIBLES de la sucursal desde `GET /v1/admin/riders?branchId&availability=AVAILABLE`, requiere `riders.read`), desasignar, recoger, entregar, retorno (confirmación), cancelar entrega (motivo obligatorio con aviso de PII).
- **Conflictos**: `DELIVERY_STATE_CONFLICT`/`ORDER_STATE_CONFLICT` ⇒ aplicar `current`, avisar y reofrecer; `replayed=true` ⇒ aviso «ya estaba hecho»; `RIDER_NOT_ELIGIBLE` ⇒ mensaje por razón; `ORDER_HAS_ACTIVE_DELIVERY` en cancelar pedido ⇒ ofrecer «Cancelar entrega y luego el pedido». Sin actualización optimista. Sin PII en `localStorage`/URL.
- **`bo-orders`**: la acción `dispatch` habilitada abre Entregas (crear idempotente + asignar); retirar del flujo `http` el `DispatchModal` simulado SOLO para `OWN` (PedidosYa sigue en el mock rotulado).
- **Transversales**: i18n es/en, tema claro/oscuro, responsive, accesibilidad (foco en modales, `aria-live`), comparación con el prototipo (`docs/ui/prototype-inventory.md`).
- **Calidad**: Vitest (modelo, reglas de visibilidad, conflictos), Playwright (flujo mock: crear → asignar → recoger → entregar → retorno), revisión `ui-ux-reviewer`; verificación manual contra API real con el patrón de F27 §20.

## 14. Cambios a código existente (todos aditivos y mínimos)

| Archivo                                                                                                           | Cambio                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sushimon-api/src/orders/admin/admin-orders.repository.ts`                                                        | Exponer `transitionTx(client: Prisma.TransactionClient): TransitionTx` (hoy `private txOf`) para pasar la transacción de F28 a `apply`                                |
| `sushimon-api/src/orders/admin/order-admin-errors.ts` / `orders-errors.ts`                                        | `translateOrdersDbError`: `23001` (`restrict_violation`) ⇒ 409 `ORDER_HAS_ACTIVE_DELIVERY` con `current`; códigos nuevos en el filtro                                 |
| `sushimon-api/src/orders/admin/order-transition.matrix.ts` (+ spec)                                               | `availableActionsFor`: `dispatch` habilitada para `OWN` con `deliveries.assign` (§11 F22-5b)                                                                          |
| `sushimon-api/src/orders/ports/` + `orders.module.ts`                                                             | `DeliveriesFulfillmentAdapter` real en lugar de `NoDeliveryFulfillment`                                                                                               |
| `sushimon-api/src/riders/ports/` + `riders.module.ts`                                                             | `RiderActiveDeliveriesAdapter` real en lugar de `NoActiveDeliveriesAdapter`; `RIDERS_DB_GATE` con su cupo propio                                                      |
| `sushimon-api/src/riders/riders-queries.service.ts`, `riders-commands.service.ts`, `rider-eligibility.service.ts` | `findBusy` dentro del mismo `gate.run`; validación `isUUID` en `evaluate`                                                                                             |
| `sushimon-api/src/common/concurrency/db-gate.ts` (+ spec)                                                         | `splitGateBudget` con `riders` y `deliveries`; suma ≤ `pool − 1`                                                                                                      |
| `sushimon-api/src/common/throttle/app-throttler.guard.ts`                                                         | `ADMIN_DELIVERIES_READ_THROTTLE` y `ADMIN_DELIVERIES_COMMAND_THROTTLE` (mismas formas que F27: lectura 120/min IP y 60/min actor; escritura 60/min IP y 30/min actor) |
| `sushimon-api/src/orders/order-tracking.mapper.ts` + fuente de lectura                                            | `delivery.status` público (§12)                                                                                                                                       |
| `sushimon-api/src/app.module.ts`                                                                                  | Registrar `DeliveriesModule`; excluir `admin/deliveries*` del `no-store` genérico (como riders/payments)                                                              |

## 15. Rendimiento y presupuesto de sentencias SQL

Volumen: ~100 pedidos/día (≈ 30–60 entregas propias/día), decenas de motoristas, 3→5 sucursales. Presupuesto por endpoint (sentencias de aplicación; sin `BEGIN/COMMIT`, sin el `SET LOCAL` y sin la lectura de `grants` de la autenticación):

| Endpoint                                             | Típico | Máximo | Detalle                                                                                                                                         |
| ---------------------------------------------------- | ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /deliveries`                                    | 1      | 1      | filas con JOINs, keyset, sin conteo                                                                                                             |
| `GET /deliveries/{id}`                               | 2      | 2      | fila + historial (≤ 50)                                                                                                                         |
| `POST /deliveries`                                   | 3      | 5      | lectura del pedido; `INSERT … ON CONFLICT DO NOTHING` + historial (CTE); si existía: lectura (+ reapertura CTE); auditoría                      |
| `…/assign-own-rider`                                 | 8      | 9      | lectura con alcance; bloqueo del motorista; relectura bloqueada; elegibilidad (2: fila + `findBusy`); UPDATE+historial (CTE); auditoría         |
| `…/unassign-rider`, `…/cancel`, `…/return-to-branch` | 3      | 4      | lectura FOR UPDATE; UPDATE+historial (CTE); auditoría                                                                                           |
| `…/mark-picked-up`, `…/mark-delivered`               | 6      | 7      | lectura FOR UPDATE; `apply` (lectura del pedido, CAS+historial, auditoría; +1 `readState` en repetición/conflicto); UPDATE+historial; auditoría |

Sin N+1 (el listado no carga historial ni PII); nunca más de `limit ≤ 100` filas ni de 50 eventos de historial; transacciones cortas sin I/O externo; un único `gate.run` por operación. Índices: `UNIQUE(order_id)`, `deliveries_one_active_per_rider_idx`, `deliveries_branch_status_created_idx`, `deliveries_rider_idx`, `delivery_status_history_delivery_idx`. `EXPLAIN` real de listado (alcance acotado y global), de `findBusy` por `riderIds` y por `branchIds`, y del trigger de `orders`: pendiente de implementación (§19).

## 16. Matriz de pruebas (U unitaria · S servicio con dobles · E e2e supertest · I int-spec contra PostgreSQL real · W Vitest web · P Playwright)

| #   | Caso                                                                                                                                                                                                                                                                        | Nivel                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| R01 | `availableDeliveryActionsFor`: tabla por estado y por permiso (`NO_PERMISSION`, `ORDER_NOT_READY`); misma tabla que la matriz de §3.2                                                                                                                                       | U                                                                                                                                      |
| R02 | Barrido de TODOS los pares de estados: la API y el trigger aceptan/rechazan exactamente lo mismo                                                                                                                                                                            | U+I                                                                                                                                    |
| R03 | Crear: feliz ⇒ 201 `pending`, `version=1`, historial `created`, auditoría `delivery.created` sin PII                                                                                                                                                                        | E+I                                                                                                                                    |
| R04 | Crear dos veces ⇒ 200 `replayed` sin segunda fila; crear sobre `cancelled` ⇒ 201 `reopened`; sobre `returned` ⇒ 409                                                                                                                                                         | E+I                                                                                                                                    |
| R05 | Crear con pedido PICKUP / `PEDIDOSYA` / `pending` / terminal ⇒ 422 `DELIVERY_ORDER_NOT_ELIGIBLE` con `violations[].code`; PEDIDOSYA jamás crea fila                                                                                                                         | E+I                                                                                                                                    |
| R06 | Asignar feliz: `pending → assigned`, `rider_id`, `assigned_at`, historial `rider_assigned`, auditoría; ocupación visible en F27 (`busy=true`, `busyKnown=true`)                                                                                                             | E+I                                                                                                                                    |
| R07 | Elegibilidad: una prueba por razón (`INACTIVE`, `WRONG_BRANCH`, `UNAVAILABLE`, `BUSY`, `OWN_DELIVERY_DISABLED`) ⇒ 422 `RIDER_NOT_ELIGIBLE`; `eligible` ⇒ 200; sin `riderBranchId` en la respuesta                                                                           | S+E                                                                                                                                    |
| R08 | Doble asignación: dos entregas distintas, mismo motorista, en paralelo ⇒ una 200 y una 422 `BUSY`; el índice único parcial lo respalda aunque se salte la elegibilidad (SQL directo ⇒ `23505`)                                                                              | I                                                                                                                                      |
| R09 | Asignar vs desactivar/trasladar al motorista (F27) en paralelo ⇒ serializados (uno ve el estado del otro)                                                                                                                                                                   | I                                                                                                                                      |
| R10 | Reasignar antes de la recogida: nuevo motorista ocupado, anterior libre, historial `rider_reassigned` con el motorista nuevo; reasignar con `picked_up` ⇒ 409                                                                                                               | E+I                                                                                                                                    |
| R11 | Asignar al MISMO motorista ⇒ 200 `replayed`; repetir con la misma versión tras éxito ⇒ `replayed` sin duplicar historial                                                                                                                                                    | E+I                                                                                                                                    |
| R12 | Desasignar: `assigned → pending`, motorista libre, historial `rider_unassigned` con `reason` opcional                                                                                                                                                                       | E+I                                                                                                                                    |
| R13 | Recoger: `assigned → picked_up` y pedido `ready → on_the_way` en UNA transacción (historial y auditoría de ambos); pedido en `preparing` ⇒ 409 `ORDER_STATE_CONFLICT` sin cambios; `PEDIDOSYA` ⇒ 422                                                                        | E+I                                                                                                                                    |
| R14 | Entregar: `picked_up → delivered` y pedido `on_the_way → delivered`; el motorista SIGUE ocupado                                                                                                                                                                             | E+I                                                                                                                                    |
| R15 | Retorno: `delivered → returned`, `returned_at`, historial `returned`, motorista libre, `busy=false`; el retorno es una fila de historial SEPARADA de la entrega; no cambia el pedido                                                                                        | E+I                                                                                                                                    |
| R16 | Retorno nunca registrado: la entrega queda `delivered`, el motorista ocupado y filtrable (`status=delivered`); un registro tardío lo libera                                                                                                                                 | I                                                                                                                                      |
| R17 | Idempotencia de cada comando (`mark-picked-up`, `mark-delivered`, `return-to-branch`, `cancel`, `unassign-rider`): repetir ⇒ 200 `replayed`, SIN fila de historial ni auditoría nueva; `appliedByMe` correcto                                                               | E+I                                                                                                                                    |
| R18 | Conflicto: `expectedVersion` vieja ⇒ 409 `DELIVERY_STATE_CONFLICT` con `current`; dos comandos simultáneos con la misma versión ⇒ uno gana y el otro 409                                                                                                                    | I                                                                                                                                      |
| R19 | Todo o nada: si falla la auditoría o el historial, no cambia ni la entrega ni el pedido (rollback conjunto)                                                                                                                                                                 | I                                                                                                                                      |
| R20 | Cancelar entrega: `pending                                                                                                                                                                                                                                                  | assigned → cancelled`con`reason`obligatorio (sin motivo ⇒ 400`DELIVERY_REASON_REQUIRED`); libera al motorista; desde `picked_up` ⇒ 409 | E+I                                                                                                                                |
| R21 | `cancelAdminOrder`/`rejectAdminOrder` con entrega `pending                                                                                                                                                                                                                  | assigned                                                                                                                               | picked_up`⇒ 409`ORDER_HAS_ACTIVE_DELIVERY`(el trigger`23001` mapeado) sin cambios; tras cancelar la entrega ⇒ el pedido se cancela | E+I       |
| R22 | Cancelar el pedido vs asignar en paralelo: nunca queda una entrega abierta sobre un pedido cancelado (cualquiera de los dos orden de llegada)                                                                                                                               | I                                                                                                                                      |
| R23 | Permisos por ruta y rol (`admin`, `manager`, `staff`, `kitchen`): `staff` ve pero no actúa; asignar sin `riders.assign` ⇒ 403; aal1 ⇒ 403 `MFA_REQUIRED`; sin token ⇒ 401                                                                                                   | E                                                                                                                                      |
| R24 | Alcance: entrega/pedido/motorista de otra sucursal ⇒ el MISMO 404 (cuerpo idéntico) en detalle y en TODOS los comandos; el listado nunca devuelve filas ajenas; `branchId` ajeno ⇒ 404 `BRANCH_NOT_FOUND`; un manager de A no asigna un motorista de B (`WRONG_BRANCH`/404) | E+I                                                                                                                                    |
| R25 | PII: lista sin teléfono ni dirección; detalle con contacto y dirección solo si abierta y `orders.read`; `returned/cancelled` ⇒ `contactVisible=false`; motorista sin placa/teléfono completo/sucursal; `private, no-store` en todo (también 4xx/5xx)                        | E                                                                                                                                      |
| R26 | Logs y errores sin teléfono/dirección/nombre (espía del logger en 400/403/404/409/422/500)                                                                                                                                                                                  | E                                                                                                                                      |
| R27 | Binding real del puerto de ocupación: FALLA si el token resuelve a `NoActiveDeliveriesAdapter` o `known !== true`                                                                                                                                                           | S+E                                                                                                                                    |
| R28 | `findBusy` real: ids de `assigned/picked_up/delivered`; excluye `pending/returned/cancelled`; por `riderIds` y por `branchIds`; las acciones peligrosas de F27 ahora bloquean con 409 `RIDER_HAS_ACTIVE_DELIVERY`                                                           | I                                                                                                                                      |
| R29 | La respuesta de un motorista de otra sucursal no filtra su `branch_id` ni el de ningún tercero                                                                                                                                                                              | E                                                                                                                                      |
| R30 | `evaluate` con UUID inválido ⇒ `NOT_FOUND`, sin sentencia con cast fallido                                                                                                                                                                                                  | U                                                                                                                                      |
| R31 | `splitGateBudget`: suma de cupos ≤ `pool − 1` (pool 6..60); F27 (`riders`) y F28 (`deliveries`) tienen gate propio; saturación ⇒ 503 `DELIVERIES_BUSY`                                                                                                                      | U+E                                                                                                                                    |
| R32 | `DeliveriesFulfillmentAdapter`: `activeDelivery` real y `pendingActions: []` para `OWN`; `inspect` de F22 tras `cancel` no rompe                                                                                                                                            | S                                                                                                                                      |
| R33 | F22 sigue verde: `dispatch` habilitada para `OWN` con `deliveries.assign`, deshabilitada sin permiso y con `PEDIDOSYA`; matriz y comandos sin regresión                                                                                                                     | U+E                                                                                                                                    |
| R34 | Tracking F21: `delivery.status` por estado de la entrega (`PENDING                                                                                                                                                                                                          | ASSIGNED                                                                                                                               | PICKED_UP                                                                                                                          | DELIVERED | null`), sin ningún dato del motorista; pedidos sin entrega o `PEDIDOSYA`⇒`null` | E+I |
| R35 | Presupuesto: contador de sentencias por endpoint ≤ §15                                                                                                                                                                                                                      | I                                                                                                                                      |
| R36 | Lectura: filtros (`status`, `riderId`, `branchId`, `from/to` solo en terminales), orden, cursor (alterado ⇒ 400), página vacía                                                                                                                                              | E+I                                                                                                                                    |
| R37 | Throttle: 429 con `Retry-After`; `lock_timeout` ⇒ 503 `DELIVERIES_BUSY`                                                                                                                                                                                                     | E                                                                                                                                      |
| R38 | Migración 0022: relanzable, CHECK de ciclo de vida, `UNIQUE(order_id)`, índice parcial, grafo, motorista activo/misma sucursal, pedido DELIVERY OWN, sin DELETE, historial solo-añadir, coherencia diferida, guarda de `orders`, RLS/REVOKE                                 | I                                                                                                                                      |
| R39 | `contracts:check` verde tras implementar; DTOs coinciden con el YAML                                                                                                                                                                                                        | E                                                                                                                                      |
| W01 | Lista: carga, vacío, error+reintento, filtros, cursor, indicador «Esperando retorno»                                                                                                                                                                                        | W                                                                                                                                      |
| W02 | Detalle: línea de tiempo, contacto solo con `contactVisible`, acciones por `availableActions` (ocultas sin permiso)                                                                                                                                                         | W                                                                                                                                      |
| W03 | Asignación: solo motoristas elegibles; errores 422/409/404 mapeados; `expectedVersion` reenviada; `replayed` informativo                                                                                                                                                    | W                                                                                                                                      |
| W04 | Retorno separado de la entrega; cancelar con motivo; flujo de cancelar pedido con entrega abierta (409 → ofrecer cancelar entrega)                                                                                                                                          | W                                                                                                                                      |
| W05 | PedidosYa sigue rotulado «Simulación» y sin botones reales; i18n es/en, tema, responsive                                                                                                                                                                                    | W                                                                                                                                      |
| P01 | Flujo mock: crear → asignar → recoger → entregar → retorno; reasignación y cancelación                                                                                                                                                                                      | P                                                                                                                                      |

Trazabilidad ficha → matriz: sin doble asignación R08/R09; historial R03–R15/R19; retorno libera R15/R16/R28; pedido solo por el servicio R13/R14 (más una prueba estática: el módulo de entregas no contiene `UPDATE app.orders`); idempotencia R11/R17; permiso por sucursal R23/R24; PII R25/R26.

## 17. Riesgos aceptados y decisiones

- **Entrega fallida sin salida (P107)**: con la entrega `picked_up` y el cliente ausente no hay transición válida; el motorista sigue ocupado y el pedido `on_the_way` hasta F32. Mitigación operativa (procedimiento de soporte documentado, no API) y prioridad alta para F32.
- **Retorno no registrado (P106)**: el motorista queda «ocupado» indefinidamente hasta que alguien lo registre; visible con el filtro y el indicador. Sin temporizador automático por diseño.
- **Cancelar pedido exige dos pasos** (cancelar entrega y luego pedido) y no es atómico: la web los encadena y, ante una carrera, el segundo paso puede fallar con 409 (reintentable).
- **Orden de despliegue**: con los adaptadores reales enlazados, la API necesita la migración 0022 aplicada; sin ella las consultas de `findBusy` fallarían (42P01). Aplicar 0022 ANTES del despliegue de la API; prueba de humo en `/v1/health/ready` ampliada si procede.
- **Cambios en el cupo de `DbGate`**: modificar `splitGateBudget` reparte distinto el pool entre tienda/cotización/pedidos; requiere `DB_POOL_MAX ≥ 6` en producción (hoy el defecto es 3: se mantiene la excepción documentada de pool pequeño).
- **Tablero de F22**: `dispatch` habilitada cambia lo que el cliente ve en `availableActions` (mismo esquema).
- **Contradicción con F24**: la nota «F28 añadirá `RIDER` como cobrador» no se cumple (P112); `PaymentCollectorType` queda en `[STAFF]` y la rendición sigue abierta (P85).
- **Roles**: `staff` y `kitchen` no operan entregas (P109/P110); solo `admin`/`manager` despachan, sin cambiar RBAC.
- Decisiones P105–P114 con recomendación adoptada (ver `decisiones-pendientes.md`).

## 18. Qué NO hace F28

- No integra PedidosYa ni simula una entrega real: ninguna ruta llama a un proveedor; con `PEDIDOSYA` se rechaza con 422 y el mock de la web queda rotulado «Simulación» (F29, `BLOCKED_EXTERNAL`).
- No gestiona cobro de efectivo del motorista, rendición de caja ni compensaciones (F24 registra el cobro del personal; P85/P112).
- No registra entrega fallida, no entregada, incidencias ni reembolsos (F32/F26).
- No guarda GPS, ubicación, ETA, fotos, firma ni PIN de entrega; no notifica (F31).
- No crea cuentas ni rutas para motoristas; no usa `staff_users` como riders.
- No activa `ownDeliveryZonesEnabled` ni modifica zonas (F09), ni cambia RBAC.
- No escribe `orders` por SQL: solo `OrderTransitionsService.apply`; el único cambio en `orders` es un trigger de guarda de solo lectura.
- No agrega Redis, colas, jobs, WebSockets, microservicios ni librerías; sin temporizadores.
- No ofrece `DELETE`, reportes ni exportaciones (F34/F35); no calcula tarifas ni cotizaciones.

## 19. Plan por agente y orden de trabajo

1. **`database-engineer`**: migración `0022_own_deliveries` (§3.3), `schema.prisma` (modelos y relaciones), `test/migration-0022.int-spec.ts`; numerar tras `git fetch`; NO aplicar en la base compartida (la aplica el usuario).
2. **`api-engineer`**: `DeliveriesModule` (controlador, servicios de consulta y comandos, repositorio `$queryRaw`, DTOs `class-validator` + `@ApiProperty` alineados al YAML, errores, gate propio, throttles); adaptadores reales de los dos puertos; cambios aditivos de §14; función `availableDeliveryActionsFor`; pruebas R01–R39 (excepto web); `pnpm contracts:check` verde.
3. **`web-engineer`**: §13 (modelo, servicio mock/http, pantalla, drawer, hooks, integración con `bo-orders`), W01–W05/P01.
4. **`security-reviewer`** (alcance, anti-IDOR, PII, orden de bloqueos, trigger de `orders`), **`qa-engineer`** (matriz), **`ui-ux-reviewer`**, **`performance-reviewer`** (`EXPLAIN`, presupuesto §15).
5. Orden: BD → API → web → revisiones → verificación real (BD de pruebas, API real, navegador, como F27 §20). F29/F30/F31/F32 NO se empiezan.

## 20. Estado (implementado · simulado · pendiente de proveedor · bloqueado)

| Pieza                                                           | Estado                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Contrato OpenAPI y tipos (`admin-deliveries`, cambios aditivos) | Hecho; `contracts:check` rojo solo por las 9 operaciones sin implementar             |
| Spec, ADR-0032, P105–P114, `planned-endpoints.md`               | Hecho                                                                                |
| Migración 0022, `schema.prisma`                                 | Pendiente (DDL de referencia en §3.3; NO aplicada)                                   |
| API (`/v1/admin/deliveries`, adaptadores reales)                | Pendiente                                                                            |
| Web (Entregas propias)                                          | Pendiente; el mock de despacho actual se conserva                                    |
| Despacho PedidosYa                                              | Simulado en la web (`MOCK_ONLY`); real `BLOCKED_EXTERNAL` (F29)                      |
| Estado de F28                                                   | `CONTRACT_DEFINED`; `READY` solo con migración aplicada, API, web, BD real y pruebas |

## 21. Cambio propuesto al backlog maestro (F28)

Texto sugerido (NO se edita `docs/BACKLOG.md` aquí; lo aplica quien coordine): rutas de la ficha F28 + `POST /v1/admin/deliveries`, `POST /v1/admin/deliveries/:id/unassign-rider` y `POST /v1/admin/deliveries/:id/cancel`; «Datos: `app.deliveries` (+ `branch_id`, `returned_at`, `cancelled_at`, `version`, `created_at`, `updated_at`), `app.delivery_status_history` (+ `old_status`, `event`, `rider_id`, `reason`); migración 0022»; «Brecha resuelta: retorno persistido como evento separado (`returned`) que libera al motorista; ocupación derivada de la entrega por el puerto de F27; sin entrega fallida (F32)»; «Abiertas: P105–P114»; «Obligaciones de F27 cumplidas: adaptador real del puerto, `riderBranchId` no expuesto, UUID validado, gate único y cupos ≤ pool».

## 22. Verificación pendiente de implementación

- Confirmar con PostgreSQL real que `FOR UPDATE OF d FOR SHARE OF o` y el trigger de `orders` no producen ciclos con F22/F27 (prueba de concurrencia R09/R22) y el SQLSTATE `23001` visible en el error de Prisma (`meta.code`).
- Confirmar con `EXPLAIN` que el listado usa `deliveries_branch_status_created_idx` con alcance acotado y global, y que `findBusy` usa `deliveries_one_active_per_rider_idx`.
- Confirmar el valor real de `DB_POOL_MAX` en producción (el defecto del código es 3) y ajustar `splitGateBudget` sin dejar el pool sin conexiones libres.
- Confirmar con negocio P105–P114 antes de ampliar permisos o añadir `mark-failed`.
- Confirmar que `AdminOrdersRepository.transitionTx` no rompe los dobles de F22 y que `apply` acepta una transacción abierta por F28 (comprobación de `SET LOCAL lock_timeout` única).
