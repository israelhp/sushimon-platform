-- F07: gestión de sucursales. Incremental y NO destructiva (spec 005, D7/D10).
-- Línea base: docs/references/monsushi_dbdiagram.dbml (app.branches, app.audit_events).
-- Reversión manual (solo si no hay datos que conservar): eliminar la tabla app.audit_events y quitar
-- los índices, CHECK y columnas añadidos aquí a app.branches.

-- 1) Columnas nuevas de app.branches. `address` entra con DEFAULT '' para filas preexistentes y luego
--    se retira el DEFAULT: toda fila nueva debe informar su dirección (DBML: NOT NULL sin default).
ALTER TABLE "app"."branches"
    ADD COLUMN "address" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "latitude" NUMERIC(10,7),
    ADD COLUMN "longitude" NUMERIC(10,7),
    ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();
ALTER TABLE "app"."branches" ALTER COLUMN "address" DROP DEFAULT;

-- 2) CHECK. Los que podrían violar filas de F01 (code libre, address '') se crean NOT VALID: rigen
--    para INSERT/UPDATE nuevos y no escanean/rechazan datos previos. Validar después de sanear con
--    ALTER TABLE app.branches VALIDATE CONSTRAINT <nombre>;
ALTER TABLE "app"."branches"
    ADD CONSTRAINT "branches_code_format" CHECK (
        "code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("code") BETWEEN 2 AND 40
    ) NOT VALID,
    ADD CONSTRAINT "branches_name_not_blank" CHECK (btrim("name") <> '') NOT VALID,
    ADD CONSTRAINT "branches_address_not_blank" CHECK (btrim("address") <> '') NOT VALID,
    ADD CONSTRAINT "branches_latitude_range" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
    ADD CONSTRAINT "branches_longitude_range" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180),
    ADD CONSTRAINT "branches_coordinates_pair" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));

-- 3) Índices de branches (3-5 filas: el costo es despreciable; solo los que sostienen consultas reales).
--    - Listado público: solo sucursales activas, ordenadas por nombre (parcial: excluye inactivas).
--    - Admin: ordenar/buscar por nombre sin distinguir mayúsculas. `code` ya tiene UNIQUE (slug exacto).
--    Con tan pocas filas el planner puede preferir seq scan; los índices documentan la intención.
CREATE INDEX "branches_active_name_idx" ON "app"."branches"("name", "code") WHERE "active";
CREATE INDEX "branches_name_lower_idx" ON "app"."branches"(lower("name"));

-- 4) Auditoría (DBML app.audit_events). F36 la ampliará.
--    actor_id SIN FK: es el id interno de staff_users (o NULL = sistema), pero el historial inmutable
--    no debe bloquear ni perderse si se elimina/anonimiza un empleado; se conserva como dato histórico.
--    branch_id FK RESTRICT: no se puede borrar una sucursal con historial (se desactiva, D6).
--    entity_id sin FK: es polimórfico (entity_type decide la tabla).
CREATE TABLE "app"."audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "branch_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "old_values" JSONB,
    "new_values" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_events_entity_type_not_blank" CHECK (btrim("entity_type") <> ''),
    CONSTRAINT "audit_events_action_not_blank" CHECK (btrim("action") <> '')
);

ALTER TABLE "app"."audit_events"
    ADD CONSTRAINT "audit_events_branch_id_fkey" FOREIGN KEY ("branch_id")
    REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "audit_events_entity_idx"
    ON "app"."audit_events"("entity_type", "entity_id", "created_at" DESC);
CREATE INDEX "audit_events_branch_created_idx"
    ON "app"."audit_events"("branch_id", "created_at" DESC);

-- Igual que el resto: acceso solo vía API; RLS sin políticas deniega a anon/authenticated.
ALTER TABLE "app"."audit_events" ENABLE ROW LEVEL SECURITY;
