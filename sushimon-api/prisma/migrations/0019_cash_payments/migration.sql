-- 0019 · F24 pagos en efectivo (specs/025-cash-payments §2, ADR-0030). CREA app.payment_methods, app.payments y
-- app.payment_events (el DBML define las dos primeras; la tercera es nueva). El DBML no se edita; las columnas añadidas
-- sobre el DBML se justifican abajo, en la spec §2 y en docs/database/README.md.
-- Aditiva y NO destructiva: solo CREATE + seed + backfill + un trigger BEFORE INSERT sobre app.orders. No borra ni
-- modifica filas ni columnas de app.orders. Relanzable (IF NOT EXISTS, CREATE OR REPLACE, triggers guardados por catálogo,
-- seed y backfill con ON CONFLICT).
-- Guarda inicial (como 0018): si alguna de las 3 tablas ya existe con otra definición (falta una columna o restricción
-- esperada), RAISE EXCEPTION y no se modifica nada. Requiere 0003 (branches) y 0018 (orders).
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real.
--
-- Reversión manual (destructiva; solo sin cobros reales que conservar; aprobación humana), en este orden:
--   DROP TRIGGER orders_payment_pref_cash_only ON app.orders;
--   DROP TABLE app.payment_events, app.payments, app.payment_methods;
--   DROP FUNCTION app.payment_events_append_only(), app.payments_guard(), app.orders_payment_pref_cash_only();
--
-- Excepción de limpieza (precedente 0004/0018): un DELETE sobre payments/payment_events se permite SOLO si la transacción
-- hizo `SET LOCAL app.allow_order_cleanup = 'on'`. La API nunca lo hace; lo usan las pruebas. No es un control de acceso.

-- ------------------------------------------------------------------------------------------------
-- 0) Guarda: si una de las tablas ya existe, debe tener las columnas y restricciones esperadas.
-- ------------------------------------------------------------------------------------------------
DO $$
DECLARE
    v_table text;
    v_col text;
    v_con text;
    v_expect_cols jsonb := jsonb_build_object(
        'payment_methods', ARRAY['id', 'code', 'name', 'active'],
        'payments', ARRAY['id', 'order_id', 'method_id', 'branch_id', 'amount', 'status', 'provider', 'provider_reference',
                          'idempotency_key', 'tendered_amount', 'change_amount', 'collector_type', 'received_by_staff_id',
                          'collection_context', 'received_at', 'confirm_key_hash', 'confirm_request_hash', 'created_at',
                          'updated_at'],
        'payment_events', ARRAY['id', 'payment_id', 'order_id', 'event_type', 'actor_staff_id', 'amount',
                                'tendered_amount', 'change_amount', 'occurred_at']);
    v_expect_cons jsonb := jsonb_build_object(
        'payment_methods', ARRAY['payment_methods_pkey', 'payment_methods_code_key', 'payment_methods_chk'],
        'payments', ARRAY['payments_pkey', 'payments_order_key', 'payments_idempotency_key_key', 'payments_order_id_fkey',
                          'payments_method_id_fkey', 'payments_branch_id_fkey', 'payments_status_chk',
                          'payments_amount_chk', 'payments_cash_only_chk', 'payments_reception_chk'],
        'payment_events', ARRAY['payment_events_pkey', 'payment_events_payment_id_fkey', 'payment_events_order_id_fkey',
                                'payment_events_chk']);
BEGIN
    FOR v_table IN SELECT jsonb_object_keys(v_expect_cols) LOOP
        IF to_regclass(format('app.%I', v_table)) IS NULL THEN
            CONTINUE;
        END IF;
        FOR v_col IN SELECT jsonb_array_elements_text(v_expect_cols -> v_table) LOOP
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'app' AND table_name = v_table AND column_name = v_col
            ) THEN
                RAISE EXCEPTION '0019: app.% ya existe con otra definicion (falta la columna %); no se modifica. Revisar a mano.',
                    v_table, v_col;
            END IF;
        END LOOP;
        FOR v_con IN SELECT jsonb_array_elements_text(v_expect_cons -> v_table) LOOP
            IF NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = format('app.%I', v_table)::regclass AND conname = v_con
            ) THEN
                RAISE EXCEPTION '0019: app.% ya existe con otra definicion (falta la restriccion %); no se modifica. Revisar a mano.',
                    v_table, v_con;
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 1) app.payment_methods (DBML). Seed: SOLO efectivo. No se siembran bank_transfer ni card.
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."payment_methods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_methods_code_key" UNIQUE ("code"),
    CONSTRAINT "payment_methods_chk" CHECK ("code" ~ '^[a-z][a-z_]{1,31}$' AND btrim("name") <> '')
);

