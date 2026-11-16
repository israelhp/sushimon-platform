-- 0012 · F11 productos y multimedia. Línea base: DBML `app.products`, `app.product_media`.
-- Incremental y NO destructiva: solo CREATE (tablas, índices, función, triggers, RLS) y una FK nueva sobre
-- app.customer_favorites. No borra ni modifica datos. Relanzable (IF NOT EXISTS / OR REPLACE / guardas por catálogo).
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real.
-- El DBML NO se edita; desviaciones (se justifican en el ADR de F11): products.created_at ya existe en el DBML pero
-- se añade updated_at (lo mantiene la API en el UPDATE, sin trigger, como 0007/0011); CHECK de formato/longitud/rango;
-- FK products->categories ON DELETE RESTRICT (el DBML no indica acción: NO ACTION; RESTRICT es inmediato y explícito);
-- UNIQUE (product_id, sort_order) aplazable; trigger de tope de 8 imágenes; FK de favoritos (aplazada desde 0009).
-- Reversión manual: eliminar FK customer_favorites_product_id_fkey e índice customer_favorites_product_idx; triggers
-- product_media_limit_trg; función app.product_media_enforce_limit(); tablas app.product_media y app.products (en ese
-- orden). Eliminar products borra en cascada sus favoritos solo si la FK sigue: quitar la FK antes.
--
-- Decisiones:
-- * sort_order de media: UNIQUE (product_id, sort_order) DEFERRABLE INITIALLY DEFERRED. Al reemplazar la lista en una
--   transacción (borrar/insertar/reordenar) el choque se evalúa al COMMIT, no fila a fila. Consecuencia: ON CONFLICT no
--   puede usar esta restricción como árbitro (PostgreSQL lo prohíbe); el servicio debe hacer DELETE + INSERT o UPDATE.
--   La restricción crea su propio índice (product_id, sort_order): NO se crea un índice adicional (sería redundante).
-- * Tope de 8 imágenes por producto: lo aplica el servicio y, como defensa, el trigger product_media_limit_trg. Es
--   viable sin carreras porque el trigger toma `SELECT ... FOR NO KEY UPDATE` sobre la fila del producto (serializa
--   inserciones concurrentes del mismo producto sin chocar con el KEY SHARE de las FK) y cuenta DESPUÉS de tener el
--   bloqueo; en READ COMMITTED (defecto de PostgreSQL/Prisma) ve lo confirmado por la transacción anterior. Error:
--   ERRCODE 23514, mensaje 'product_media_max_items'. En REPEATABLE READ/SERIALIZABLE el snapshot es previo al
--   bloqueo y no basta: el servicio debe usar READ COMMITTED. Si el servicio reemplaza la lista, debe borrar antes de
--   insertar dentro de la misma transacción.
-- * Búsqueda ILIKE por nombre: NO se crea pg_trgm (no garantizado en Supabase; no se crean extensiones). Con un
--   catálogo pequeño (cientos de productos) basta el seq scan; reevaluar con un índice trigram si crece a miles.

CREATE TABLE IF NOT EXISTS "app"."products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" TEXT,
    "category_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "base_price" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_sku_key" UNIQUE ("sku"),
    CONSTRAINT "products_slug_key" UNIQUE ("slug"),
    CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id")
        REFERENCES "app"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "products_sku_format_chk" CHECK ("sku" IS NULL OR ("sku" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' AND length("sku") <= 40)),
    CONSTRAINT "products_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") <= 80),
    CONSTRAINT "products_name_len_chk" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
    CONSTRAINT "products_description_len_chk" CHECK ("description" IS NULL OR length("description") <= 2000),
    CONSTRAINT "products_base_price_chk" CHECK ("base_price" > 0 AND "base_price" <= 999999.99)
);

-- Listado por categoría (filtro category_id [+ active], orden name, id) y soporte del FK RESTRICT.
CREATE INDEX IF NOT EXISTS "products_category_active_name_idx"
    ON "app"."products"("category_id", "active", "name", "id");
-- Listado público/general (filtro active, orden name, id).
CREATE INDEX IF NOT EXISTS "products_active_name_idx"
    ON "app"."products"("active", "name", "id");

