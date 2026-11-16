-- 0013 · F12 modificadores de producto. Línea base: DBML `app.modifier_groups`, `app.modifiers`,
-- `app.product_modifier_groups`. NO crea `app.order_item_modifiers` (snapshot de pedido: pertenece a F20).
-- Incremental y NO destructiva: solo CREATE (tablas, índices, funciones, triggers, RLS). No borra ni modifica datos.
-- Relanzable (IF NOT EXISTS / OR REPLACE / guardas por catálogo). Las FKs cruzan hacia app.products (creada en 0012,
-- que debe estar aplicada antes: esta migración falla si no existe).
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real.
-- El DBML NO se edita; desviaciones (se justifican en el ADR de F12): columnas active/created_at/updated_at/sort_order
-- añadidas (updated_at lo mantiene la API en el UPDATE, sin trigger, como 0007/0011/0012); CHECK de longitud/rango;
-- FKs con acción explícita (el DBML no la indica: NO ACTION); UNIQUE case-insensitive de nombres; topes por trigger.
-- Reversión manual (en este orden): triggers product_modifier_groups_limit_trg y modifiers_limit_trg; funciones
-- app.product_modifier_groups_enforce_limit() y app.modifiers_enforce_limit(); tablas app.product_modifier_groups,
-- app.modifiers, app.modifier_groups. Si F20 ya creó order_item_modifiers con FK a modifiers, quitar esa FK antes.
--
-- Decisiones:
-- * Nombres únicos sin distinguir mayúsculas ni espacios de borde: índice UNIQUE sobre lower(btrim(name)) (grupo) y
--   (group_id, lower(btrim(name))) (opción). Prisma no expresa índices sobre expresiones: el servicio debe capturar 23505.
-- * sort_order de opciones y de grupos por producto: UNIQUE (..., sort_order) DEFERRABLE INITIALLY DEFERRED, igual que
--   product_media (0012). Permite reordenar/reemplazar en una transacción (el choque se evalúa al COMMIT; el servicio
--   reasigna 0..n-1). Consecuencia: ON CONFLICT no puede usar estas restricciones como árbitro. DESVIACIÓN respecto a
--   lo pedido: NO se crea el índice (group_id, sort_order, name, id); como (group_id, sort_order) es único, `name, id`
--   nunca desempata y el índice de la propia restricción ya sirve `WHERE group_id = $1 ORDER BY sort_order`
--   (también cubre el FK group_id y la cascada/RESTRICT). Un índice adicional sería redundante y encarecería escrituras.
-- * Topes (30 opciones por grupo, 10 grupos por producto): los aplica el servicio y, como defensa, triggers BEFORE
--   INSERT OR UPDATE OF <fk>. Cada trigger toma `SELECT ... FOR NO KEY UPDATE` sobre la fila padre (grupo/producto),
--   que serializa inserciones concurrentes sin chocar con el KEY SHARE de las FK, y cuenta DESPUÉS del bloqueo; en
--   READ COMMITTED (defecto de PostgreSQL/Prisma) ve lo confirmado por la transacción anterior. ERRCODE 23514,
--   mensajes 'modifier_group_max_options' y 'product_max_modifier_groups'. En REPEATABLE READ/SERIALIZABLE el snapshot
--   es previo al bloqueo y no basta: el servicio debe usar READ COMMITTED. Al reemplazar la lista, borrar antes de
--   insertar dentro de la misma transacción. Un UPDATE que no cambia el padre no cuenta (no se cuenta a sí mismo).
-- * ON DELETE RESTRICT sobre modifier_groups (opciones y vínculos con productos): un grupo en uso no se borra; se
--   desactiva (active=false). ON DELETE CASCADE sobre products en product_modifier_groups: el vínculo es del producto.
-- * Las ediciones de precio de una opción NO afectan pedidos pasados: F20 guardará snapshot (nombre/precio) en
--   order_item_modifiers; por eso allí modifier_id podrá ser ON DELETE SET NULL (DBML) sin perder el histórico.

CREATE TABLE IF NOT EXISTS "app"."modifier_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "min_select" SMALLINT NOT NULL DEFAULT 0,
    "max_select" SMALLINT NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "modifier_groups_name_len_chk" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
    CONSTRAINT "modifier_groups_select_chk" CHECK (
        "min_select" >= 0 AND "max_select" >= 1 AND "max_select" <= 20 AND "min_select" <= "max_select")
);

CREATE UNIQUE INDEX IF NOT EXISTS "modifier_groups_name_lower_key"
    ON "app"."modifier_groups" (lower(btrim("name")));

