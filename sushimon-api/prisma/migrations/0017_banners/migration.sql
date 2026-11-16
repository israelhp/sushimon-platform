-- 0017 · F16 banners y campañas del Inicio (specs/017-banners-campaigns, ADR-0022). CREA app.banners,
-- app.banner_translations y app.banner_branches (el DBML no contempla banners; no se edita, la desviación se justifica en
-- el ADR-0022), AMPLÍA app.media_assets (F14) con el tipo BANNER_IMAGE y SIEMBRA los permisos banners.read|create|update.
-- Incremental y NO destructiva: CREATE de tablas/índices/RLS, reemplazo de UNA restricción CHECK de media_assets
-- (media_assets_kind_chk, solo se AMPLÍA el conjunto de valores) y datos de referencia de permisos. No borra ni modifica
-- filas. Relanzable: IF NOT EXISTS / guardas por catálogo. Si alguna de las 3 tablas ya existe con otra definición (falta
-- una columna o una restricción de las esperadas), la migración FALLA con un mensaje claro y no reescribe nada.
-- Requiere 0002/0005 (staff y permisos), 0003 (branches), 0011 (categories), 0012 (products), 0015 (media_assets) y
-- 0016 (promotions) aplicadas.
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real. Aplicarla ANTES de desplegar la API de F16
-- (sin ella GET /v1/store/banners responde 500).
-- Reversión manual (solo sin datos que conservar): DROP TABLE app.banner_translations, app.banner_branches, app.banners
-- (índices, PK, UNIQUE y CHECK caen con ellas); solo si NO hay assets BANNER_IMAGE: ALTER TABLE app.media_assets DROP
-- CONSTRAINT media_assets_kind_chk, media_assets_banner_size_chk, media_assets_key_prefix_chk y re-crear
-- media_assets_kind_chk CHECK (kind IN ('PRODUCT_IMAGE')); DELETE de los 3 permisos (role_permissions cae en cascada si
-- su FK es CASCADE; si no, borrar antes las filas de role_permissions de esos permisos).
--
-- Decisiones (resumen; detalle en la spec D1..D12 y «Modelo de datos»):
-- * Estados inactivo/programado/publicado/vencido DERIVADOS (active + fechas), nunca columnas. Sin placement ni imagen
--   móvil (P20/P21: extensiones aditivas futuras).
-- * code: único y normalizado (minúsculas) por CHECK de formato; su INMUTABILIDAD la impone la API (sin triggers, como
--   0007/0011..0016); la BD no la fuerza.
-- * image_asset_id NOT NULL, FK a media_assets RESTRICT (un asset en uso no se borra); la API exige READY y BANNER_IMAGE.
-- * CTA estructurado: cta_type cerrado; una columna de referencia por tipo con FK real RESTRICT a categories/products y
--   CHECK «uno y solo uno» (la referencia existe SII el tipo la usa); cta_page con lista blanca cerrada. EXTERNAL NO
--   existe (ni tipo ni columna cta_url): ver ADR-0022 / P19.
-- * promotion_id NULL, FK a promotions RESTRICT (F15 no borra). La coherencia de alcance de sucursales banner/promoción
--   la valida la API.
-- * Vigencia [starts_at, ends_at) con ambos extremos NULL permitidos; CHECK ends_at > starts_at cuando hay ambos.
-- * sort_order 0..9999, NO único (desempate created_at, id en la API). version y updated_at los mantiene la API.
-- * Traducciones: tabla (banner_id, locale) con locale es|en; textos recortados no vacíos (en blanco = NULL); la fila
--   'es' exige title e image_alt por CHECK. La EXISTENCIA de la fila 'es' y la coherencia branchScope/filas las impone el
--   servicio (no hay forma declarativa sin trigger).
-- * banner_branches: ausencia de filas = todas las sucursales (como F15). Hijas -> banners ON DELETE CASCADE (la API nunca
--   borra banners); -> branches RESTRICT.
-- * media_assets: kind IN ('PRODUCT_IMAGE','BANNER_IMAGE'); coherencia kind/prefijo de object_key (products/ vs banners/);
--   tope de 1 MiB solo para BANNER_IMAGE (el genérico de 5 MiB no cambia). ADD CONSTRAINT valida las filas existentes
--   (todas PRODUCT_IMAGE): si alguna clave existente no empieza por 'products/' la migración falla sin reescribir nada;
--   en ese caso corregir los datos a mano o usar NOT VALID + VALIDATE y avisar.
-- * Índices por acceso real: banners_active_order_idx parcial (lectura pública y listado admin), banners_image_asset_idx
--   (FK RESTRICT y «usos del asset»), banner_branches_branch_idx. Sin índices en cta_category_id, cta_product_id ni
--   promotion_id (F10/F11/F15 no borran; decenas de filas). Con decenas de filas el planificador puede preferir un scan.
-- * Permisos: banners.read|create|update (convención modulo.accion, ADR-0010) asignados SOLO a admin (invariante de 0005:
--   admin tiene todo el catálogo; catálogo 43 -> 46). Ningún otro rol los recibe.

