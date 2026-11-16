-- 0016 · F15 promociones, cupones y Happy Hour (specs/016-promotions-happy-hour, ADR-0021). CREA las 4 tablas del DBML
-- (app.promotions, promotion_branches, promotion_products, promotion_weekdays): las migraciones 0001..0015 no las crean.
-- El DBML no se edita; las desviaciones (ampliaciones) se justifican abajo y en el ADR-0021. order_promotions NO se
-- crea aquí: depende de orders y llega con F20.
-- Incremental y NO destructiva: solo CREATE (tablas, índices, RLS). No borra ni modifica datos ni tablas existentes.
-- Relanzable: IF NOT EXISTS / guardas por catálogo. Si alguna de las 4 tablas ya existe con otra definición (le falta
-- una columna o una restricción de las esperadas), la migración FALLA con un mensaje claro y no reescribe nada.
-- Requiere 0003 (branches), 0006 (extensión btree_gist, para el EXCLUDE) y 0012 (products) aplicadas.
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real.
-- Reversión manual (solo sin datos que conservar y sin order_promotions apuntando a ellas): DROP TABLE en orden
-- app.promotion_weekdays, app.promotion_products, app.promotion_branches, app.promotions (índices, PK, UNIQUE, CHECK y
-- EXCLUDE caen con las tablas). La extensión btree_gist se deja instalada.
--
-- Decisiones (resumen; detalle en la spec D1..D8 y «Modelo de datos»):
-- * code NULL = promoción automática; code NOT NULL = cupón. El UNIQUE admite varias filas con NULL. code se guarda
--   normalizado (mayúsculas, sin espacios) por la API y por CHECK de formato: así el UNIQUE es insensible a mayúsculas
--   sin índice funcional.
-- * kind IN ('PERCENT','FIXED_AMOUNT') por CHECK (brecha A1). PERCENT: 0 < value <= 100. FIXED_AMOUNT: monto en GTQ
--   POR UNIDAD, 0 < value <= 999999.99. 2x1 y precio especial quedan fuera (P15).
-- * Vigencia [starts_at, ends_at) en instantes (timestamptz); CHECK ends_at > starts_at.
-- * Horario semanal en hora local de pared (America/Guatemala, calculada por la API), día ISO 1..7, [starts_at, ends_at)
--   con 24:00 solo como fin; sin tramos que crucen la medianoche (estrategia B de F08: se dividen). EXCLUDE gist
--   impide solapes dentro de (promoción, día); contiguos permitidos. TIME(0) con granularidad de minuto.
-- * Alcance: ausencia de filas en promotion_branches = todas las sucursales; en promotion_products = todos los
--   productos; en promotion_weekdays = sin restricción semanal (la API exige declararlo; la BD no lo impone).
-- * FKs: promotions -> hijas ON DELETE CASCADE (DBML; la API nunca borra promociones, solo active=false);
--   hijas -> branches/products ON DELETE RESTRICT (no se borran físicamente; se desactivan).
-- * version (concurrencia optimista) y updated_at los mantiene la API, sin triggers (como 0007/0011..0015).
-- * Índices por acceso real: la PK de cada hija ya sirve «hijas de una promoción» y el FK a promotions. Añadidos:
--   promotions_active_window_idx parcial (vigentes/próximas por fecha), promotion_branches_branch_idx y
--   promotion_products_product_idx («promociones de una sucursal/producto» y los FK RESTRICT sin seq scan). Con decenas
--   de filas el planificador puede preferir un scan: se conservan por claridad del acceso y bajo coste. Sin índice
--   para name/code ILIKE (listado admin sobre decenas de filas).

-- ------------------------------------------------------------------------------------------------
-- 0) Guarda: si una de las tablas ya existe, debe tener las columnas y restricciones esperadas.
--    Cubre el caso «existe con otra definición»; si todo coincide, el resto de la migración es no-op.
-- ------------------------------------------------------------------------------------------------
DO $$
DECLARE
    v_table text;
    v_col text;
    v_con text;
    v_expect_cols jsonb := jsonb_build_object(
        'promotions', ARRAY['id', 'code', 'name', 'description', 'kind', 'value', 'starts_at', 'ends_at',
                            'dine_in_only', 'active', 'version', 'created_at', 'updated_at'],
        'promotion_branches', ARRAY['promotion_id', 'branch_id'],
        'promotion_products', ARRAY['promotion_id', 'product_id'],
        'promotion_weekdays', ARRAY['promotion_id', 'weekday', 'starts_at', 'ends_at']);
    v_expect_cons jsonb := jsonb_build_object(
        'promotions', ARRAY['promotions_pkey', 'promotions_code_key', 'promotions_name_len', 'promotions_description_len',
                            'promotions_code_format', 'promotions_kind_valid', 'promotions_value_range',
                            'promotions_period', 'promotions_version_min'],
        'promotion_branches', ARRAY['promotion_branches_pkey', 'promotion_branches_promotion_id_fkey',
                                    'promotion_branches_branch_id_fkey'],
        'promotion_products', ARRAY['promotion_products_pkey', 'promotion_products_promotion_id_fkey',
                                    'promotion_products_product_id_fkey'],
        'promotion_weekdays', ARRAY['promotion_weekdays_pkey', 'promotion_weekdays_promotion_id_fkey',
                                    'promotion_weekdays_weekday_iso', 'promotion_weekdays_slot_order',
                                    'promotion_weekdays_minute_grain', 'promotion_weekdays_no_overlap']);
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
                RAISE EXCEPTION '0016: app.% ya existe con otra definicion (falta la columna %); no se modifica. Revisar a mano.',
                    v_table, v_col;
            END IF;
        END LOOP;
        FOR v_con IN SELECT jsonb_array_elements_text(v_expect_cons -> v_table) LOOP
            IF NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = format('app.%I', v_table)::regclass AND conname = v_con
            ) THEN
                RAISE EXCEPTION '0016: app.% ya existe con otra definicion (falta la restriccion %); no se modifica. Revisar a mano.',
                    v_table, v_con;
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 1) app.promotions
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."promotions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "dine_in_only" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promotions_code_key" UNIQUE ("code"),
    CONSTRAINT "promotions_name_len" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
    CONSTRAINT "promotions_description_len" CHECK ("description" IS NULL OR char_length("description") <= 500),
    -- Mayúsculas/dígitos/_/-, 3..32, primer carácter alfanumérico. NULL pasa (automática).
    CONSTRAINT "promotions_code_format" CHECK ("code" IS NULL OR "code" ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
    CONSTRAINT "promotions_kind_valid" CHECK ("kind" IN ('PERCENT', 'FIXED_AMOUNT')),
    CONSTRAINT "promotions_value_range" CHECK (
        ("kind" = 'PERCENT' AND "value" > 0 AND "value" <= 100)
        OR ("kind" = 'FIXED_AMOUNT' AND "value" > 0 AND "value" <= 999999.99)
    ),
    CONSTRAINT "promotions_period" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "promotions_version_min" CHECK ("version" >= 1)
);

