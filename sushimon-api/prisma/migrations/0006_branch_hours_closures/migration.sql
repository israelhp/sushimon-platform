-- F08: horarios semanales y cierres temporales de sucursal (specs/007-branch-hours-closures, D1/D3/D4/D5/D7/D8).
-- Incremental y NO destructiva: solo CREATE (extensión btree_gist, 2 tablas, índice, RLS). No toca datos ni
-- tablas existentes (el permiso `branches.manage_hours` y los roles de 0005 quedan intactos).
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real (extensión + EXCLUDE).
-- NO es relanzable (CREATE TABLE/INDEX sin IF NOT EXISTS); Prisma la aplica una vez y, si falla, revierte el lote.
-- Reversión manual (solo sin datos que conservar): eliminar app.branch_closures y app.branch_hours. La extensión
-- btree_gist se deja instalada (inocua; otras migraciones podrían usarla).
-- Línea base: docs/references/monsushi_dbdiagram.dbml (app.branch_hours, app.branch_closures).

-- ------------------------------------------------------------------------------------------------
-- 0) Extensión btree_gist: necesaria para combinar igualdad (uuid, smallint) y rangos en un EXCLUDE gist.
--    En Supabase se instala en el esquema `extensions` (si existe) para no ensuciar `public`; en PostgreSQL
--    plano (CI/desarrollo) se instala en el esquema por defecto. IF NOT EXISTS: no falla si ya está.
--    Las clases de operadores por defecto se resuelven por tipo (no dependen del search_path).
-- ------------------------------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'extensions') THEN
        CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
    ELSE
        CREATE EXTENSION IF NOT EXISTS btree_gist;
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 1) app.branch_hours: intervalos de atención por sucursal y día ISO (1=lunes ... 7=domingo; NUNCA getDay()).
--    - Intervalo semiabierto [opens_at, closes_at). `closes_at` admite '24:00:00' (PostgreSQL `time` lo acepta
--      y conserva; es el único modo de expresar «hasta medianoche» sin cruzar de día, D3/D4).
--      `opens_at` no puede ser 24:00 (CHECK opens_at < closes_at y 24:00 es el máximo).
--    - Medianoche (D4, estrategia B): un turno nocturno se guarda partido en dos días; no hay closes <= opens.
--    - TIME(0): precisión de segundos; el CHECK exige minutos exactos (la API solo maneja HH:mm).
--    - Sin zona horaria por sucursal: son horas de pared de America/Guatemala (UTC-6 sin DST); el cálculo
--      de «abierto ahora» lo hace la API (se reevaluará si hay sucursales en otra zona).
--    - PK (branch_id, weekday, opens_at) como en el DBML.
--    - ON DELETE RESTRICT: la sucursal no se borra (se desactiva, F07 D6); el horario es configuración.
-- ------------------------------------------------------------------------------------------------
CREATE TABLE "app"."branch_hours" (
    "branch_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "opens_at" TIME(0) NOT NULL,
    "closes_at" TIME(0) NOT NULL,
    CONSTRAINT "branch_hours_pkey" PRIMARY KEY ("branch_id", "weekday", "opens_at"),
    CONSTRAINT "branch_hours_weekday_iso" CHECK ("weekday" BETWEEN 1 AND 7),
    CONSTRAINT "branch_hours_opens_before_closes" CHECK ("opens_at" < "closes_at"),
    CONSTRAINT "branch_hours_minute_granularity" CHECK (
        EXTRACT(SECOND FROM "opens_at") = 0 AND EXTRACT(SECOND FROM "closes_at") = 0
    ),
    -- No solapamiento dentro de (sucursal, día). Los intervalos contiguos (11:00-15:00 + 15:00-21:00) SÍ se
    -- permiten porque el rango es semiabierto. Se proyecta el tiempo sobre una fecha fija (2000-01-01) porque
    -- PostgreSQL no tiene `timerange`; date + '24:00' = 2000-01-02 00:00, así que 24:00 es representable.
    -- Rige también para UPDATE. El índice gist subyacente sirve las lecturas por (branch_id, weekday).
    CONSTRAINT "branch_hours_no_overlap" EXCLUDE USING gist (
        "branch_id" WITH =,
        "weekday" WITH =,
        tsrange(DATE '2000-01-01' + "opens_at", DATE '2000-01-01' + "closes_at", '[)') WITH &&
    )
);