-- ------------------------------------------------------------------------------------------------
-- 0) Guarda: si una de las tablas ya existe, debe tener las columnas y restricciones esperadas.
-- ------------------------------------------------------------------------------------------------
DO $$
DECLARE
    v_table text;
    v_col text;
    v_con text;
    v_expect_cols jsonb := jsonb_build_object(
        'banners', ARRAY['id', 'code', 'image_asset_id', 'cta_type', 'cta_category_id', 'cta_product_id', 'cta_page',
                         'promotion_id', 'starts_at', 'ends_at', 'active', 'sort_order', 'version', 'created_at',
                         'updated_at'],
        'banner_translations', ARRAY['banner_id', 'locale', 'title', 'subtitle', 'cta_label', 'image_alt'],
        'banner_branches', ARRAY['banner_id', 'branch_id']);
    v_expect_cons jsonb := jsonb_build_object(
        'banners', ARRAY['banners_pkey', 'banners_code_key', 'banners_image_asset_id_fkey',
                         'banners_cta_category_id_fkey', 'banners_cta_product_id_fkey', 'banners_promotion_id_fkey',
                         'banners_code_format_chk', 'banners_cta_type_chk', 'banners_cta_refs_chk',
                         'banners_cta_page_chk', 'banners_period_chk', 'banners_sort_order_chk',
                         'banners_version_chk'],
        'banner_translations', ARRAY['banner_translations_pkey', 'banner_translations_banner_id_fkey',
                                     'banner_translations_locale_chk', 'banner_translations_title_len_chk',
                                     'banner_translations_subtitle_len_chk', 'banner_translations_cta_label_len_chk',
                                     'banner_translations_image_alt_len_chk', 'banner_translations_es_required_chk'],
        'banner_branches', ARRAY['banner_branches_pkey', 'banner_branches_banner_id_fkey',
                                 'banner_branches_branch_id_fkey']);
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
                RAISE EXCEPTION '0017: app.% ya existe con otra definicion (falta la columna %); no se modifica. Revisar a mano.',
                    v_table, v_col;
            END IF;
        END LOOP;
        FOR v_con IN SELECT jsonb_array_elements_text(v_expect_cons -> v_table) LOOP
            IF NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = format('app.%I', v_table)::regclass AND conname = v_con
            ) THEN
                RAISE EXCEPTION '0017: app.% ya existe con otra definicion (falta la restriccion %); no se modifica. Revisar a mano.',
                    v_table, v_con;
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 1) app.media_assets (F14): BANNER_IMAGE. Solo amplía restricciones; no toca filas.
-- ------------------------------------------------------------------------------------------------
DO $$
BEGIN
    -- kind: reemplaza el CHECK solo si aún no admite BANNER_IMAGE (relanzable).
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
         WHERE conrelid = 'app.media_assets'::regclass AND conname = 'media_assets_kind_chk'
           AND pg_get_constraintdef(oid) NOT LIKE '%BANNER_IMAGE%'
    ) THEN
        ALTER TABLE "app"."media_assets" DROP CONSTRAINT "media_assets_kind_chk";
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
         WHERE conrelid = 'app.media_assets'::regclass AND conname = 'media_assets_kind_chk'
    ) THEN
        ALTER TABLE "app"."media_assets"
            ADD CONSTRAINT "media_assets_kind_chk" CHECK ("kind" IN ('PRODUCT_IMAGE', 'BANNER_IMAGE'));
    END IF;

    -- Tope de 1 MiB solo para banners (el genérico de 5 MiB, media_assets_size_chk, no cambia).
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
         WHERE conrelid = 'app.media_assets'::regclass AND conname = 'media_assets_banner_size_chk'
    ) THEN
        ALTER TABLE "app"."media_assets"
            ADD CONSTRAINT "media_assets_banner_size_chk" CHECK ("kind" <> 'BANNER_IMAGE' OR "size_bytes" <= 1048576);
    END IF;

    -- Coherencia tipo/prefijo de la clave de objeto. Falla de forma clara si una fila existente no cumple.
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
         WHERE conrelid = 'app.media_assets'::regclass AND conname = 'media_assets_key_prefix_chk'
    ) THEN
        ALTER TABLE "app"."media_assets"
            ADD CONSTRAINT "media_assets_key_prefix_chk" CHECK (
                ("kind" = 'PRODUCT_IMAGE' AND "object_key" LIKE 'products/%')
                OR ("kind" = 'BANNER_IMAGE' AND "object_key" LIKE 'banners/%'));
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 2) app.banners
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."banners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "image_asset_id" UUID NOT NULL,
    "cta_type" TEXT NOT NULL DEFAULT 'NONE',
    "cta_category_id" UUID,
    "cta_product_id" UUID,
    "cta_page" TEXT,
    "promotion_id" UUID,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "banners_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "banners_code_key" UNIQUE ("code"),
    CONSTRAINT "banners_image_asset_id_fkey" FOREIGN KEY ("image_asset_id")
        REFERENCES "app"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "banners_cta_category_id_fkey" FOREIGN KEY ("cta_category_id")
        REFERENCES "app"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "banners_cta_product_id_fkey" FOREIGN KEY ("cta_product_id")
        REFERENCES "app"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "banners_promotion_id_fkey" FOREIGN KEY ("promotion_id")
        REFERENCES "app"."promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    -- Minúsculas/dígitos/guion, 3..64, primer carácter alfanumérico. El UNIQUE es así insensible a mayúsculas sin índice funcional.
    CONSTRAINT "banners_code_format_chk" CHECK ("code" ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
    CONSTRAINT "banners_cta_type_chk" CHECK ("cta_type" IN ('NONE', 'MENU', 'PROMOTIONS', 'CATEGORY', 'PRODUCT', 'PAGE')),
    -- Una referencia por tipo, y solo la de su tipo.
    CONSTRAINT "banners_cta_refs_chk" CHECK (
        ("cta_type" = 'CATEGORY') = ("cta_category_id" IS NOT NULL)
        AND ("cta_type" = 'PRODUCT') = ("cta_product_id" IS NOT NULL)
        AND ("cta_type" = 'PAGE') = ("cta_page" IS NOT NULL)),
    CONSTRAINT "banners_cta_page_chk" CHECK ("cta_page" IS NULL OR "cta_page" IN ('CAREERS', 'TRACK_ORDER', 'INCIDENTS')),
    CONSTRAINT "banners_period_chk" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"),
    CONSTRAINT "banners_sort_order_chk" CHECK ("sort_order" BETWEEN 0 AND 9999),
    CONSTRAINT "banners_version_chk" CHECK ("version" >= 1)
);

