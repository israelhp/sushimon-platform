-- 0022 · F28 entregas con repartidores propios (specs/029-own-deliveries §3, ADR-0032). CREA app.deliveries y
-- app.delivery_status_history (el DBML las define; las columnas añadidas sobre el DBML se justifican abajo, en la spec §3 y en
-- docs/database/README.md) y AÑADE un trigger de guarda a app.orders. El DBML no se edita.
-- Aditiva y NO destructiva: solo CREATE (tablas, funciones, triggers, índices, comentarios) y ENABLE RLS/REVOKE sobre objetos
-- NUEVOS. No toca datos ni columnas existentes, ni role_permissions. Relanzable (IF NOT EXISTS, CREATE OR REPLACE, triggers
-- guardados por catálogo). Guarda inicial (como 0018/0019/0021): si app.deliveries o app.delivery_status_history ya existen con
-- otra definición (falta una columna o restricción esperada), RAISE EXCEPTION y no se modifica nada.
-- Requiere 0003 (branches), 0018 (orders) y 0021 (riders).
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real.
--
-- Reversión manual (destructiva; solo si no hay entregas que conservar; aprobación humana), en este orden:
--   DROP TRIGGER orders_open_delivery_guard ON app.orders;
--   DROP TABLE app.delivery_status_history;
--   DROP TABLE app.deliveries;
--   DROP FUNCTION app.deliveries_guard(), app.deliveries_order_coherence(),
--                 app.delivery_status_history_append_only(), app.orders_open_delivery_guard();
--
-- Excepción de limpieza (precedente 0004/0018/0019/0021): un DELETE sobre deliveries o delivery_status_history se permite SOLO si
-- la transacción hizo `SET LOCAL app.allow_order_cleanup = 'on'`. La API nunca lo hace; lo usan las pruebas. No es un control de acceso.
--
-- NULL en CHECK: un CHECK solo falla con FALSE (con NULL pasa; ver 0020). Las columnas del CHECK de ciclo de vida que importan para
-- el estado son NOT NULL (status); las marcas de tiempo anulables se comparan con IS [NOT] NULL explícito. deliveries_order_times_chk
-- usa `>=` y con NULL pasa: es lo deseado (solo compara marcas ya presentes).
--
-- Cambios respecto del DDL de referencia de la spec §3.3 (ver la nota en specs/029-own-deliveries/spec.md §3.4):
--   (a) deliveries_guard toma `SELECT … FOR SHARE` sobre la fila del pedido al INSERT, al reabrir (cancelled → pending) y al asignar
--       (→ assigned): la FK solo toma FOR KEY SHARE, que NO choca con el FOR NO KEY UPDATE de un UPDATE orders.status; sin ese
--       bloqueo, «crear entrega» y «cancelar pedido» podían confirmar ambos (el trigger de orders no veía la entrega aún sin
--       confirmar y la coherencia diferida no veía la cancelación aún sin confirmar) y dejar una entrega abierta sobre un pedido
--       cancelado. Orden de bloqueos intacto: motorista → entrega → pedido (en INSERT la fila de la entrega aún no existe).
--   (b) deliveries_order_coherence RELEE la entrega actual por id (no usa NEW): un trigger diferido ve la versión de la fila de su
--       evento, y si la entrega cambió varias veces en la misma transacción evaluaría un estado ya superado contra el estado FINAL
--       del pedido (falso positivo). Si la fila ya no existe (limpieza de pruebas) no hay nada que verificar.
--   (c) deliveries_guard exige que las marcas de tiempo ya establecidas (picked_up_at, delivered_at, returned_at, y assigned_at en
--       picked_up/delivered/returned) no se reescriban (el CHECK solo valida presencia/orden, no que el valor se conserve).
--   (d) Guarda inicial ampliada: exige que existan app.orders, app.branches y app.riders, y verifica columnas y restricciones de
--       las dos tablas nuevas.

-- ------------------------------------------------------------------------------------------------
-- 0) Guarda: requisitos y, si las tablas ya existen, columnas y restricciones esperadas.
-- ------------------------------------------------------------------------------------------------
DO $$
DECLARE
    v_col text;
    v_con text;
