-- 0023 · F16 banners simplificados (specs/017-banners-campaigns, simplificación; ADR de la simplificación de F16).
-- Un banner pasa a ser SOLO imagen + texto alternativo (banner_translations, fila locale='es', columna image_alt) + active.
-- La API deja de usar cta_*, starts_at/ends_at, sort_order, banner_branches, promotion_id, la traducción 'en' y
-- title/subtitle/cta_label (quedan NULL / sin filas). Orden del listado = created_at asc, id. Borrado FÍSICO.
-- Incremental y NO destructiva: NO borra ni modifica filas, NO borra columnas ni tablas (las columnas y tablas en desuso
-- se conservan para no romper el esquema 0017 ni Prisma; su retirada sería una migración futura aparte). Solo (1) reemplaza
-- UNA restricción CHECK (banner_translations_es_required_chk) por otra MÁS PERMISIVA y (2) añade un trigger de tope.
-- Relanzable: guardas por catálogo (pg_constraint / pg_trigger), CREATE OR REPLACE FUNCTION. Falla con mensaje claro si la
-- 0017 no está aplicada. Requiere 0017.
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real. Aplicarla ANTES de desplegar la API
-- simplificada de F16 (sin el CHECK nuevo, crear un banner sin title falla con 23514; sin el trigger no hay tope en BD).
-- Reversión manual (solo si no hay filas 'es' con title NULL; si las hay, completarlas o borrarlas antes):
--   DROP TRIGGER banners_max_count_trg ON app.banners; DROP FUNCTION app.banners_enforce_max_count();
--   ALTER TABLE app.banner_translations DROP CONSTRAINT banner_translations_es_required_chk,
--     ADD CONSTRAINT banner_translations_es_required_chk
--       CHECK ("locale" <> 'es' OR ("title" IS NOT NULL AND "image_alt" IS NOT NULL));
--
-- Decisiones:
-- * title ya admite NULL desde 0017 (columna TEXT sin NOT NULL) y los CHECK de longitud de title/subtitle/cta_label/image_alt
--   están escritos con «IS NULL OR ...», así que NULL pasa. Solo cambia banner_translations_es_required_chk: la fila 'es'
--   exige únicamente image_alt NO nulo (y, por banner_translations_image_alt_len_chk, de 1..200 caracteres recortados).
--   Mismo NOMBRE de restricción (la API y las guardas de 0017 lo siguen reconociendo). ADD CONSTRAINT valida las filas
--   existentes: todas cumplían la anterior (title e image_alt NO nulos), luego cumplen la nueva. Un CHECK no falla con NULL
--   por sí solo; por eso la expresión es explícita sobre image_alt IS NOT NULL.
-- * TOPE DE 5 BANNERS en BD: trigger BEFORE INSERT FOR EACH ROW banners_max_count_trg -> app.banners_enforce_max_count().
--   Serializa los INSERT concurrentes con pg_advisory_xact_lock(1700170) (clave propia de F16/spec 017; la 0011 usa
--   1100110; la API NO necesita tomarla) y cuenta las filas; si ya hay >= 5 lanza
--       SQLSTATE 23514 (check_violation), mensaje 'banners_max_count', CONSTRAINT = 'banners_max_count'
--   (convención de 0012/0013: 23514 + mensaje estable para los topes de cantidad; CONSTRAINT = nombre como 0022). La API
--   clasifica por e.message/constraint 'banners_max_count'. En READ COMMITTED (defecto de PostgreSQL/Prisma) el COUNT corre
--   DESPUÉS de obtener el bloqueo, así que ve lo confirmado por la transacción anterior; el bloqueo se libera al COMMIT/
--   ROLLBACK. En REPEATABLE READ/SERIALIZABLE el snapshot sería previo al bloqueo (la API no usa esos niveles aquí).
--   El trigger solo aplica a INSERT: nunca bloquea UPDATE/DELETE/lecturas, y con más de 5 filas históricas NO falla ni
--   modifica nada (solo impide NUEVAS inserciones hasta bajar de 5). Cuenta TODAS las filas (activas e inactivas).
-- * Índices: NO se añade ninguno. Con <= 5 filas en total un scan secuencial + sort es lo más barato; un índice por
--   (created_at, id) no aporta. banners_active_order_idx (sort_order, created_at, id) WHERE active de 0017 queda sin uso
--   útil para el nuevo orden (sort_order es siempre 0, así que su orden efectivo coincide con created_at, id y el planificador
--   puede usarlo igual) pero se CONSERVA: no se borra nada, su coste es despreciable y evita DDL destructivo; retirarlo
--   sería una limpieza futura junto con las columnas en desuso. banners_image_asset_idx sigue sirviendo a la FK RESTRICT.
-- * Borrado físico: DELETE FROM app.banners cae en cascada a banner_translations y banner_branches (FK ON DELETE CASCADE de
--   0017). NO toca app.media_assets (ninguna FK va del asset al banner). La FK banners_image_asset_id_fkey (RESTRICT) impide
--   borrar el asset mientras exista el banner (23503); la API borra primero el banner y después el asset (y el objeto en
--   el almacenamiento). Si el borrado del asset falla tras borrar el banner, queda un asset huérfano reutilizable/limpiable.
-- * Privilegios: la función del trigger se crea con REVOKE ALL FROM PUBLIC (+ anon/authenticated si existen), como 0022.