CREATE TABLE IF NOT EXISTS "app"."product_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "media_url" TEXT NOT NULL,
    "alt_text" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id")
        REFERENCES "app"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_media_url_chk" CHECK (
        "media_url" ~ '^https://[^[:space:][:cntrl:]]+$' AND length("media_url") <= 2048),
    CONSTRAINT "product_media_alt_len_chk" CHECK ("alt_text" IS NULL OR length("alt_text") <= 200),
    CONSTRAINT "product_media_sort_order_chk" CHECK ("sort_order" >= 0),
    CONSTRAINT "product_media_product_sort_key" UNIQUE ("product_id", "sort_order")
        DEFERRABLE INITIALLY DEFERRED
);

CREATE OR REPLACE FUNCTION "app"."product_media_enforce_limit"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_count int;
BEGIN
    -- Serializa inserciones/reasignaciones del mismo producto antes de contar (ver encabezado).
    PERFORM 1 FROM "app"."products" WHERE id = NEW.product_id FOR NO KEY UPDATE;
    SELECT count(*)::int INTO v_count FROM "app"."product_media" WHERE product_id = NEW.product_id;
    IF v_count >= 8 THEN
        RAISE EXCEPTION 'product_media_max_items' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
         WHERE tgname = 'product_media_limit_trg' AND tgrelid = '"app"."product_media"'::regclass
    ) THEN
        CREATE TRIGGER "product_media_limit_trg"
            BEFORE INSERT OR UPDATE OF "product_id" ON "app"."product_media"
            FOR EACH ROW EXECUTE FUNCTION "app"."product_media_enforce_limit"();
    END IF;
END $$;

-- FK de favoritos (anunciada en 0009). Se añade NOT VALID (no escanea ni bloquea por largo: las filas nuevas ya se
-- validan) y se valida solo si no hay huérfanos. NUNCA se borran datos: con huérfanos queda NOT VALID y se avisa.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
         WHERE conname = 'customer_favorites_product_id_fkey'
           AND conrelid = '"app"."customer_favorites"'::regclass
    ) THEN
        ALTER TABLE "app"."customer_favorites"
            ADD CONSTRAINT "customer_favorites_product_id_fkey" FOREIGN KEY ("product_id")
            REFERENCES "app"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
    END IF;
END $$;

-- Soporte del ON DELETE CASCADE (borrar un producto busca sus favoritos por product_id).
CREATE INDEX IF NOT EXISTS "customer_favorites_product_idx"
    ON "app"."customer_favorites"("product_id");

DO $$
DECLARE
    v_orphans bigint;
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
         WHERE conname = 'customer_favorites_product_id_fkey'
           AND conrelid = '"app"."customer_favorites"'::regclass
           AND NOT convalidated
    ) THEN
        SELECT count(*) INTO v_orphans
          FROM "app"."customer_favorites" f
         WHERE NOT EXISTS (SELECT 1 FROM "app"."products" p WHERE p.id = f.product_id);
        IF v_orphans = 0 THEN
            ALTER TABLE "app"."customer_favorites" VALIDATE CONSTRAINT "customer_favorites_product_id_fkey";
        ELSE
            RAISE NOTICE 'customer_favorites_product_id_fkey queda NOT VALID: % favoritos huérfanos (product_id sin producto). '
                'Revise/limpie manualmente (p. ej. SELECT * FROM app.customer_favorites f WHERE NOT EXISTS '
                '(SELECT 1 FROM app.products p WHERE p.id = f.product_id)) y ejecute: ALTER TABLE app.customer_favorites '
                'VALIDATE CONSTRAINT customer_favorites_product_id_fkey;', v_orphans;
        END IF;
    END IF;
END $$;

-- Privilegios: igual que 0006/0009/0011 (RLS sin políticas + REVOKE guardado por existencia de rol). Solo vía API.
ALTER TABLE "app"."products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."product_media" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "app"."products" FROM PUBLIC;
REVOKE ALL ON "app"."product_media" FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."product_media_enforce_limit"() FROM PUBLIC;

DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            EXECUTE format('REVOKE ALL ON "app"."products" FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON "app"."product_media" FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON FUNCTION "app"."product_media_enforce_limit"() FROM %I', v_role);
        END IF;
    END LOOP;
END $$;
