-- 0018 · F20 creación de pedidos (specs/021-order-creation §4-§6, ADR-0026). CREA las 6 tablas de pedidos del DBML
-- (app.orders, order_addresses, order_items, order_item_modifiers, order_promotions, order_status_history) y 2 tablas
-- nuevas que el DBML no tiene (app.order_access_tokens, app.order_idempotency_keys). Las migraciones 0001..0017 no las crean.
-- El DBML no se edita; las desviaciones (columnas y tablas añadidas) se justifican abajo, en la spec §6 y en
-- docs/database/README.md (nota F20).
-- Incremental y NO destructiva: solo CREATE (tablas, índices, funciones, triggers, RLS). No borra ni modifica datos ni
-- tablas existentes. Relanzable: IF NOT EXISTS / guardas por catálogo. Si alguna de las 8 tablas ya existe con otra
-- definición (le falta una columna o una restricción esperada), la migración FALLA con un mensaje claro y no reescribe nada.
-- Requiere 0002 (customers), 0003 (branches), 0012 (products), 0013 (modifiers) y 0016 (promotions) aplicadas.
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real.
--
-- Reversión manual (solo sin pedidos reales que conservar; destructiva, requiere aprobación humana). En este orden:
--   DROP TABLE app.order_idempotency_keys, app.order_access_tokens, app.order_status_history, app.order_promotions,
--              app.order_item_modifiers, app.order_items, app.order_addresses, app.orders;
--   DROP FUNCTION app.order_status_history_append_only(), app.order_snapshot_immutable(), app.orders_immutable_fields(),
--                 app.order_address_requires_delivery(), app.order_delivery_requires_address();
-- Los índices, PK, UNIQUE, CHECK, FK y triggers caen con las tablas; la identidad (secuencia de order_number) también.
-- Cuando existan payments/deliveries/incidents/notifications con FK a orders (F24+), hay que quitarlas antes.
--
-- Decisiones (resumen; detalle en la spec §6):
-- * order_number: bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001), UNIQUE. No se puede fijar a mano; creciente y no
--   contiguo (una transacción revertida consume número). Nunca MAX+1.
-- * Importes numeric(12,2), moneda GTQ por CHECK, total = subtotal - discount_total + delivery_fee por CHECK.
-- * Snapshots (nombre, precio, extras, descuentos, promoción, dirección) inmutables por trigger; el historial de estados
--   es solo-añadir. FKs a catálogo/sucursal/pedido ON DELETE RESTRICT; customer_id ON DELETE SET NULL (conserva el pedido).
-- * Excepción controlada de limpieza (precedente 0004): un DELETE sobre las tablas hijas de solo-añadir/inmutables se
--   permite SOLO si la transacción hizo `SET LOCAL app.allow_order_cleanup = 'on'`. La API nunca lo hace; lo usan las
--   pruebas para limpiar sus datos. No es un permiso de producción: ver docs/database/README.md.
-- * order_idempotency_keys.order_id es una FK DEFERRABLE INITIALLY DEFERRED: la clave se reclama antes de crear el pedido
--   en la misma transacción y la FK se comprueba al COMMIT (la clave huérfana es imposible).
-- * La coherencia líneas<->totales no se impone en BD (exigiría un trigger entre tablas costoso); la verifica la API y la
--   int-spec. SÍ se impone en BD que solo los pedidos DELIVERY tengan dirección y que todo DELIVERY la tenga al confirmar.