-- Vigentes/próximas por fecha (lectura pública y F19): solo promociones activas.
CREATE INDEX IF NOT EXISTS "promotions_active_window_idx"
    ON "app"."promotions" ("ends_at", "starts_at") WHERE "active";

-- ------------------------------------------------------------------------------------------------
-- 2) app.promotion_branches (ausencia de filas = todas las sucursales)
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."promotion_branches" (
    "promotion_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    CONSTRAINT "promotion_branches_pkey" PRIMARY KEY ("promotion_id", "branch_id"),
    CONSTRAINT "promotion_branches_promotion_id_fkey" FOREIGN KEY ("promotion_id")
        REFERENCES "app"."promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "promotion_branches_branch_id_fkey" FOREIGN KEY ("branch_id")
        REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "promotion_branches_branch_idx"
    ON "app"."promotion_branches" ("branch_id", "promotion_id");

-- ------------------------------------------------------------------------------------------------
-- 3) app.promotion_products (ausencia de filas = todos los productos)
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."promotion_products" (
    "promotion_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    CONSTRAINT "promotion_products_pkey" PRIMARY KEY ("promotion_id", "product_id"),
    CONSTRAINT "promotion_products_promotion_id_fkey" FOREIGN KEY ("promotion_id")
        REFERENCES "app"."promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "promotion_products_product_id_fkey" FOREIGN KEY ("product_id")
        REFERENCES "app"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "promotion_products_product_idx"
    ON "app"."promotion_products" ("product_id", "promotion_id");

-- ------------------------------------------------------------------------------------------------
-- 4) app.promotion_weekdays (ausencia de filas = sin restricción semanal)
--    Mismo patrón que app.branch_hours (0006): día ISO 1..7, [starts_at, ends_at), 24:00 solo como fin, minutos exactos,
--    EXCLUDE de solapes sobre una fecha fija (PostgreSQL no tiene timerange; date + '24:00' = 2000-01-02 00:00).
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."promotion_weekdays" (
    "promotion_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "starts_at" TIME(0) NOT NULL,
    "ends_at" TIME(0) NOT NULL,
    CONSTRAINT "promotion_weekdays_pkey" PRIMARY KEY ("promotion_id", "weekday", "starts_at"),
    CONSTRAINT "promotion_weekdays_promotion_id_fkey" FOREIGN KEY ("promotion_id")
        REFERENCES "app"."promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "promotion_weekdays_weekday_iso" CHECK ("weekday" BETWEEN 1 AND 7),
    CONSTRAINT "promotion_weekdays_slot_order" CHECK ("starts_at" < "ends_at"),
    CONSTRAINT "promotion_weekdays_minute_grain" CHECK (
        EXTRACT(SECOND FROM "starts_at") = 0 AND EXTRACT(SECOND FROM "ends_at") = 0
    ),
    CONSTRAINT "promotion_weekdays_no_overlap" EXCLUDE USING gist (
        "promotion_id" WITH =,
        "weekday" WITH =,
        tsrange(DATE '2000-01-01' + "starts_at", DATE '2000-01-01' + "ends_at", '[)') WITH &&
    )
);

-- ------------------------------------------------------------------------------------------------
-- 5) Privilegios: igual que 0006/0009/0011..0015 (RLS sin políticas + REVOKE guardado por existencia de rol).
--    Solo se accede vía API (rol de servicio / propietario). ENABLE ROW LEVEL SECURITY y REVOKE son idempotentes.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "app"."promotions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."promotion_branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."promotion_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."promotion_weekdays" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "app"."promotions" FROM PUBLIC;
REVOKE ALL ON "app"."promotion_branches" FROM PUBLIC;
REVOKE ALL ON "app"."promotion_products" FROM PUBLIC;
REVOKE ALL ON "app"."promotion_weekdays" FROM PUBLIC;

DO $$
DECLARE
    v_role text;
    v_table text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            FOREACH v_table IN ARRAY ARRAY['promotions', 'promotion_branches', 'promotion_products', 'promotion_weekdays'] LOOP
                EXECUTE format('REVOKE ALL ON "app".%I FROM %I', v_table, v_role);
            END LOOP;
        END IF;
    END LOOP;
END $$;