INSERT INTO "app"."payment_methods" ("code", "name", "active") VALUES ('cash', 'Efectivo', true)
ON CONFLICT ("code") DO NOTHING;

-- ------------------------------------------------------------------------------------------------
-- 2) app.payments (DBML ampliado). UNA fila por pedido; pending -> paid una sola vez.
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "method_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,                       -- añadida: copia inmutable de orders.branch_id
    "amount" DECIMAL(12,2) NOT NULL,                 -- = orders.total (deuda; es el ingreso aplicado)
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT,                                 -- DBML; NULL en efectivo (F25)
    "provider_reference" TEXT,                       -- DBML; NULL en efectivo (F25)
    "idempotency_key" TEXT,                          -- DBML; RESERVADA, NULL en F24 (la clave se guarda solo como hash)
    "tendered_amount" DECIMAL(12,2),                 -- añadida: efectivo entregado
    "change_amount" DECIMAL(12,2),                   -- añadida: tendered - amount (informativo, NO ingreso)
    "collector_type" TEXT,                           -- añadida: STAFF (F28 añadirá RIDER)
    "received_by_staff_id" UUID,                     -- añadida: staff_users.id SIN FK (criterio audit_events)
    "collection_context" TEXT,                       -- añadida: BRANCH | OWN_DELIVERY (derivado del pedido)
    "received_at" TIMESTAMPTZ(6),                    -- añadida: reloj del servidor
    "confirm_key_hash" BYTEA,                        -- añadida: sha256(Idempotency-Key)
    "confirm_request_hash" BYTEA,                    -- añadida: sha256(cuerpo canónico)
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_order_key" UNIQUE ("order_id"),
    CONSTRAINT "payments_idempotency_key_key" UNIQUE ("idempotency_key"),
    CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id")
        REFERENCES "app"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_method_id_fkey" FOREIGN KEY ("method_id")
        REFERENCES "app"."payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_branch_id_fkey" FOREIGN KEY ("branch_id")
        REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_status_chk" CHECK ("status" IN ('pending', 'paid')),
    CONSTRAINT "payments_amount_chk" CHECK ("amount" >= 0),
    -- F24 es solo efectivo: sin proveedor, referencia ni clave en claro (F25 relajará esto con su propia migración).
    CONSTRAINT "payments_cash_only_chk" CHECK (
        "provider" IS NULL AND "provider_reference" IS NULL AND "idempotency_key" IS NULL
    ),
    -- Coherencia por estado: pending => sin recepción; paid => recepción completa y consistente.
    CONSTRAINT "payments_reception_chk" CHECK (
        ("status" = 'pending'
            AND "tendered_amount" IS NULL AND "change_amount" IS NULL AND "collector_type" IS NULL
            AND "received_by_staff_id" IS NULL AND "collection_context" IS NULL AND "received_at" IS NULL
            AND "confirm_key_hash" IS NULL AND "confirm_request_hash" IS NULL)
        OR ("status" = 'paid'
            AND "amount" > 0
            AND "tendered_amount" IS NOT NULL AND "tendered_amount" >= "amount"
            AND "change_amount" IS NOT NULL AND "change_amount" = "tendered_amount" - "amount"
            AND "collector_type" = 'STAFF' AND "received_by_staff_id" IS NOT NULL
            AND "collection_context" IN ('BRANCH', 'OWN_DELIVERY') AND "received_at" IS NOT NULL
            AND octet_length("confirm_key_hash") = 32 AND octet_length("confirm_request_hash") = 32)
    )
);
-- Índices: PK y UNIQUE(order_id) sirven toda lectura por pedido. NO se añaden índices por sucursal/estado
-- (no hay consulta que los use en F24; los reportes de caja de F34 los pedirán con EXPLAIN real).
CREATE INDEX IF NOT EXISTS "payments_method_idx" ON "app"."payments" ("method_id");   -- FK sin seq scan
CREATE INDEX IF NOT EXISTS "payments_branch_idx" ON "app"."payments" ("branch_id");   -- FK sin seq scan