CREATE TABLE IF NOT EXISTS "app"."modifiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "extra_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "modifiers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "modifiers_group_id_fkey" FOREIGN KEY ("group_id")
        REFERENCES "app"."modifier_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "modifiers_name_len_chk" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
    CONSTRAINT "modifiers_extra_price_chk" CHECK ("extra_price" >= 0 AND "extra_price" <= 9999.99),
    CONSTRAINT "modifiers_sort_order_chk" CHECK ("sort_order" >= 0),
    CONSTRAINT "modifiers_group_sort_key" UNIQUE ("group_id", "sort_order") DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS "modifiers_group_name_lower_key"
    ON "app"."modifiers" ("group_id", lower(btrim("name")));

CREATE TABLE IF NOT EXISTS "app"."product_modifier_groups" (
    "product_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "product_modifier_groups_pkey" PRIMARY KEY ("product_id", "group_id"),
    CONSTRAINT "product_modifier_groups_product_id_fkey" FOREIGN KEY ("product_id")
        REFERENCES "app"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_modifier_groups_group_id_fkey" FOREIGN KEY ("group_id")
        REFERENCES "app"."modifier_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "product_modifier_groups_sort_order_chk" CHECK ("sort_order" >= 0),
    CONSTRAINT "product_modifier_groups_product_sort_key" UNIQUE ("product_id", "sort_order")
        DEFERRABLE INITIALLY DEFERRED
);

-- La PK cubre product_id; este índice sirve al FK group_id (RESTRICT al borrar un grupo y "productos de un grupo").
CREATE INDEX IF NOT EXISTS "product_modifier_groups_group_idx"
    ON "app"."product_modifier_groups" ("group_id");

CREATE OR REPLACE FUNCTION "app"."modifiers_enforce_limit"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_count int;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.group_id = NEW.group_id THEN
        RETURN NEW;
    END IF;
    -- Serializa inserciones/reasignaciones del mismo grupo antes de contar (ver encabezado).
    PERFORM 1 FROM "app"."modifier_groups" WHERE id = NEW.group_id FOR NO KEY UPDATE;
    SELECT count(*)::int INTO v_count FROM "app"."modifiers" WHERE group_id = NEW.group_id;
    IF v_count >= 30 THEN
        RAISE EXCEPTION 'modifier_group_max_options' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "app"."product_modifier_groups_enforce_limit"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_count int;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.product_id = NEW.product_id THEN
        RETURN NEW;
    END IF;
    PERFORM 1 FROM "app"."products" WHERE id = NEW.product_id FOR NO KEY UPDATE;
    SELECT count(*)::int INTO v_count FROM "app"."product_modifier_groups" WHERE product_id = NEW.product_id;
    IF v_count >= 10 THEN
        RAISE EXCEPTION 'product_max_modifier_groups' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
         WHERE tgname = 'modifiers_limit_trg' AND tgrelid = '"app"."modifiers"'::regclass
    ) THEN
        CREATE TRIGGER "modifiers_limit_trg"
            BEFORE INSERT OR UPDATE OF "group_id" ON "app"."modifiers"
            FOR EACH ROW EXECUTE FUNCTION "app"."modifiers_enforce_limit"();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
         WHERE tgname = 'product_modifier_groups_limit_trg'
           AND tgrelid = '"app"."product_modifier_groups"'::regclass
    ) THEN
        CREATE TRIGGER "product_modifier_groups_limit_trg"
            BEFORE INSERT OR UPDATE OF "product_id" ON "app"."product_modifier_groups"
            FOR EACH ROW EXECUTE FUNCTION "app"."product_modifier_groups_enforce_limit"();
    END IF;
END $$;

-- Privilegios: igual que 0006/0009/0011/0012 (RLS sin políticas + REVOKE guardado por existencia de rol). Solo vía API.
ALTER TABLE "app"."modifier_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."modifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."product_modifier_groups" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "app"."modifier_groups" FROM PUBLIC;
REVOKE ALL ON "app"."modifiers" FROM PUBLIC;
REVOKE ALL ON "app"."product_modifier_groups" FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."modifiers_enforce_limit"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."product_modifier_groups_enforce_limit"() FROM PUBLIC;

DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            EXECUTE format('REVOKE ALL ON "app"."modifier_groups" FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON "app"."modifiers" FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON "app"."product_modifier_groups" FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON FUNCTION "app"."modifiers_enforce_limit"() FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON FUNCTION "app"."product_modifier_groups_enforce_limit"() FROM %I', v_role);
        END IF;
    END LOOP;
END $$;
