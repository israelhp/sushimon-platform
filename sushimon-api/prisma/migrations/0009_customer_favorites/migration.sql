-- F06: favoritos de clientes (specs/009-customer-favorites, ADR-0014, D3/D10).
-- Incremental y NO destructiva: solo CREATE (1 tabla, 1 índice, RLS). No toca datos ni tablas existentes.
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real.
-- NO es relanzable (CREATE sin IF NOT EXISTS); Prisma la aplica una vez y, si falla, revierte el lote.
-- Reversión manual (sin dependientes): eliminar la tabla app.customer_favorites.
-- Línea base: docs/references/monsushi_dbdiagram.dbml (customer_favorites). El DBML no se edita; la columna
-- created_at, el índice de listado y el aplazamiento de la FK a products se justifican en ADR-0014.
--
-- SIN FK a products: app.products no existe todavía (F10/F11). El API solo persiste un product_id tras validarlo con el
-- puerto de catálogo, así que hasta F11 la tabla permanece vacía en entornos reales.
-- F11 añadirá, tras comprobar huérfanos:
--   ALTER TABLE "app"."customer_favorites" ADD CONSTRAINT "customer_favorites_product_id_fkey"
--     FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE CASCADE NOT VALID;
--   ALTER TABLE "app"."customer_favorites" VALIDATE CONSTRAINT "customer_favorites_product_id_fkey";
--   CREATE INDEX "customer_favorites_product_idx" ON "app"."customer_favorites"("product_id");
-- El tope de 200 favoritos por cliente NO es un CHECK: lo aplica la API en una transacción (D10).

CREATE TABLE "app"."customer_favorites" (
    "customer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "customer_favorites_pkey" PRIMARY KEY ("customer_id", "product_id")
);

ALTER TABLE "app"."customer_favorites"
    ADD CONSTRAINT "customer_favorites_customer_id_fkey" FOREIGN KEY ("customer_id")
    REFERENCES "app"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Listado paginado (created_at DESC, product_id ASC) y getFavoriteProductIds. El PK sirve a ON CONFLICT y DELETE.
CREATE INDEX "customer_favorites_customer_created_idx"
    ON "app"."customer_favorites"("customer_id", "created_at" DESC, "product_id");

-- Privilegios: igual que 0006/0007 (RLS sin políticas + REVOKE guardado por existencia de rol). Acceso solo vía API.
ALTER TABLE "app"."customer_favorites" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "app"."customer_favorites" FROM PUBLIC;

DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            EXECUTE format('REVOKE ALL ON "app"."customer_favorites" FROM %I', v_role);
        END IF;
    END LOOP;
END $$;