-- ------------------------------------------------------------------------------------------------
-- 3) app.payment_events (nueva, solo-añadir)
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."payment_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,                        -- desnormalizado: historial por pedido con alcance en 1 sentencia
    "event_type" TEXT NOT NULL,
    "actor_staff_id" UUID,                           -- staff_users.id SIN FK; NULL = sistema/cliente
    "amount" DECIMAL(12,2) NOT NULL,                 -- deuda en ese momento
    "tendered_amount" DECIMAL(12,2),
    "change_amount" DECIMAL(12,2),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id")
        REFERENCES "app"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payment_events_order_id_fkey" FOREIGN KEY ("order_id")
        REFERENCES "app"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payment_events_chk" CHECK (
        "amount" >= 0 AND (
            ("event_type" = 'created' AND "actor_staff_id" IS NULL
                AND "tendered_amount" IS NULL AND "change_amount" IS NULL)
            OR ("event_type" = 'cash_received' AND "actor_staff_id" IS NOT NULL
                AND "tendered_amount" IS NOT NULL AND "change_amount" IS NOT NULL
                AND "tendered_amount" - "change_amount" = "amount")
        )
    )
);
CREATE INDEX IF NOT EXISTS "payment_events_order_idx" ON "app"."payment_events" ("order_id", "occurred_at", "id");
CREATE INDEX IF NOT EXISTS "payment_events_payment_idx" ON "app"."payment_events" ("payment_id");

-- ------------------------------------------------------------------------------------------------
-- 4) Funciones de trigger (patrón 0018; relanzable por CREATE OR REPLACE)
-- ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "app"."payments_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.allow_order_cleanup', true) = 'on' THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'app.payments no admite DELETE' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'INSERT' THEN
        -- Un pago nace pending, con el total y la sucursal del pedido.
        IF NEW.status <> 'pending' OR NOT EXISTS (
            SELECT 1 FROM app.orders o WHERE o.id = NEW.order_id AND o.total = NEW.amount AND o.branch_id = NEW.branch_id
        ) THEN
            RAISE EXCEPTION 'app.payments: un pago nace pending con el total y la sucursal del pedido'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    -- UPDATE: un pago confirmado NO se edita; la identidad nunca cambia; solo pending -> paid.
    IF OLD.status = 'paid' THEN
        RAISE EXCEPTION 'app.payments: un pago confirmado es inmutable' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.method_id IS DISTINCT FROM OLD.method_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'app.payments: id, pedido, metodo, sucursal, importe y created_at son inmutables'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "app"."payment_events_append_only"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_order_cleanup', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'app.payment_events es solo-anadir (% rechazado)', TG_OP USING ERRCODE = 'insufficient_privilege';
END; $$;