-- ------------------------------------------------------------------------------------------------
-- 0) Guarda: si una de las tablas ya existe, debe tener las columnas y restricciones esperadas.
-- ------------------------------------------------------------------------------------------------
DO $$
DECLARE
    v_table text;
    v_col text;
    v_con text;
    v_expect_cols jsonb := jsonb_build_object(
        'orders', ARRAY['id', 'order_number', 'customer_id', 'branch_id', 'customer_name', 'customer_phone',
                        'customer_email', 'fulfillment_type', 'delivery_provider', 'scheduled_for', 'notes', 'status',
                        'subtotal', 'extras_total', 'discount_total', 'delivery_fee', 'total', 'currency',
                        'payment_method_preference', 'placed_at', 'updated_at'],
        'order_addresses', ARRAY['order_id', 'municipality_name', 'zone', 'address_line', 'reference_note', 'latitude',
                                 'longitude'],
        'order_items', ARRAY['id', 'order_id', 'line_no', 'product_id', 'product_name', 'quantity', 'unit_price',
                             'extras_per_unit', 'line_discount', 'notes'],
        'order_item_modifiers', ARRAY['id', 'order_item_id', 'modifier_id', 'modifier_name', 'quantity',
                                      'unit_extra_price'],
        'order_promotions', ARRAY['order_id', 'promotion_id', 'promotion_name', 'amount'],
        'order_status_history', ARRAY['id', 'order_id', 'old_status', 'new_status', 'changed_by', 'reason', 'changed_at'],
        'order_access_tokens', ARRAY['id', 'order_id', 'token_hash', 'created_at', 'expires_at', 'revoked_at'],
        'order_idempotency_keys', ARRAY['id', 'scope', 'key_hash', 'request_hash', 'order_id', 'created_at',
                                        'expires_at']);
    v_expect_cons jsonb := jsonb_build_object(
        'orders', ARRAY['orders_pkey', 'orders_order_number_key', 'orders_customer_id_fkey', 'orders_branch_id_fkey',
                        'orders_fulfillment_chk', 'orders_provider_chk', 'orders_provider_coherent_chk',
                        'orders_status_chk', 'orders_money_chk', 'orders_total_chk', 'orders_currency_chk',
                        'orders_payment_pref_chk', 'orders_contact_chk', 'orders_notes_chk'],
        'order_addresses', ARRAY['order_addresses_pkey', 'order_addresses_order_id_fkey', 'order_addresses_line_chk'],
        'order_items', ARRAY['order_items_pkey', 'order_items_order_id_fkey', 'order_items_product_id_fkey',
                             'order_items_order_line_key', 'order_items_chk'],
        'order_item_modifiers', ARRAY['order_item_modifiers_pkey', 'order_item_modifiers_order_item_id_fkey',
                                      'order_item_modifiers_modifier_id_fkey', 'order_item_modifiers_chk'],
        'order_promotions', ARRAY['order_promotions_pkey', 'order_promotions_order_id_fkey',
                                  'order_promotions_promotion_id_fkey', 'order_promotions_amount_chk'],
        'order_status_history', ARRAY['order_status_history_pkey', 'order_status_history_order_id_fkey',
                                      'order_status_history_chk'],
        'order_access_tokens', ARRAY['order_access_tokens_pkey', 'order_access_tokens_order_id_fkey',
                                     'order_access_tokens_hash_key', 'order_access_tokens_chk'],
        'order_idempotency_keys', ARRAY['order_idempotency_keys_pkey', 'order_idempotency_keys_order_id_fkey',
                                        'order_idempotency_keys_scope_key', 'order_idempotency_keys_chk']);
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
                RAISE EXCEPTION '0018: app.% ya existe con otra definicion (falta la columna %); no se modifica. Revisar a mano.',
                    v_table, v_col;
            END IF;
        END LOOP;
        FOR v_con IN SELECT jsonb_array_elements_text(v_expect_cons -> v_table) LOOP
            IF NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = format('app.%I', v_table)::regclass AND conname = v_con
            ) THEN
                RAISE EXCEPTION '0018: app.% ya existe con otra definicion (falta la restriccion %); no se modifica. Revisar a mano.',
                    v_table, v_con;
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 1) app.orders
--    Sobre el DBML se AÑADEN: delivery_provider, extras_total, payment_method_preference (y los CHECK/UNIQUE/FK explícitos).
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_number" BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 1001) NOT NULL,
    "customer_id" UUID,
    "branch_id" UUID NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "customer_email" TEXT,
    "fulfillment_type" TEXT NOT NULL,
    "delivery_provider" TEXT,
    "scheduled_for" TIMESTAMPTZ(6),
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "extras_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'GTQ',
    "payment_method_preference" TEXT,
    "placed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orders_order_number_key" UNIQUE ("order_number"),
    CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id")
        REFERENCES "app"."customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "orders_branch_id_fkey" FOREIGN KEY ("branch_id")
        REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_fulfillment_chk" CHECK ("fulfillment_type" IN ('PICKUP', 'DELIVERY')),
    CONSTRAINT "orders_provider_chk" CHECK ("delivery_provider" IS NULL OR "delivery_provider" IN ('OWN', 'PEDIDOSYA')),
    CONSTRAINT "orders_provider_coherent_chk" CHECK (
        ("fulfillment_type" = 'PICKUP' AND "delivery_provider" IS NULL AND "delivery_fee" = 0)
        OR ("fulfillment_type" = 'DELIVERY' AND "delivery_provider" IS NOT NULL)
    ),
    CONSTRAINT "orders_status_chk" CHECK ("status" IN ('pending', 'accepted', 'preparing', 'ready', 'on_the_way',
                                                       'delivered', 'picked_up', 'rejected', 'cancelled')),
    CONSTRAINT "orders_money_chk" CHECK (
        "subtotal" >= 0 AND "extras_total" >= 0 AND "extras_total" <= "subtotal"
        AND "discount_total" >= 0 AND "discount_total" <= "subtotal"
        AND "delivery_fee" >= 0 AND "total" >= 0
    ),
    CONSTRAINT "orders_total_chk" CHECK ("total" = "subtotal" - "discount_total" + "delivery_fee"),
    CONSTRAINT "orders_currency_chk" CHECK ("currency" = 'GTQ'),
    CONSTRAINT "orders_payment_pref_chk" CHECK (
        "payment_method_preference" IS NULL OR "payment_method_preference" IN ('cash', 'bank_transfer')
    ),
    CONSTRAINT "orders_contact_chk" CHECK (
        btrim("customer_name") <> '' AND char_length("customer_name") <= 120
        AND "customer_phone" ~ '^\+502[0-9]{8}$'
        AND ("customer_email" IS NULL OR char_length("customer_email") <= 254)
    ),
    CONSTRAINT "orders_notes_chk" CHECK ("notes" IS NULL OR char_length("notes") <= 280)
);

