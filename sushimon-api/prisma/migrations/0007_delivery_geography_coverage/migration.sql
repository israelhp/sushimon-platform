-- F09: geografía, zonas de entrega propias y configuración logística por sucursal
-- (specs/008-delivery-zones-coverage, ADR-0012, D4/D5/D7/D9/D11).
-- Incremental y NO destructiva: solo CREATE (4 tablas, índices, RLS) e INSERT de seed. No toca datos ni tablas
-- existentes (customer_addresses es de F05; RBAC de 0005 y audit_events quedan intactos).
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real.
-- NO es relanzable el DDL (CREATE TABLE/INDEX sin IF NOT EXISTS); Prisma la aplica una vez y, si falla, revierte el
-- lote. El SEED sí es idempotente (ON CONFLICT DO NOTHING).
-- Reversión manual (solo sin datos que conservar; sin dependientes hasta F05): eliminar las tablas
-- app.branch_delivery_settings, app.delivery_zones, app.municipalities y app.departments (en ese orden).
-- Línea base: docs/references/monsushi_dbdiagram.dbml (departments, municipalities, delivery_zones). El DBML no se
-- edita; las columnas nuevas (zone_key, version, created_at, updated_at) y branch_delivery_settings se justifican en ADR-0012.

-- ------------------------------------------------------------------------------------------------
-- 1) Catálogos geográficos (DBML tal cual). Cambian solo por migración; la API los expone en solo lectura.
-- ------------------------------------------------------------------------------------------------
CREATE TABLE "app"."departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "departments_name_valid" CHECK (btrim("name") <> '' AND "name" = btrim("name"))
);
CREATE UNIQUE INDEX "departments_name_key" ON "app"."departments"("name");

CREATE TABLE "app"."municipalities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "department_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "municipalities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "municipalities_name_valid" CHECK (btrim("name") <> '' AND "name" = btrim("name"))
);
-- El UNIQUE (department_id, name) también sirve la FK y la consulta «municipios de un departamento».
CREATE UNIQUE INDEX "municipalities_department_id_name_key" ON "app"."municipalities"("department_id", "name");
ALTER TABLE "app"."municipalities"
    ADD CONSTRAINT "municipalities_department_id_fkey" FOREIGN KEY ("department_id")
    REFERENCES "app"."departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------------------------------------
-- 2) app.delivery_zones: zonas de entrega PROPIAS por sucursal.
--    - zone_label NULL = cobertura general del municipio; zone_key (calculada por la API, D6) = etiqueta sin
--      acentos y en minúsculas, '' para NULL. Así el UNIQUE no tiene hueco de NULL (D7): a lo sumo una cobertura
--      general por (sucursal, municipio). La BD solo valida coherencia (no hay unaccent inmutable).
--    - Sin borrado físico (solo `active`); version/updated_at los mantiene la API en el UPDATE (sin triggers).
--    - base_fee: numeric(12,2), 0..99999.99 (tope técnico anti-error de captura; 0 = envío gratis).
--    - ON DELETE RESTRICT en ambas FK: la configuración no se borra en cascada.
-- ------------------------------------------------------------------------------------------------
CREATE TABLE "app"."delivery_zones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "municipality_id" UUID NOT NULL,
    "zone_label" TEXT,
    "zone_key" TEXT NOT NULL DEFAULT '',
    "base_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_zones_base_fee_range" CHECK ("base_fee" >= 0 AND "base_fee" <= 99999.99),
    CONSTRAINT "delivery_zones_version_positive" CHECK ("version" >= 1),
    CONSTRAINT "delivery_zones_label_key_coherent" CHECK (
        ("zone_label" IS NULL AND "zone_key" = '') OR ("zone_label" IS NOT NULL AND "zone_key" <> '')
    ),
    CONSTRAINT "delivery_zones_label_valid" CHECK (
        "zone_label" IS NULL
        OR ("zone_label" = btrim("zone_label") AND char_length("zone_label") BETWEEN 1 AND 60)
    ),
    CONSTRAINT "delivery_zones_key_normalized" CHECK (
        "zone_key" = lower("zone_key") AND "zone_key" = btrim("zone_key") AND "zone_key" !~ '\s{2,}'
    ),
    CONSTRAINT "delivery_zones_branch_municipality_zone_key"
        UNIQUE ("branch_id", "municipality_id", "zone_key")
);