-- ------------------------------------------------------------------------------------------------
-- 0) Guarda: 0017 debe estar aplicada con las restricciones que se tocan.
-- ------------------------------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('app.banners') IS NULL OR to_regclass('app.banner_translations') IS NULL THEN
        RAISE EXCEPTION '0023: faltan app.banners/app.banner_translations; aplicar antes 0017_banners.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
         WHERE conrelid = 'app.banner_translations'::regclass AND conname = 'banner_translations_es_required_chk'
    ) THEN
        RAISE EXCEPTION '0023: app.banner_translations no tiene banner_translations_es_required_chk; definicion ajena, revisar a mano.';
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 1) Fila 'es': solo image_alt es obligatorio (title ya admite NULL). Reemplazo guardado: solo si la definición actual
--    todavía menciona title (relanzable). Es más permisivo, así que las filas existentes siempre la cumplen.
-- ------------------------------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
         WHERE conrelid = 'app.banner_translations'::regclass AND conname = 'banner_translations_es_required_chk'
           AND pg_get_constraintdef(oid) LIKE '%title%'
    ) THEN
        ALTER TABLE "app"."banner_translations" DROP CONSTRAINT "banner_translations_es_required_chk";
        ALTER TABLE "app"."banner_translations"
            ADD CONSTRAINT "banner_translations_es_required_chk" CHECK ("locale" <> 'es' OR "image_alt" IS NOT NULL);
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 2) Tope de 5 banners (solo INSERT).
-- ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "app"."banners_enforce_max_count"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_count int;
BEGIN
    -- Serializa los INSERT concurrentes (clave constante propia de F16) antes de contar.
    PERFORM pg_advisory_xact_lock(1700170);
    SELECT count(*)::int INTO v_count FROM "app"."banners";
    IF v_count >= 5 THEN
        RAISE EXCEPTION 'banners_max_count' USING ERRCODE = '23514', CONSTRAINT = 'banners_max_count';
    END IF;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION "app"."banners_enforce_max_count"() FROM PUBLIC;

DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION "app"."banners_enforce_max_count"() FROM %I', v_role);
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
         WHERE tgname = 'banners_max_count_trg' AND tgrelid = 'app.banners'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "banners_max_count_trg"
            BEFORE INSERT ON "app"."banners"
            FOR EACH ROW EXECUTE FUNCTION "app"."banners_enforce_max_count"();
    END IF;
END $$;