-- Preferencia de pago de pedidos NUEVOS: solo 'cash'. El CHECK orders_payment_pref_chk de 0018 se CONSERVA tal cual
-- (un CHECK NOT VALID más estricto se re-evalúa en cada UPDATE y rompería las transiciones de F22 sobre filas
-- históricas bank_transfer). Un trigger solo de INSERT lo hace cumplir sin tocar las filas existentes (P89).
CREATE OR REPLACE FUNCTION "app"."orders_payment_pref_cash_only"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
    IF NEW.payment_method_preference IS NOT NULL AND NEW.payment_method_preference <> 'cash' THEN
        RAISE EXCEPTION 'app.orders: solo se admite pago en efectivo (preferencia %)', NEW.payment_method_preference
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END; $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payments_guard' AND tgrelid = 'app.payments'::regclass) THEN
        CREATE TRIGGER "payments_guard" BEFORE INSERT OR UPDATE OR DELETE ON "app"."payments"
            FOR EACH ROW EXECUTE FUNCTION "app"."payments_guard"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_events_append_only'
                   AND tgrelid = 'app.payment_events'::regclass) THEN
        CREATE TRIGGER "payment_events_append_only" BEFORE UPDATE OR DELETE ON "app"."payment_events"
            FOR EACH ROW EXECUTE FUNCTION "app"."payment_events_append_only"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_payment_pref_cash_only'
                   AND tgrelid = 'app.orders'::regclass) THEN
        CREATE TRIGGER "orders_payment_pref_cash_only" BEFORE INSERT ON "app"."orders"
            FOR EACH ROW EXECUTE FUNCTION "app"."orders_payment_pref_cash_only"();
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 5) Backfill ADITIVO de pedidos existentes (solo preferencia cash o NULL; los bank_transfer históricos NO se tocan).
--    Un pago pending por pedido, por el total, con su evento 'created'. Idempotente (ON CONFLICT). No marca nada pagado:
--    un pedido ya entregado queda PENDING hasta que el personal registre el cobro (P88/P90).
-- ------------------------------------------------------------------------------------------------
WITH ins AS (
    INSERT INTO "app"."payments" ("order_id", "method_id", "branch_id", "amount")
    SELECT o."id", m."id", o."branch_id", o."total"
      FROM "app"."orders" o JOIN "app"."payment_methods" m ON m."code" = 'cash'
     WHERE o."payment_method_preference" IS NULL OR o."payment_method_preference" = 'cash'
    ON CONFLICT ("order_id") DO NOTHING
    RETURNING "id", "order_id", "amount"
)
INSERT INTO "app"."payment_events" ("payment_id", "order_id", "event_type", "amount")
SELECT "id", "order_id", 'created', "amount" FROM ins;

-- ------------------------------------------------------------------------------------------------
-- 6) Comentarios
-- ------------------------------------------------------------------------------------------------
COMMENT ON TABLE "app"."payment_methods" IS 'F24. Catálogo de métodos de pago. Seed SOLO cash (sin transferencia ni tarjeta).';
COMMENT ON TABLE "app"."payments" IS 'F24. UN pago completo en efectivo por pedido (UNIQUE order_id). pending -> paid una vez; paid es inmutable (trigger). amount = orders.total = ingreso; el cambio NO es ingreso.';
COMMENT ON TABLE "app"."payment_events" IS 'F24. No está en el DBML. Historial SOLO-AÑADIR del pago (created, cash_received).';
COMMENT ON COLUMN "app"."payments"."idempotency_key" IS 'DBML. RESERVADA: siempre NULL en F24 (la clave se guarda solo como hash en confirm_key_hash).';
COMMENT ON COLUMN "app"."payments"."tendered_amount" IS 'Añadida sobre el DBML. Efectivo entregado. NO es ingreso.';
COMMENT ON COLUMN "app"."payments"."change_amount" IS 'Añadida sobre el DBML. tendered - amount. Informativo, NO es ingreso.';
COMMENT ON COLUMN "app"."payments"."collector_type" IS 'Añadida sobre el DBML. STAFF (F28 añadirá RIDER de forma aditiva).';
COMMENT ON COLUMN "app"."payments"."collection_context" IS 'Añadida sobre el DBML. BRANCH | OWN_DELIVERY, derivado del pedido por el servidor.';

-- ------------------------------------------------------------------------------------------------
-- 7) Privilegios: igual que 0018 (RLS sin políticas + REVOKE a PUBLIC/anon/authenticated, incl. funciones). Solo vía API.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "app"."payment_methods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."payment_events" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "app"."payment_methods" FROM PUBLIC;
REVOKE ALL ON "app"."payments" FROM PUBLIC;
REVOKE ALL ON "app"."payment_events" FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."payments_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."payment_events_append_only"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."orders_payment_pref_cash_only"() FROM PUBLIC;

DO $$
DECLARE
    v_role text;
    v_table text;
    v_func text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            FOREACH v_table IN ARRAY ARRAY['payment_methods', 'payments', 'payment_events'] LOOP
                EXECUTE format('REVOKE ALL ON "app".%I FROM %I', v_table, v_role);
            END LOOP;
            FOREACH v_func IN ARRAY ARRAY['payments_guard', 'payment_events_append_only',
                                          'orders_payment_pref_cash_only'] LOOP
                EXECUTE format('REVOKE ALL ON FUNCTION "app".%I() FROM %I', v_func, v_role);
            END LOOP;
        END IF;
    END LOOP;
END $$;