BEGIN
    IF to_regclass('app.orders') IS NULL OR to_regclass('app.branches') IS NULL OR to_regclass('app.riders') IS NULL THEN
        RAISE EXCEPTION '0022: requiere app.branches (0003), app.orders (0018) y app.riders (0021); aplicar las migraciones previas.';
    END IF;

    IF to_regclass('app.deliveries') IS NOT NULL THEN
        FOREACH v_col IN ARRAY ARRAY['id', 'order_id', 'branch_id', 'rider_id', 'status', 'assigned_at', 'picked_up_at',
                                     'delivered_at', 'returned_at', 'cancelled_at', 'delivery_notes', 'version',
                                     'created_at', 'updated_at'] LOOP
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'app' AND table_name = 'deliveries' AND column_name = v_col
            ) THEN
                RAISE EXCEPTION '0022: app.deliveries ya existe con otra definicion (falta la columna %); no se modifica. Revisar a mano.', v_col;
            END IF;
        END LOOP;
        FOREACH v_con IN ARRAY ARRAY['deliveries_pkey', 'deliveries_order_id_key', 'deliveries_order_id_fkey',
                                     'deliveries_branch_id_fkey', 'deliveries_rider_id_fkey', 'deliveries_status_chk',
                                     'deliveries_version_chk', 'deliveries_notes_chk', 'deliveries_lifecycle_chk',
                                     'deliveries_order_times_chk'] LOOP
            IF NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = 'app.deliveries'::regclass AND conname = v_con
            ) THEN
                RAISE EXCEPTION '0022: app.deliveries ya existe con otra definicion (falta la restriccion %); no se modifica. Revisar a mano.', v_con;
            END IF;
        END LOOP;
    END IF;

    IF to_regclass('app.delivery_status_history') IS NOT NULL THEN
        FOREACH v_col IN ARRAY ARRAY['id', 'delivery_id', 'old_status', 'status', 'event', 'rider_id', 'reason',
                                     'changed_by', 'changed_at'] LOOP
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'app' AND table_name = 'delivery_status_history' AND column_name = v_col
            ) THEN
                RAISE EXCEPTION '0022: app.delivery_status_history ya existe con otra definicion (falta la columna %); no se modifica. Revisar a mano.', v_col;
            END IF;
        END LOOP;
        FOREACH v_con IN ARRAY ARRAY['delivery_status_history_pkey', 'delivery_status_history_delivery_id_fkey',
                                     'delivery_status_history_rider_id_fkey', 'delivery_status_history_chk'] LOOP
            IF NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = 'app.delivery_status_history'::regclass AND conname = v_con
            ) THEN
                RAISE EXCEPTION '0022: app.delivery_status_history ya existe con otra definicion (falta la restriccion %); no se modifica. Revisar a mano.', v_con;
            END IF;
        END LOOP;
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 1) app.deliveries (DBML ampliado). Una entrega por pedido (UNIQUE order_id); una cancelada se REABRE. Sin DELETE.
-- ------------------------------------------------------------------------------------------------
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
    CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id")
        REFERENCES "app"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deliveries_branch_id_fkey" FOREIGN KEY ("branch_id")
        REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deliveries_rider_id_fkey" FOREIGN KEY ("rider_id")
        REFERENCES "app"."riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
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
-- UNA entrega activa por motorista (doble asignación imposible incluso con una carrera o un bug). El motorista queda ocupado hasta
-- registrar el retorno. También sirve a findBusy({riderIds}) del puerto de F27.
CREATE UNIQUE INDEX IF NOT EXISTS "deliveries_one_active_per_rider_idx" ON "app"."deliveries" ("rider_id")
    WHERE "status" IN ('assigned', 'picked_up', 'delivered');
-- Listado por sucursal/estado con orden estable y keyset (created_at, id); cubre la FK branch_id y findBusy({branchIds}).
CREATE INDEX IF NOT EXISTS "deliveries_branch_status_created_idx" ON "app"."deliveries" ("branch_id", "status", "created_at" DESC, "id" DESC);
-- FK rider_id y consultas «entregas de un motorista» (historial por motorista, filtro riderId).
CREATE INDEX IF NOT EXISTS "deliveries_rider_idx" ON "app"."deliveries" ("rider_id") WHERE "rider_id" IS NOT NULL;
-- NO se indexa order_id aparte (UNIQUE ya lo hace; también sirve al trigger de orders) ni created_at/updated_at sueltos (volumen: decenas/día).