-- Cola de la sucursal por estado y fecha (F22).
CREATE INDEX IF NOT EXISTS "orders_branch_status_placed_idx"
    ON "app"."orders" ("branch_id", "status", "placed_at" DESC);
-- Pedidos del cliente autenticado (F23) y tope de pendientes por cliente (P51); los de invitado no se indexan.
CREATE INDEX IF NOT EXISTS "orders_customer_placed_idx"
    ON "app"."orders" ("customer_id", "placed_at" DESC) WHERE "customer_id" IS NOT NULL;
-- Tope de pedidos pendientes por teléfono (P51): solo filas 'pending' (pocas y de vida corta).
CREATE INDEX IF NOT EXISTS "orders_phone_pending_idx"
    ON "app"."orders" ("customer_phone", "placed_at" DESC) WHERE "status" = 'pending';

-- ------------------------------------------------------------------------------------------------
-- 2) app.order_addresses (snapshot de la dirección; solo pedidos DELIVERY, ver constraint triggers)
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."order_addresses" (
    "order_id" UUID NOT NULL,
    "municipality_name" TEXT NOT NULL,
    "zone" TEXT,
    "address_line" TEXT NOT NULL,
    "reference_note" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    CONSTRAINT "order_addresses_pkey" PRIMARY KEY ("order_id"),
    CONSTRAINT "order_addresses_order_id_fkey" FOREIGN KEY ("order_id")
        REFERENCES "app"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_addresses_line_chk" CHECK (btrim("address_line") <> '' AND char_length("address_line") <= 200)
);

