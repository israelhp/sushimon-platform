-- F05: direcciones guardadas del cliente (specs/009-customer-addresses, ADR-0013 · ADR-0014).
-- Incremental y NO destructiva: solo CREATE (1 tabla, índices, RLS). No toca tablas existentes.
-- PROPUESTA: requiere revisión humana antes de aplicarse a una base real.
-- NO relanzable (CREATE TABLE/INDEX sin IF NOT EXISTS). Reversión manual (sin datos que conservar):
-- DROP TABLE app.customer_addresses;
-- Línea base: docs/references/monsushi_dbdiagram.dbml (customer_addresses). Columnas y restricciones añadidas:
-- CHECKs de longitud/rango, FK con ON DELETE CASCADE desde customers (la cuenta borra sus direcciones) y RESTRICT
-- desde municipalities (un municipio con direcciones no se puede borrar), y el índice único parcial de predeterminada.

-- ------------------------------------------------------------------------------------------------
-- 1) Tabla (DBML tal cual + restricciones de dominio). `label` es texto libre (no enum): ver ADR-0014.
-- ------------------------------------------------------------------------------------------------
CREATE TABLE "app"."customer_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "municipality_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "zone" TEXT,
    "address_line" TEXT NOT NULL,
    "reference_note" TEXT,
    "latitude" NUMERIC(10,7),
    "longitude" NUMERIC(10,7),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id")
        REFERENCES "app"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "customer_addresses_municipality_id_fkey" FOREIGN KEY ("municipality_id")
        REFERENCES "app"."municipalities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_addresses_label_valid" CHECK (
        btrim("label") <> '' AND char_length("label") <= 40 AND "label" = btrim("label")
    ),
    CONSTRAINT "customer_addresses_address_line_valid" CHECK (
        btrim("address_line") <> '' AND char_length("address_line") <= 200
    ),
    CONSTRAINT "customer_addresses_reference_valid" CHECK (
        "reference_note" IS NULL OR char_length("reference_note") <= 200
    ),
    CONSTRAINT "customer_addresses_zone_valid" CHECK (
        "zone" IS NULL OR (btrim("zone") <> '' AND char_length("zone") <= 60)
    ),
    CONSTRAINT "customer_addresses_coordinates_pair" CHECK (
        ("latitude" IS NULL) = ("longitude" IS NULL)
    ),
    CONSTRAINT "customer_addresses_latitude_range" CHECK (
        "latitude" IS NULL OR "latitude" BETWEEN -90 AND 90
    ),
    CONSTRAINT "customer_addresses_longitude_range" CHECK (
        "longitude" IS NULL OR "longitude" BETWEEN -180 AND 180
    )
);

-- ------------------------------------------------------------------------------------------------
-- 2) Índices.
--    - (customer_id, created_at, id): sirve el listado propio (filtro + orden) sin ordenar en memoria; su prefijo
--      customer_id cubre también las búsquedas por cliente (no hay un índice (customer_id) suelto redundante).
--    - (municipality_id): consultas inversas y comprobación de borrado de municipios.
--    - Único parcial: como máximo UNA predeterminada por cliente, aunque haya solicitudes concurrentes.
-- ------------------------------------------------------------------------------------------------
CREATE INDEX "customer_addresses_customer_created_idx"
    ON "app"."customer_addresses" ("customer_id", "created_at", "id");
CREATE INDEX "customer_addresses_municipality_id_idx"
    ON "app"."customer_addresses" ("municipality_id");
CREATE UNIQUE INDEX "customer_addresses_one_default_key"
    ON "app"."customer_addresses" ("customer_id") WHERE "is_default" = true;

-- ------------------------------------------------------------------------------------------------
-- 3) Privilegios: igual que 0006/0007 (RLS sin políticas + REVOKE guardado por existencia de rol).
--    Acceso solo vía API (rol de servicio con bypass de RLS). Las direcciones son PII: nunca expuestas a anon.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "app"."customer_addresses" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "app"."customer_addresses" FROM PUBLIC;

DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            EXECUTE format('REVOKE ALL ON "app"."customer_addresses" FROM %I', v_role);
        END IF;
    END LOOP;
END $$;