-- ------------------------------------------------------------------------------------------------
-- 2) app.delivery_status_history (solo-añadir). changed_by = staff_users.id SIN FK (criterio de audit_events); NULL = sistema.
-- ------------------------------------------------------------------------------------------------
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
    CONSTRAINT "delivery_status_history_delivery_id_fkey" FOREIGN KEY ("delivery_id")
        REFERENCES "app"."deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "delivery_status_history_rider_id_fkey" FOREIGN KEY ("rider_id")
        REFERENCES "app"."riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "delivery_status_history_chk" CHECK (
        "status" IN ('pending', 'assigned', 'picked_up', 'delivered', 'returned', 'cancelled')
        AND ("old_status" IS NULL OR "old_status" IN ('pending', 'assigned', 'picked_up', 'delivered', 'returned', 'cancelled'))
        AND "event" IN ('created', 'reopened', 'rider_assigned', 'rider_reassigned', 'rider_unassigned', 'picked_up', 'delivered', 'returned', 'cancelled')
        AND ("reason" IS NULL OR char_length("reason") <= 500))
);
CREATE INDEX IF NOT EXISTS "delivery_status_history_delivery_idx" ON "app"."delivery_status_history" ("delivery_id", "changed_at", "id");
CREATE INDEX IF NOT EXISTS "delivery_status_history_rider_idx" ON "app"."delivery_status_history" ("rider_id") WHERE "rider_id" IS NOT NULL;

-- ------------------------------------------------------------------------------------------------
-- 3) Funciones y triggers (patrón 0004/0018/0021). CREATE OR REPLACE + creación guardada por catálogo = relanzable.
-- ------------------------------------------------------------------------------------------------

