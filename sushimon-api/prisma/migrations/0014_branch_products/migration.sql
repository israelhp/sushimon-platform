-- 0014 · F13 precio y disponibilidad por sucursal. Línea base: DBML `app.branch_products`.
-- Incremental y NO destructiva: solo CREATE (tabla, índice, RLS). No borra ni modifica datos. Relanzable
-- (IF NOT EXISTS / guardas por catálogo). Requiere 0003 (branches) y 0012 (products) aplicadas.
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real.
-- El DBML NO se edita; desviaciones respecto a él: columnas created_at/updated_at añadidas (updated_at lo mantiene la
-- API en el UPDATE, sin trigger, como 0007/0011/0012/0013); CHECK de rango de price_override; FKs con acción explícita
-- ON DELETE RESTRICT (el DBML no la indica: NO ACTION).
-- Reversión manual: DROP TABLE app.branch_products (índice, PK y FKs caen con ella). Solo si no hay datos que conservar;
-- si F20 (pedidos) ya consume esta tabla, no se referencia por FK (los pedidos guardan snapshot de precio).
--
-- Semántica:
-- * AUSENCIA DE FILA = producto disponible al precio base (app.products.base_price) en esa sucursal. Es el estado por
--   defecto: no hace falta sembrar una fila por (sucursal, producto) y los productos nuevos nacen disponibles en todas.
-- * La API elimina la fila cuando vuelve al estado por defecto (price_override NULL y available = true), de modo que la
--   tabla solo contiene excepciones. NO hay trigger de "fila por defecto": lo gestiona la API.
-- * price_override NULL = usa el precio base; con valor, 0 < precio <= 999999.99 (mismo tope práctico que el resto de
--   importes en GTQ; numeric(12,2) admitiría más). El CHECK acepta NULL explícitamente.
-- * available = false oculta el producto en esa sucursal. NO hay stock numérico (fuera de alcance: constitución/DBML).
-- * No sustituye products.active: un producto inactivo no se vende en ninguna sucursal, con o sin fila aquí.
--
-- Índices (decisión):
-- * La PK (branch_id, product_id) sirve toda consulta por sucursal (listado de excepciones de una sucursal, lookup de
--   un producto en una sucursal) y el FK branch_id (RESTRICT al borrar sucursal): NO se crea índice aparte.
-- * (product_id): necesario porque la PK no tiene product_id como columna líder; sirve al FK (el DELETE sobre products
--   con RESTRICT, y el ON UPDATE CASCADE, evitarían un seq scan) y a "en qué sucursales tiene excepción este producto".
-- * (branch_id, available) NO se crea: con 3-5 sucursales y la tabla acotada a excepciones (hasta ~5 x catálogo, cientos
--   de filas) el planificador no lo preferiría sobre la PK y solo encarecería escrituras. Reevaluar si la tabla crece
--   por órdenes de magnitud o aparece un filtro frecuente por available sin sucursal.

CREATE TABLE IF NOT EXISTS "app"."branch_products" (
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "price_override" DECIMAL(12,2),
    "available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "branch_products_pkey" PRIMARY KEY ("branch_id", "product_id"),
    CONSTRAINT "branch_products_branch_id_fkey" FOREIGN KEY ("branch_id")
        REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "branch_products_product_id_fkey" FOREIGN KEY ("product_id")
        REFERENCES "app"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "branch_products_price_override_chk" CHECK (
        "price_override" IS NULL OR ("price_override" > 0 AND "price_override" <= 999999.99))
);

CREATE INDEX IF NOT EXISTS "branch_products_product_idx" ON "app"."branch_products" ("product_id");

-- Privilegios: igual que 0006/0009/0011/0012/0013 (RLS sin políticas + REVOKE guardado por existencia de rol). Solo vía API.
ALTER TABLE "app"."branch_products" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "app"."branch_products" FROM PUBLIC;

DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            EXECUTE format('REVOKE ALL ON "app"."branch_products" FROM %I', v_role);
        END IF;
    END LOOP;
END $$;