ALTER TABLE "app"."delivery_zones"
    ADD CONSTRAINT "delivery_zones_branch_id_fkey" FOREIGN KEY ("branch_id")
    REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."delivery_zones"
    ADD CONSTRAINT "delivery_zones_municipality_id_fkey" FOREIGN KEY ("municipality_id")
    REFERENCES "app"."municipalities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Índices: el UNIQUE (branch_id, municipality_id, zone_key) cubre la consulta de cobertura (clave completa,
-- `zone_key IN (clave, '')`), el listado por sucursal (prefijo) y la FK de branch_id. Solo se añade el índice de la
-- FK municipality_id (filtro `municipalityId` y comprobación RESTRICT); sin índice trigram (q filtra dentro de un
-- conjunto acotado por sucursal).
CREATE INDEX "delivery_zones_municipality_idx" ON "app"."delivery_zones"("municipality_id");

-- ------------------------------------------------------------------------------------------------
-- 3) app.branch_delivery_settings: 1:1 con branches. Fila ausente = defaults de la API (sin backfill, D4);
--    los DEFAULT de columna coinciden con esa constante. El primer PATCH hace upsert por branch_id.
-- ------------------------------------------------------------------------------------------------
CREATE TABLE "app"."branch_delivery_settings" (
    "branch_id" UUID NOT NULL,
    "own_delivery_zones_enabled" BOOLEAN NOT NULL DEFAULT false,
    "pedidosya_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "branch_delivery_settings_pkey" PRIMARY KEY ("branch_id")
);
ALTER TABLE "app"."branch_delivery_settings"
    ADD CONSTRAINT "branch_delivery_settings_branch_id_fkey" FOREIGN KEY ("branch_id")
    REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------------------------------------
-- 4) Privilegios: igual que 0006 (RLS sin políticas + REVOKE guardado por existencia de rol).
--    Acceso solo vía API. Ver 0006 para la justificación y las verificaciones manuales pendientes en Supabase.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "app"."departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."municipalities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."delivery_zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."branch_delivery_settings" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "app"."departments", "app"."municipalities", "app"."delivery_zones",
    "app"."branch_delivery_settings" FROM PUBLIC;

DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            EXECUTE format(
                'REVOKE ALL ON "app"."departments", "app"."municipalities", "app"."delivery_zones", "app"."branch_delivery_settings" FROM %I',
                v_role
            );
        END IF;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 5) Seed (D9), idempotente. Sin id fijos: los UUID los genera cada entorno; los municipios se enlazan por nombre.
--    - 22 departamentos de Guatemala.
--    - 17 municipios del departamento de Guatemala (lista aportada por el negocio; cotejar con INE antes de
--      producción). PENDIENTE: municipios de los otros 21 departamentos (fuente oficial verificada por una persona).
-- ------------------------------------------------------------------------------------------------
INSERT INTO "app"."departments" ("name") VALUES
    ('Alta Verapaz'), ('Baja Verapaz'), ('Chimaltenango'), ('Chiquimula'), ('El Progreso'), ('Escuintla'),
    ('Guatemala'), ('Huehuetenango'), ('Izabal'), ('Jalapa'), ('Jutiapa'), ('Petén'), ('Quetzaltenango'),
    ('Quiché'), ('Retalhuleu'), ('Sacatepéquez'), ('San Marcos'), ('Santa Rosa'), ('Sololá'),
    ('Suchitepéquez'), ('Totonicapán'), ('Zacapa')
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "app"."municipalities" ("department_id", "name")
SELECT d."id", m."name"
FROM "app"."departments" d
CROSS JOIN (VALUES
    ('Guatemala'), ('Santa Catarina Pinula'), ('San José Pinula'), ('San José del Golfo'), ('Palencia'),
    ('Chinautla'), ('San Pedro Ayampuc'), ('Mixco'), ('San Pedro Sacatepéquez'), ('San Juan Sacatepéquez'),
    ('San Raymundo'), ('Chuarrancho'), ('Fraijanes'), ('Amatitlán'), ('Villa Nueva'), ('Villa Canales'),
    ('San Miguel Petapa')
) AS m("name")
WHERE d."name" = 'Guatemala'
ON CONFLICT ("department_id", "name") DO NOTHING;