-- 3.1 delivery_status_history es solo-añadir (UPDATE y DELETE rechazados; TRUNCATE se cubre por privilegios).
CREATE OR REPLACE FUNCTION "app"."delivery_status_history_append_only"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_order_cleanup', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'app.delivery_status_history es solo-anadir (% rechazado)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- 3.2 Guarda de app.deliveries (defensa en profundidad; la API aplica las mismas reglas con mensajes de negocio).
CREATE OR REPLACE FUNCTION "app"."deliveries_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
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
        -- FOR SHARE (cambio (a)): serializa contra un UPDATE orders.status concurrente (cancelar/rechazar); ver la cabecera.
        PERFORM 1 FROM app.orders o
         WHERE o.id = NEW.order_id AND o.fulfillment_type = 'DELIVERY' AND o.delivery_provider = 'OWN' AND o.branch_id = NEW.branch_id
           FOR SHARE OF o;
        IF NOT FOUND THEN
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
    -- Grafo de estados (spec §3.2). Mismo estado solo para la reasignación (assigned → assigned con OTRO motorista).
    IF NOT ((OLD.status, NEW.status) IN (('pending', 'assigned'), ('assigned', 'pending'), ('assigned', 'picked_up'),
                                         ('picked_up', 'delivered'), ('delivered', 'returned'), ('pending', 'cancelled'),
                                         ('assigned', 'cancelled'), ('cancelled', 'pending'))
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
    -- Cambio (c): las marcas ya establecidas no se reescriben (assigned_at solo cambia al asignar/reasignar).
    IF (OLD.assigned_at IS NOT NULL AND NEW.status IN ('picked_up', 'delivered', 'returned') AND NEW.assigned_at IS DISTINCT FROM OLD.assigned_at)
       OR (OLD.picked_up_at IS NOT NULL AND NEW.picked_up_at IS DISTINCT FROM OLD.picked_up_at)
       OR (OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at)
       OR (OLD.returned_at IS NOT NULL AND NEW.returned_at IS DISTINCT FROM OLD.returned_at) THEN
        RAISE EXCEPTION 'app.deliveries: las marcas de tiempo ya establecidas no se reescriben' USING ERRCODE = 'check_violation';
    END IF;
    -- Cambio (a): al reabrir o asignar, el pedido se bloquea FOR SHARE (orden motorista → entrega → pedido; la fila de la entrega ya
    -- está bloqueada por este UPDATE). Cierra la carrera con la cancelación/rechazo del pedido.
    IF OLD.status = 'cancelled' OR NEW.status = 'assigned' THEN
        PERFORM 1 FROM app.orders o WHERE o.id = NEW.order_id FOR SHARE OF o;
    END IF;
    RETURN NEW;
END;
$$;

-- 3.3 Coherencia (diferida a COMMIT) entrega ↔ estado del pedido: red de seguridad contra escrituras que salten OrderTransitionsService.
--     Cambio (b): relee la entrega vigente por id en lugar de fiarse de NEW (versión del evento).
CREATE OR REPLACE FUNCTION "app"."deliveries_order_coherence"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
    v_delivery text;
    v_order text;
BEGIN
    SELECT d.status, o.status INTO v_delivery, v_order
      FROM app.deliveries d JOIN app.orders o ON o.id = d.order_id
     WHERE d.id = NEW.id;
    IF NOT FOUND THEN
        RETURN NULL;   -- la entrega ya no existe (limpieza de pruebas): nada que verificar
    END IF;
    IF NOT (
         (v_delivery IN ('pending', 'assigned') AND v_order IN ('accepted', 'preparing', 'ready'))
      OR (v_delivery = 'picked_up' AND v_order = 'on_the_way')
      OR (v_delivery IN ('delivered', 'returned') AND v_order = 'delivered')
      OR (v_delivery = 'cancelled' AND v_order NOT IN ('on_the_way', 'delivered'))) THEN
        RAISE EXCEPTION 'app.deliveries: estado % incoherente con el pedido (%)', v_delivery, v_order
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

-- 3.4 Guarda en app.orders: un pedido con entrega ABIERTA no se cancela ni se rechaza (se cancela antes la entrega). Se dispara SOLO
--     al pasar a cancelled/rejected (WHEN). Lee deliveries sin bloquearla: la sentencia UPDATE ya bloqueó la fila del pedido y el
--     trigger se ejecuta con una instantánea nueva (función volátil), de modo que ve las entregas confirmadas; el FOR SHARE de
--     deliveries_guard (cambio (a)) cubre la entrega creada/asignada en una transacción aún abierta. El orden de bloqueos
--     (motorista → entrega → pedido) lo hace libre de ciclos.
CREATE OR REPLACE FUNCTION "app"."orders_open_delivery_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM app.deliveries d WHERE d.order_id = OLD.id AND d.status IN ('pending', 'assigned', 'picked_up')) THEN
        -- 23001 (restrict_violation); la API lo traduce a 409 ORDER_HAS_ACTIVE_DELIVERY
        RAISE EXCEPTION 'ORDER_HAS_ACTIVE_DELIVERY' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'delivery_status_history_append_only'
                   AND tgrelid = 'app.delivery_status_history'::regclass) THEN
        CREATE TRIGGER "delivery_status_history_append_only"
            BEFORE UPDATE OR DELETE ON "app"."delivery_status_history"
            FOR EACH ROW EXECUTE FUNCTION "app"."delivery_status_history_append_only"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'deliveries_guard'
                   AND tgrelid = 'app.deliveries'::regclass) THEN
        CREATE TRIGGER "deliveries_guard"
            BEFORE INSERT OR UPDATE OR DELETE ON "app"."deliveries"
            FOR EACH ROW EXECUTE FUNCTION "app"."deliveries_guard"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'deliveries_order_coherence'
                   AND tgrelid = 'app.deliveries'::regclass) THEN
        CREATE CONSTRAINT TRIGGER "deliveries_order_coherence"
            AFTER INSERT OR UPDATE ON "app"."deliveries"
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION "app"."deliveries_order_coherence"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_open_delivery_guard'
                   AND tgrelid = 'app.orders'::regclass) THEN
        CREATE TRIGGER "orders_open_delivery_guard"
            BEFORE UPDATE OF "status" ON "app"."orders"
            FOR EACH ROW
            WHEN (NEW."status" IN ('cancelled', 'rejected') AND OLD."status" IS DISTINCT FROM NEW."status")
            EXECUTE FUNCTION "app"."orders_open_delivery_guard"();
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 4) Comentarios
-- ------------------------------------------------------------------------------------------------
COMMENT ON TABLE "app"."deliveries" IS 'F28. Entrega con motorista propio: una por pedido (UNIQUE order_id; la cancelada se reabre). Ocupan al motorista assigned|picked_up|delivered hasta registrar el retorno. Sin DELETE.';
COMMENT ON COLUMN "app"."deliveries"."branch_id" IS 'Añadida sobre el DBML. Sucursal del pedido (la fuerza el trigger): alcance y rendimiento sin JOIN.';
COMMENT ON COLUMN "app"."deliveries"."status" IS 'pending | assigned | picked_up | delivered | returned | cancelled (CHECK de catálogo y de coherencia con las marcas de tiempo y rider_id).';
COMMENT ON COLUMN "app"."deliveries"."returned_at" IS 'Añadida sobre el DBML. Retorno del motorista a la sucursal: evento SEPARADO de la entrega al cliente (delivered_at).';
COMMENT ON COLUMN "app"."deliveries"."cancelled_at" IS 'Añadida sobre el DBML. Solo en cancelled; se limpia al reabrir.';
COMMENT ON COLUMN "app"."deliveries"."delivery_notes" IS 'DBML. F28 no la escribe ni la devuelve (texto libre = riesgo de PII; P110).';
COMMENT ON COLUMN "app"."deliveries"."version" IS 'Añadida sobre el DBML. Concurrencia optimista; el trigger exige OLD.version + 1 en todo UPDATE.';
COMMENT ON TABLE "app"."delivery_status_history" IS 'F28. Historial de estados de la entrega SOLO-AÑADIR (trigger). Una fila por comando; sin PII.';
COMMENT ON COLUMN "app"."delivery_status_history"."old_status" IS 'Añadida sobre el DBML. NULL al crear.';
COMMENT ON COLUMN "app"."delivery_status_history"."event" IS 'Añadida sobre el DBML. created | reopened | rider_assigned | rider_reassigned | rider_unassigned | picked_up | delivered | returned | cancelled.';
COMMENT ON COLUMN "app"."delivery_status_history"."rider_id" IS 'Añadida sobre el DBML. Motorista del evento (incluye el liberado al reasignar/desasignar).';
COMMENT ON COLUMN "app"."delivery_status_history"."reason" IS 'Añadida sobre el DBML. Interno; solo cancelar/desasignar. Sin PII.';
COMMENT ON COLUMN "app"."delivery_status_history"."changed_by" IS 'staff_users.id SIN FK (criterio de audit_events); NULL = sistema.';

-- ------------------------------------------------------------------------------------------------
-- 5) Privilegios: igual que 0018/0019/0021 (RLS sin políticas + REVOKE a PUBLIC/anon/authenticated, incl. funciones). Solo vía API.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "app"."deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."delivery_status_history" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "app"."deliveries" FROM PUBLIC;
REVOKE ALL ON "app"."delivery_status_history" FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."delivery_status_history_append_only"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."deliveries_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."deliveries_order_coherence"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."orders_open_delivery_guard"() FROM PUBLIC;

DO $$
DECLARE
    v_role text;
    v_table text;
    v_func text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            FOREACH v_table IN ARRAY ARRAY['deliveries', 'delivery_status_history'] LOOP
                EXECUTE format('REVOKE ALL ON "app".%I FROM %I', v_table, v_role);
            END LOOP;
            FOREACH v_func IN ARRAY ARRAY['delivery_status_history_append_only', 'deliveries_guard',
                                          'deliveries_order_coherence', 'orders_open_delivery_guard'] LOOP
                EXECUTE format('REVOKE ALL ON FUNCTION "app".%I() FROM %I', v_func, v_role);
            END LOOP;
        END IF;
    END LOOP;
END $$;