-- Lectura pública y listado admin: solo banners activos, en el orden de la API (sort_order, created_at, id).
CREATE INDEX IF NOT EXISTS "banners_active_order_idx"
    ON "app"."banners" ("sort_order", "created_at", "id") WHERE "active";
-- FK RESTRICT sin seq scan y «usos del asset».
CREATE INDEX IF NOT EXISTS "banners_image_asset_idx" ON "app"."banners" ("image_asset_id");

-- ------------------------------------------------------------------------------------------------
-- 3) app.banner_translations (es obligatoria con título y alt; en opcional)
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."banner_translations" (
    "banner_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "cta_label" TEXT,
    "image_alt" TEXT,
    CONSTRAINT "banner_translations_pkey" PRIMARY KEY ("banner_id", "locale"),
    CONSTRAINT "banner_translations_banner_id_fkey" FOREIGN KEY ("banner_id")
        REFERENCES "app"."banners"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "banner_translations_locale_chk" CHECK ("locale" IN ('es', 'en')),
    CONSTRAINT "banner_translations_title_len_chk" CHECK ("title" IS NULL OR char_length(btrim("title")) BETWEEN 1 AND 80),
    CONSTRAINT "banner_translations_subtitle_len_chk" CHECK ("subtitle" IS NULL OR char_length(btrim("subtitle")) BETWEEN 1 AND 160),
    CONSTRAINT "banner_translations_cta_label_len_chk" CHECK ("cta_label" IS NULL OR char_length(btrim("cta_label")) BETWEEN 1 AND 40),
    CONSTRAINT "banner_translations_image_alt_len_chk" CHECK ("image_alt" IS NULL OR char_length(btrim("image_alt")) BETWEEN 1 AND 200),
    CONSTRAINT "banner_translations_es_required_chk" CHECK ("locale" <> 'es' OR ("title" IS NOT NULL AND "image_alt" IS NOT NULL))
);

