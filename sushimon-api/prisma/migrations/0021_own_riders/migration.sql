-- 0021 · F27 motoristas propios (specs/028-own-riders §2, ADR-0031). CREA app.riders (el DBML la define; las columnas añadidas
-- sobre el DBML se justifican abajo, en la spec §2 y en docs/database/README.md). El DBML no se edita.
-- Aditiva y NO destructiva: solo CREATE. No toca role_permissions (P93) ni crea deliveries (F28). Relanzable (IF NOT EXISTS,
-- CREATE OR REPLACE, trigger guardado por catálogo). Guarda inicial (como 0018/0019): si app.riders ya existe con otra
-- definición (falta una columna o restricción esperada), RAISE EXCEPTION y no se modifica nada. Requiere 0003 (branches).
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real.
--
-- Reversión manual (destructiva; solo si no hay motoristas que conservar; aprobación humana), en este orden:
--   DROP TABLE app.riders;
--   DROP FUNCTION app.riders_guard();
--
-- Excepción de limpieza (precedente 0004/0018/0019): un DELETE sobre riders se permite SOLO si la transacción hizo
-- `SET LOCAL app.allow_order_cleanup = 'on'`. La API nunca lo hace; lo usan las pruebas. No es un control de acceso.
--
-- NULL en CHECK: un CHECK solo falla con FALSE (con NULL pasa; ver 0020). Las columnas usadas por los CHECK obligatorios son
-- NOT NULL (el predicado nunca es NULL); las anulables (vehicle_type, license_plate) usan `IS NULL OR ...` explícito.

-- ------------------------------------------------------------------------------------------------
-- 0) Guarda: si la tabla ya existe, debe tener las columnas y restricciones esperadas.
-- ------------------------------------------------------------------------------------------------
DO $$
DECLARE
    v_col text;
    v_con text;
BEGIN
    IF to_regclass('app.riders') IS NULL THEN
        RETURN;
    END IF;
    FOREACH v_col IN ARRAY ARRAY['id', 'branch_id', 'full_name', 'name_key', 'phone', 'vehicle_type', 'license_plate',
                                 'active', 'availability', 'version', 'created_at', 'updated_at'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'app' AND table_name = 'riders' AND column_name = v_col
        ) THEN
            RAISE EXCEPTION '0021: app.riders ya existe con otra definicion (falta la columna %); no se modifica. Revisar a mano.', v_col;
        END IF;
    END LOOP;
    FOREACH v_con IN ARRAY ARRAY['riders_pkey', 'riders_phone_key', 'riders_branch_id_fkey', 'riders_phone_chk',
                                 'riders_name_chk', 'riders_vehicle_chk', 'riders_plate_chk', 'riders_availability_chk',
                                 'riders_inactive_unavailable_chk', 'riders_version_chk'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint
             WHERE conrelid = 'app.riders'::regclass AND conname = v_con
        ) THEN
            RAISE EXCEPTION '0021: app.riders ya existe con otra definicion (falta la restriccion %); no se modifica. Revisar a mano.', v_con;
        END IF;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 1) app.riders (DBML ampliado). Una persona = una fila (UNIQUE phone); baja = desactivar (sin DELETE).
-- ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."riders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,                       -- añadida: nombre sin acentos, minúsculas, espacios colapsados (la API la calcula)
    "phone" TEXT NOT NULL,
    "vehicle_type" TEXT,
    "license_plate" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "availability" TEXT NOT NULL DEFAULT 'UNAVAILABLE',   -- añadida: manual; BUSY NO existe aquí (derivado de F28)
    "version" INTEGER NOT NULL DEFAULT 1,           -- añadida: concurrencia optimista
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "riders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "riders_phone_key" UNIQUE ("phone"),
    CONSTRAINT "riders_branch_id_fkey" FOREIGN KEY ("branch_id")
        REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "riders_phone_chk" CHECK ("phone" ~ '^\+502[0-9]{8}$'),
    CONSTRAINT "riders_name_chk" CHECK (char_length(btrim("full_name")) BETWEEN 2 AND 80
        AND "full_name" = btrim("full_name") AND "full_name" !~ '[[:cntrl:]]' AND btrim("name_key") <> ''),
    CONSTRAINT "riders_vehicle_chk" CHECK ("vehicle_type" IS NULL
        OR "vehicle_type" IN ('MOTORCYCLE', 'BICYCLE', 'CAR', 'ON_FOOT')),
    CONSTRAINT "riders_plate_chk" CHECK ("license_plate" IS NULL OR "license_plate" ~ '^[A-Z0-9]{4,10}$'),
    CONSTRAINT "riders_availability_chk" CHECK ("availability" IN ('AVAILABLE', 'UNAVAILABLE')),
    CONSTRAINT "riders_inactive_unavailable_chk" CHECK ("active" OR "availability" = 'UNAVAILABLE'),
    CONSTRAINT "riders_version_chk" CHECK ("version" >= 1)
);
-- Índices (toda consulta está acotada por sucursal o por id):
CREATE INDEX IF NOT EXISTS "riders_branch_name_idx" ON "app"."riders" ("branch_id", "name_key", "id");   -- listado por sucursal + orden por nombre; cubre la FK
CREATE INDEX IF NOT EXISTS "riders_name_idx" ON "app"."riders" ("name_key", "id");                         -- listado global (admin) ordenado por nombre
CREATE INDEX IF NOT EXISTS "riders_branch_assignable_idx" ON "app"."riders" ("branch_id")
    WHERE "active" AND "availability" = 'AVAILABLE';                                                         -- candidatos de F28 y filtro availability=AVAILABLE
-- NO se indexa `phone` aparte (el UNIQUE ya lo hace) ni created_at/updated_at (volumen: decenas de filas).

-- ------------------------------------------------------------------------------------------------
-- 2) Trigger de guarda (patrón 0018/0019; relanzable por CREATE OR REPLACE)
-- ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "app"."riders_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.allow_order_cleanup', true) = 'on' THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'app.riders no admite DELETE: se desactiva' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'INSERT' OR NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
        IF NOT EXISTS (SELECT 1 FROM app.branches b WHERE b.id = NEW.branch_id AND b.active) THEN
            RAISE EXCEPTION 'app.riders: la sucursal debe existir y estar activa' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'app.riders: id y created_at son inmutables' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
            RAISE EXCEPTION 'app.riders: todo UPDATE debe subir version en 1' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END; $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'riders_guard' AND tgrelid = 'app.riders'::regclass) THEN
        CREATE TRIGGER "riders_guard" BEFORE INSERT OR UPDATE OR DELETE ON "app"."riders"
            FOR EACH ROW EXECUTE FUNCTION "app"."riders_guard"();
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 3) Comentarios
-- ------------------------------------------------------------------------------------------------
COMMENT ON TABLE "app"."riders" IS 'F27. Motorista propio: una persona = una fila (UNIQUE phone). active ≠ availability; BUSY es derivado (F28). Sin DELETE.';
COMMENT ON COLUMN "app"."riders"."name_key" IS 'Añadida sobre el DBML. Nombre sin acentos, minúsculas y espacios colapsados; la API la calcula (orden y búsqueda).';
COMMENT ON COLUMN "app"."riders"."availability" IS 'Añadida sobre el DBML. AVAILABLE | UNAVAILABLE manual; un inactivo es siempre UNAVAILABLE. BUSY no se guarda (derivado de F28).';
COMMENT ON COLUMN "app"."riders"."version" IS 'Añadida sobre el DBML. Concurrencia optimista; el trigger exige OLD.version + 1 en todo UPDATE.';

-- ------------------------------------------------------------------------------------------------
-- 4) Privilegios: igual que 0018/0019 (RLS sin políticas + REVOKE a PUBLIC/anon/authenticated, incl. la función). Solo vía API.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "app"."riders" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "app"."riders" FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."riders_guard"() FROM PUBLIC;

DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            EXECUTE format('REVOKE ALL ON "app"."riders" FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON FUNCTION "app"."riders_guard"() FROM %I', v_role);
        END IF;
    END LOOP;
END $$;