-- ------------------------------------------------------------------------------------------------
-- 3) app.order_items. Sobre el DBML se AÑADEN: line_no (orden estable y UNIQUE por pedido), extras_per_unit.
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "product_id" UUID,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "extras_per_unit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "line_discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id")
        REFERENCES "app"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    -- Referencia informativa al catálogo; el snapshot es la fuente. RESTRICT (el DBML decía SET NULL: ver nota F20).
    CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id")
        REFERENCES "app"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_items_order_line_key" UNIQUE ("order_id", "line_no"),
    CONSTRAINT "order_items_chk" CHECK (
        "quantity" BETWEEN 1 AND 99 AND "unit_price" >= 0 AND "extras_per_unit" >= 0
        AND "line_discount" >= 0 AND "line_discount" <= "unit_price" * "quantity"
    )
);
-- «Líneas de un pedido» sin N+1 (el UNIQUE (order_id, line_no) ya sirve de prefijo, pero se pide el índice explícito).
CREATE INDEX IF NOT EXISTS "order_items_order_idx" ON "app"."order_items" ("order_id");

-- ------------------------------------------------------------------------------------------------
-- 4) app.order_item_modifiers
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."order_item_modifiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_item_id" UUID NOT NULL,
    "modifier_id" UUID,
    "modifier_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_extra_price" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "order_item_modifiers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_item_modifiers_order_item_id_fkey" FOREIGN KEY ("order_item_id")
        REFERENCES "app"."order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_item_modifiers_modifier_id_fkey" FOREIGN KEY ("modifier_id")
        REFERENCES "app"."modifiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_item_modifiers_chk" CHECK ("quantity" >= 1 AND "unit_extra_price" >= 0)
);
CREATE INDEX IF NOT EXISTS "order_item_modifiers_item_idx" ON "app"."order_item_modifiers" ("order_item_id");

-- ------------------------------------------------------------------------------------------------
-- 5) app.order_promotions. Sobre el DBML se AÑADE: promotion_name (snapshot del nombre).
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."order_promotions" (
    "order_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "promotion_name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "order_promotions_pkey" PRIMARY KEY ("order_id", "promotion_id"),
    CONSTRAINT "order_promotions_order_id_fkey" FOREIGN KEY ("order_id")
        REFERENCES "app"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_promotions_promotion_id_fkey" FOREIGN KEY ("promotion_id")
        REFERENCES "app"."promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_promotions_amount_chk" CHECK ("amount" > 0)
);

-- ------------------------------------------------------------------------------------------------
-- 6) app.order_status_history (solo-añadir). changed_by = staff_users.id SIN FK (criterio de audit_events); NULL = sistema/cliente.
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."order_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "old_status" TEXT,
    "new_status" TEXT NOT NULL,
    "changed_by" UUID,
    "reason" TEXT,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id")
        REFERENCES "app"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_status_history_chk" CHECK (
        "new_status" IN ('pending', 'accepted', 'preparing', 'ready', 'on_the_way', 'delivered', 'picked_up',
                         'rejected', 'cancelled')
        AND ("old_status" IS NULL OR "old_status" IN ('pending', 'accepted', 'preparing', 'ready', 'on_the_way',
                                                      'delivered', 'picked_up', 'rejected', 'cancelled'))
        AND ("reason" IS NULL OR char_length("reason") <= 500)
    )
);
CREATE INDEX IF NOT EXISTS "order_status_history_order_idx" ON "app"."order_status_history" ("order_id", "changed_at");