-- ------------------------------------------------------------------------------------------------
-- 4) app.banner_branches (ausencia de filas = todas las sucursales)
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."banner_branches" (
    "banner_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    CONSTRAINT "banner_branches_pkey" PRIMARY KEY ("banner_id", "branch_id"),
    CONSTRAINT "banner_branches_banner_id_fkey" FOREIGN KEY ("banner_id")
        REFERENCES "app"."banners"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "banner_branches_branch_id_fkey" FOREIGN KEY ("branch_id")
        REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "banner_branches_branch_idx"
    ON "app"."banner_branches" ("branch_id", "banner_id");

-- ------------------------------------------------------------------------------------------------
-- 5) Privilegios: igual que 0006/0009/0011..0016 (RLS sin políticas + REVOKE guardado por existencia de rol).
--    Solo vía API.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "app"."banners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."banner_translations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."banner_branches" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "app"."banners" FROM PUBLIC;
REVOKE ALL ON "app"."banner_translations" FROM PUBLIC;
REVOKE ALL ON "app"."banner_branches" FROM PUBLIC;

DO $$
DECLARE
    v_role text;
    v_table text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            FOREACH v_table IN ARRAY ARRAY['banners', 'banner_translations', 'banner_branches'] LOOP
                EXECUTE format('REVOKE ALL ON "app".%I FROM %I', v_table, v_role);
            END LOOP;
        END IF;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 6) Permisos banners.read|create|update (catálogo 43 -> 46), asignados SOLO a admin. Mismo patrón que 0005
--    (INSERT ... ON CONFLICT DO NOTHING; admin por JOIN con roles). Relanzable.
-- ------------------------------------------------------------------------------------------------
INSERT INTO "app"."permissions" ("code", "description") VALUES
  ('banners.read', 'Ver banners'),
  ('banners.create', 'Crear banners'),
  ('banners.update', 'Editar, activar o desactivar y reordenar banners')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "app"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "app"."roles" r
JOIN "app"."permissions" p ON p."code" IN ('banners.read', 'banners.create', 'banners.update')
WHERE r."code" = 'admin'
ON CONFLICT DO NOTHING;
