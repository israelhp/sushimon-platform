-- 0015 · F14 medios en Cloudflare R2. Registro de objetos subidos (app.media_assets) y vínculo opcional desde
-- app.product_media. Tabla NUEVA respecto al DBML (el DBML no se edita; la desviación se justifica en el ADR de F14).
-- Incremental y NO destructiva: solo CREATE (tabla, índices, RLS) y ADD COLUMN/FK/índice sobre app.product_media. No
-- borra ni modifica datos. Relanzable (IF NOT EXISTS / guardas por catálogo). Requiere 0002 (staff_users) y 0012
-- (product_media) aplicadas.
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real.
-- Reversión manual (solo sin datos que conservar): ALTER TABLE app.product_media DROP CONSTRAINT product_media_asset_id_fkey;
-- DROP INDEX app.product_media_asset_idx; ALTER TABLE app.product_media DROP COLUMN asset_id; DROP TABLE app.media_assets
-- (índices, PK, UNIQUE y CHECKs caen con ella). Los objetos en R2 NO se borran con esto: limpiar el bucket aparte.
--
-- Decisiones:
-- * kind: hoy solo 'PRODUCT_IMAGE'. Ampliarlo (F16 u otro) exige una migración que reemplace media_assets_kind_chk.
-- * object_key: UNIQUE y de formato seguro: minúsculas/dígitos/'/'/'_'/'.'/'-', sin '/' inicial (lo garantiza el primer
--   carácter), sin '..' ni '//', <= 200. Evita path traversal y claves ambiguas al construir URLs/firmas.
-- * size_bytes <= 5242880 (5 MiB) es una defensa en BD del tope que aplica la API. SUBIR ESE TOPE EXIGE UNA MIGRACIÓN
--   que reemplace media_assets_size_chk (no basta con cambiar la configuración de la API).
-- * checksum_sha256: hex en minúsculas de 64 caracteres. Dedup: UNIQUE PARCIAL (kind, checksum_sha256) WHERE
--   status='READY'; varios PENDING con el mismo checksum son válidos (cargas concurrentes/reintentos); la segunda en
--   confirmarse recibe 23505 y el servicio la resuelve reutilizando el asset READY existente.
-- * status: PENDING (URL prefirmada emitida, objeto sin confirmar; exige expires_at) -> READY (confirmado; exige
--   confirmed_at). La purga de PENDING caducados la hace un job (índice parcial por (status, expires_at)); la BD no
--   borra nada por sí sola.
-- * created_by_staff_id: FK a staff_users ON DELETE SET NULL (conserva el asset si se elimina al empleado).
-- * product_media.asset_id: NULL (filas previas con media_url externa siguen válidas); FK ON DELETE RESTRICT: un asset en
--   uso no se puede borrar. media_url sigue NOT NULL y https (la API la deriva del asset). Un asset puede estar en
--   varias filas de product_media (mismo producto u otros).
-- * Índices: PK(id) y UNIQUE(object_key) los crean sus restricciones. Parcial (status, expires_at) WHERE status='PENDING'
--   para la purga; (created_at DESC, id) para el listado admin paginado; (asset_id) en product_media para el FK
--   (RESTRICT sin seq scan) y la consulta "dónde se usa este asset". El FK created_by_staff_id NO lleva índice: el
--   borrado de personal es excepcional y la tabla es pequeña (~miles de filas).

CREATE TABLE IF NOT EXISTS "app"."media_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_by_staff_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "confirmed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_assets_object_key_key" UNIQUE ("object_key"),
    CONSTRAINT "media_assets_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id")
        REFERENCES "app"."staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "media_assets_kind_chk" CHECK ("kind" IN ('PRODUCT_IMAGE')),
    CONSTRAINT "media_assets_object_key_chk" CHECK (
        "object_key" ~ '^[a-z0-9][a-z0-9/_.-]*$'
        AND "object_key" NOT LIKE '%..%'
        AND "object_key" NOT LIKE '%//%'
        AND length("object_key") <= 200),
    CONSTRAINT "media_assets_bucket_chk" CHECK (length("bucket") BETWEEN 1 AND 63),
    CONSTRAINT "media_assets_mime_chk" CHECK (
        "mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
    CONSTRAINT "media_assets_size_chk" CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880),
    CONSTRAINT "media_assets_checksum_chk" CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "media_assets_status_chk" CHECK ("status" IN ('PENDING', 'READY')),
    CONSTRAINT "media_assets_ready_confirmed_chk" CHECK ("status" <> 'READY' OR "confirmed_at" IS NOT NULL),
    CONSTRAINT "media_assets_pending_expires_chk" CHECK ("status" <> 'PENDING' OR "expires_at" IS NOT NULL)
);

-- Dedup: solo un asset READY por (kind, checksum). Los PENDING no cuentan.
CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_ready_checksum_key"
    ON "app"."media_assets" ("kind", "checksum_sha256") WHERE "status" = 'READY';
-- Purga de PENDING caducados.
CREATE INDEX IF NOT EXISTS "media_assets_pending_expires_idx"
    ON "app"."media_assets" ("status", "expires_at") WHERE "status" = 'PENDING';
-- Listado admin (más recientes primero, desempate estable por id).
CREATE INDEX IF NOT EXISTS "media_assets_created_idx"
    ON "app"."media_assets" ("created_at" DESC, "id");

-- Vínculo desde product_media (nullable: las filas existentes con URL externa siguen válidas).
ALTER TABLE "app"."product_media" ADD COLUMN IF NOT EXISTS "asset_id" UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
         WHERE conname = 'product_media_asset_id_fkey'
           AND conrelid = '"app"."product_media"'::regclass
    ) THEN
        ALTER TABLE "app"."product_media"
            ADD CONSTRAINT "product_media_asset_id_fkey" FOREIGN KEY ("asset_id")
            REFERENCES "app"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "product_media_asset_idx" ON "app"."product_media" ("asset_id");

-- Privilegios: igual que 0006/0009/0011..0014 (RLS sin políticas + REVOKE guardado por existencia de rol). Solo vía API.
ALTER TABLE "app"."media_assets" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "app"."media_assets" FROM PUBLIC;

DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            EXECUTE format('REVOKE ALL ON "app"."media_assets" FROM %I', v_role);
        END IF;
    END LOOP;
END $$;