-- ------------------------------------------------------------------------------------------------
-- 7) app.order_access_tokens (NUEVA, no está en el DBML). Token de invitado: sha256 de 32 bytes aleatorios; revocable.
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."order_access_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    CONSTRAINT "order_access_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_access_tokens_order_id_fkey" FOREIGN KEY ("order_id")
        REFERENCES "app"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_access_tokens_hash_key" UNIQUE ("token_hash"),
    CONSTRAINT "order_access_tokens_chk" CHECK (octet_length("token_hash") = 32 AND "expires_at" > "created_at")
);
-- Tokens vigentes de un pedido (revocar/rotar en una repetición idempotente).
CREATE INDEX IF NOT EXISTS "order_access_tokens_order_idx"
    ON "app"."order_access_tokens" ("order_id") WHERE "revoked_at" IS NULL;

-- ------------------------------------------------------------------------------------------------
-- 8) app.order_idempotency_keys (NUEVA, no está en el DBML). UNIQUE (scope, key_hash); FK al pedido APLAZADA a COMMIT.
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."order_idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" TEXT NOT NULL,
    "key_hash" BYTEA NOT NULL,
    "request_hash" BYTEA NOT NULL,
    "order_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "order_idempotency_keys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_idempotency_keys_order_id_fkey" FOREIGN KEY ("order_id")
        REFERENCES "app"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT "order_idempotency_keys_scope_key" UNIQUE ("scope", "key_hash"),
    CONSTRAINT "order_idempotency_keys_chk" CHECK (
        ("scope" = 'guest' OR "scope" ~ '^customer:[0-9a-f-]{36}$')
        AND octet_length("key_hash") = 32 AND octet_length("request_hash") = 32
        AND "expires_at" > "created_at"
    )
);
-- Limpieza perezosa de claves vencidas (DELETE ... WHERE expires_at < now()).
CREATE INDEX IF NOT EXISTS "order_idempotency_keys_expires_idx" ON "app"."order_idempotency_keys" ("expires_at");
-- Lectura del pedido de una clave y FK sin seq scan.
CREATE INDEX IF NOT EXISTS "order_idempotency_keys_order_idx" ON "app"."order_idempotency_keys" ("order_id");

-- ------------------------------------------------------------------------------------------------
-- 9) Funciones y triggers (patrón 0004). CREATE OR REPLACE + creación guardada por catálogo = relanzable.
-- ------------------------------------------------------------------------------------------------

-- 9.1 order_status_history es solo-añadir (UPDATE y DELETE rechazados; TRUNCATE se cubre por privilegios).
CREATE OR REPLACE FUNCTION "app"."order_status_history_append_only"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_order_cleanup', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'app.order_status_history es solo-anadir (% rechazado)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- 9.2 Snapshots inmutables: order_items, order_item_modifiers, order_promotions, order_addresses.
CREATE OR REPLACE FUNCTION "app"."order_snapshot_immutable"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_order_cleanup', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'app.% es un snapshot inmutable (% rechazado)', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- 9.3 orders: importes, sucursal, modalidad, proveedor, moneda, número y fecha NO cambian. Contacto, customer_id (SET NULL /
--     borrado de PII por derecho del cliente), status, notes, updated_at y payment_method_preference sí pueden (F22/F21).
CREATE OR REPLACE FUNCTION "app"."orders_immutable_fields"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.order_number IS DISTINCT FROM OLD.order_number
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.fulfillment_type IS DISTINCT FROM OLD.fulfillment_type
       OR NEW.delivery_provider IS DISTINCT FROM OLD.delivery_provider
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.extras_total IS DISTINCT FROM OLD.extras_total
       OR NEW.discount_total IS DISTINCT FROM OLD.discount_total
       OR NEW.delivery_fee IS DISTINCT FROM OLD.delivery_fee
       OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.placed_at IS DISTINCT FROM OLD.placed_at THEN
        RAISE EXCEPTION 'app.orders: id, order_number, sucursal, modalidad, proveedor, importes, moneda y placed_at son inmutables'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