ALTER TABLE "app"."branch_hours"
    ADD CONSTRAINT "branch_hours_branch_id_fkey" FOREIGN KEY ("branch_id")
    REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sin índices adicionales: la PK (branch_id, weekday, opens_at) sirve «horario de una sucursal ordenado»,
-- «un día de una sucursal» y la FK; la lectura pública de todas las sucursales (3-5) es un scan trivial.

-- ------------------------------------------------------------------------------------------------
-- 2) app.branch_closures: cierres temporales [starts_at, ends_at) en instantes absolutos (timestamptz).
--    - Historial: ON DELETE RESTRICT (nunca cascada). Sin cancelled_at (D8: no se inventan columnas).
--    - reason opcional, interno (nunca público): no vacío tras trim y <= 200 caracteres.
--    - EXCLUDE: dos cierres de la misma sucursal no se solapan (D7); contiguos sí. La API además bloquea la
--      fila de la sucursal para dar un 409 CLOSURE_OVERLAP legible; esta es la red de seguridad.
-- ------------------------------------------------------------------------------------------------
CREATE TABLE "app"."branch_closures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    CONSTRAINT "branch_closures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "branch_closures_ends_after_starts" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "branch_closures_reason_valid" CHECK (
        "reason" IS NULL OR (btrim("reason") <> '' AND char_length("reason") <= 200)
    ),
    CONSTRAINT "branch_closures_no_overlap" EXCLUDE USING gist (
        "branch_id" WITH =,
        tstzrange("starts_at", "ends_at", '[)') WITH &&
    )
);

ALTER TABLE "app"."branch_closures"
    ADD CONSTRAINT "branch_closures_branch_id_fkey" FOREIGN KEY ("branch_id")
    REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Índice btree (branch_id, starts_at, ends_at). Sirve las consultas reales:
--   a) listado por sucursal ordenado por fecha: WHERE branch_id = $1 ORDER BY starts_at [DESC];
--   b) cierre vigente: WHERE branch_id = $1 AND starts_at <= $t AND ends_at > $t, y «próximo cierre»:
--      WHERE branch_id = $1 AND ends_at > $t ORDER BY starts_at LIMIT n (ends_at en el índice filtra sin
--      ir a la tabla);
--   c) la FK ON DELETE RESTRICT / ON UPDATE CASCADE (el gist del EXCLUDE no es eficiente para igualdad pura).
-- El índice gist del EXCLUDE ya sirve el chequeo de solapamiento; no se crea otro para eso.
CREATE INDEX "branch_closures_branch_starts_idx" ON "app"."branch_closures"("branch_id", "starts_at", "ends_at");

-- ------------------------------------------------------------------------------------------------
-- 3) Privilegios: igual que 0002/0003. Acceso solo vía API (rol de servicio de la conexión Prisma);
--    RLS sin políticas deniega todo a anon/authenticated si algún día se expone PostgREST.
--    DECISIÓN NUEVA respecto a 0002/0003/0005 (que solo activan RLS y no emiten REVOKE): defensa en
--    profundidad con REVOKE explícito, porque en Supabase los privilegios por defecto sobre tablas nuevas
--    pueden dejar a anon/authenticated con permisos y RLS sería la única barrera.
--    Solo se revoca a anon/authenticated (y PUBLIC, que normalmente no tiene nada); no se tocan los privilegios
--    del propietario ni de service_role/postgres. En PostgreSQL plano (CI) esos roles no existen: se omite.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "app"."branch_hours" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."branch_closures" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "app"."branch_hours", "app"."branch_closures" FROM PUBLIC;

DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            EXECUTE format('REVOKE ALL ON "app"."branch_hours", "app"."branch_closures" FROM %I', v_role);
        END IF;
    END LOOP;
END $$;