-- 9.4 Constraint triggers aplazados: la dirección solo existe en pedidos DELIVERY y todo DELIVERY la tiene al confirmar.
--     Se lanzan como check_violation (23514), igual que los CHECK.
CREATE OR REPLACE FUNCTION "app"."order_address_requires_delivery"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.orders o WHERE o.id = NEW.order_id AND o.fulfillment_type = 'DELIVERY') THEN
        RAISE EXCEPTION 'app.order_addresses: solo los pedidos DELIVERY tienen direccion (pedido %)', NEW.order_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "app"."order_delivery_requires_address"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
    IF NEW.fulfillment_type = 'DELIVERY'
       AND NOT EXISTS (SELECT 1 FROM app.order_addresses a WHERE a.order_id = NEW.id) THEN
        RAISE EXCEPTION 'app.orders: un pedido DELIVERY exige su fila en order_addresses (pedido %)', NEW.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'order_status_history_append_only'
                   AND tgrelid = 'app.order_status_history'::regclass) THEN
        CREATE TRIGGER "order_status_history_append_only"
            BEFORE UPDATE OR DELETE ON "app"."order_status_history"
            FOR EACH ROW EXECUTE FUNCTION "app"."order_status_history_append_only"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'order_items_immutable'
                   AND tgrelid = 'app.order_items'::regclass) THEN
        CREATE TRIGGER "order_items_immutable" BEFORE UPDATE OR DELETE ON "app"."order_items"
            FOR EACH ROW EXECUTE FUNCTION "app"."order_snapshot_immutable"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'order_item_modifiers_immutable'
                   AND tgrelid = 'app.order_item_modifiers'::regclass) THEN
        CREATE TRIGGER "order_item_modifiers_immutable" BEFORE UPDATE OR DELETE ON "app"."order_item_modifiers"
            FOR EACH ROW EXECUTE FUNCTION "app"."order_snapshot_immutable"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'order_promotions_immutable'
                   AND tgrelid = 'app.order_promotions'::regclass) THEN
        CREATE TRIGGER "order_promotions_immutable" BEFORE UPDATE OR DELETE ON "app"."order_promotions"
            FOR EACH ROW EXECUTE FUNCTION "app"."order_snapshot_immutable"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'order_addresses_immutable'
                   AND tgrelid = 'app.order_addresses'::regclass) THEN
        CREATE TRIGGER "order_addresses_immutable" BEFORE UPDATE OR DELETE ON "app"."order_addresses"
            FOR EACH ROW EXECUTE FUNCTION "app"."order_snapshot_immutable"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_immutable_fields'
                   AND tgrelid = 'app.orders'::regclass) THEN
        CREATE TRIGGER "orders_immutable_fields" BEFORE UPDATE ON "app"."orders"
            FOR EACH ROW EXECUTE FUNCTION "app"."orders_immutable_fields"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'order_addresses_requires_delivery'
                   AND tgrelid = 'app.order_addresses'::regclass) THEN
        CREATE CONSTRAINT TRIGGER "order_addresses_requires_delivery"
            AFTER INSERT ON "app"."order_addresses"
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION "app"."order_address_requires_delivery"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_delivery_requires_address'
                   AND tgrelid = 'app.orders'::regclass) THEN
        CREATE CONSTRAINT TRIGGER "orders_delivery_requires_address"
            AFTER INSERT ON "app"."orders"
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION "app"."order_delivery_requires_address"();
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 10) Comentarios
-- ------------------------------------------------------------------------------------------------
COMMENT ON TABLE "app"."orders" IS 'F20. Pedido: snapshot de contacto e importes. Pedido, pago y entrega tienen ciclos de vida independientes; F20 solo escribe status=pending.';
COMMENT ON COLUMN "app"."orders"."order_number" IS 'Número visible: IDENTITY desde 1001 (creciente, no contiguo). No es credencial.';
COMMENT ON COLUMN "app"."orders"."delivery_provider" IS 'Añadida sobre el DBML. OWN | PEDIDOSYA; NULL en PICKUP.';
COMMENT ON COLUMN "app"."orders"."extras_total" IS 'Añadida sobre el DBML. Σ extras de modificadores; ya incluida en subtotal.';
COMMENT ON COLUMN "app"."orders"."payment_method_preference" IS 'Añadida sobre el DBML. cash | bank_transfer; preferencia, no pago (F24 crea payments).';
COMMENT ON TABLE "app"."order_addresses" IS 'F20. Snapshot de la dirección de entrega; solo pedidos DELIVERY (constraint trigger aplazado). Inmutable.';
COMMENT ON TABLE "app"."order_items" IS 'F20. Snapshot de líneas (nombre/precio/extras/descuento). Inmutable.';
COMMENT ON COLUMN "app"."order_items"."line_no" IS 'Añadida sobre el DBML. Orden estable de la línea dentro del pedido.';
COMMENT ON COLUMN "app"."order_items"."extras_per_unit" IS 'Añadida sobre el DBML. Σ extras de modificadores por unidad.';
COMMENT ON TABLE "app"."order_item_modifiers" IS 'F20. Snapshot de modificadores de una línea. Inmutable.';
COMMENT ON TABLE "app"."order_promotions" IS 'F20. Promociones aplicadas con nombre y monto. Inmutable.';
COMMENT ON COLUMN "app"."order_promotions"."promotion_name" IS 'Añadida sobre el DBML. Snapshot del nombre.';
COMMENT ON TABLE "app"."order_status_history" IS 'F20. Historial de estados SOLO-AÑADIR (trigger).';
COMMENT ON TABLE "app"."order_access_tokens" IS 'F20. No está en el DBML. sha256 del token de invitado (32 bytes); revocable; vigencia 14 días.';
COMMENT ON TABLE "app"."order_idempotency_keys" IS 'F20. No está en el DBML. UNIQUE (scope, key_hash); FK al pedido aplazada a COMMIT; TTL 24 h.';

-- ------------------------------------------------------------------------------------------------
-- 11) Privilegios: igual que 0016/0017 (RLS sin políticas + REVOKE guardado por existencia de rol). Solo vía API.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "app"."orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."order_addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."order_item_modifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."order_promotions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."order_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."order_access_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."order_idempotency_keys" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "app"."orders" FROM PUBLIC;
REVOKE ALL ON "app"."order_addresses" FROM PUBLIC;
REVOKE ALL ON "app"."order_items" FROM PUBLIC;
REVOKE ALL ON "app"."order_item_modifiers" FROM PUBLIC;
REVOKE ALL ON "app"."order_promotions" FROM PUBLIC;
REVOKE ALL ON "app"."order_status_history" FROM PUBLIC;
REVOKE ALL ON "app"."order_access_tokens" FROM PUBLIC;
REVOKE ALL ON "app"."order_idempotency_keys" FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."order_status_history_append_only"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."order_snapshot_immutable"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."orders_immutable_fields"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."order_address_requires_delivery"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."order_delivery_requires_address"() FROM PUBLIC;

DO $$
DECLARE
    v_role text;
    v_table text;
    v_func text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            FOREACH v_table IN ARRAY ARRAY['orders', 'order_addresses', 'order_items', 'order_item_modifiers',
                                           'order_promotions', 'order_status_history', 'order_access_tokens',
                                           'order_idempotency_keys'] LOOP
                EXECUTE format('REVOKE ALL ON "app".%I FROM %I', v_table, v_role);
            END LOOP;
            FOREACH v_func IN ARRAY ARRAY['order_status_history_append_only', 'order_snapshot_immutable',
                                          'orders_immutable_fields', 'order_address_requires_delivery',
                                          'order_delivery_requires_address'] LOOP
                EXECUTE format('REVOKE ALL ON FUNCTION "app".%I() FROM %I', v_func, v_role);
            END LOOP;
        END IF;
    END LOOP;
END $$;
