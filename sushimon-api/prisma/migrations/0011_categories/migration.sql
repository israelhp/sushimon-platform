-- 0011 · F10 categorías de menú con jerarquía (padre/hijo, hasta 3 niveles). Línea base: DBML `app.categories`.
-- Incremental y NO destructiva: solo CREATE (tabla, índice, función, trigger, RLS). No toca datos ni tablas existentes.
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real. Relanzable (IF NOT EXISTS / OR REPLACE /
-- trigger guardado por catálogo); sin borrados. El DBML NO se edita: la desviación (created_at, updated_at, CHECK de slug/
-- nombre/longitudes/sort_order, FK ON DELETE RESTRICT explícita, trigger de jerarquía) se justifica en el ADR de F10.
-- Reversión manual (sin dependientes todavía; products/F11 añadirá FK a categories): eliminar, en este orden, el
-- trigger categories_hierarchy_trg, la función app.categories_enforce_hierarchy() y la tabla app.categories.
--
-- ---------------------------------------------------------------------------------------------------------------
-- CONSTANTE DE BLOQUEO DE JERARQUÍA (la API DEBE reutilizarla):  SELECT pg_advisory_xact_lock(1100110);
--   (bigint, forma de una clave; 1100110 = "F10 / 0011 / 0"). Un único bloqueo transaccional global para todas las
--   escrituras que cambian parent_id (alta con padre y reparentado); se libera solo al COMMIT/ROLLBACK.
-- ---------------------------------------------------------------------------------------------------------------
-- Concurrencia: dos reparentados simultáneos (A bajo B y B bajo A) validan cada uno contra un snapshot donde el otro
-- aún no existe; sin serialización ambos pasarían y formarían un ciclo. El trigger toma el bloqueo ANTES de recorrer
-- los ancestros; en READ COMMITTED (por defecto de PostgreSQL y Prisma) cada consulta interna del trigger ve lo
-- confirmado por la transacción que tenía el bloqueo, así que la segunda detecta el ciclo. En REPEATABLE READ/SERIALIZABLE
-- el snapshot es previo al bloqueo y no basta: el servicio debe usar READ COMMITTED y, además, tomar el MISMO bloqueo
-- al inicio de su transacción (antes de leer para validar), de modo que la validación de la API también esté serializada.
-- El coste (escrituras de categorías serializadas globalmente) es irrelevante: tabla pequeña, escrituras de backoffice raras.
-- Reglas: ciclo => ERRCODE 23514, mensaje 'categories_parent_cycle'; profundidad total (ancestros + nodo + altura del
-- subárbol) > 3 => ERRCODE 23514, mensaje 'categories_max_depth'. Raíz = nivel 1.

CREATE TABLE IF NOT EXISTS "app"."categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_id" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    -- created_at/updated_at no están en el DBML; updated_at lo mantiene la API en el UPDATE (sin trigger, como 0007).
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "categories_slug_key" UNIQUE ("slug"),
    CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id")
        REFERENCES "app"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "categories_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") <= 80),
    CONSTRAINT "categories_name_len_chk" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
    CONSTRAINT "categories_description_len_chk" CHECK ("description" IS NULL OR length("description") <= 500),
    CONSTRAINT "categories_sort_order_chk" CHECK ("sort_order" >= 0),
    CONSTRAINT "categories_not_own_parent_chk" CHECK ("parent_id" IS DISTINCT FROM "id")
);

-- Listado estable de hermanos (parent_id NULL = raíces, btree indexa NULL) y soporte del FK RESTRICT. El slug ya está
-- cubierto por la restricción UNIQUE.
CREATE INDEX IF NOT EXISTS "categories_parent_sort_idx"
    ON "app"."categories"("parent_id", "sort_order", "name", "id");

CREATE OR REPLACE FUNCTION "app"."categories_enforce_hierarchy"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_ancestors int;
    v_cycle boolean;
    v_below int;
BEGIN
    -- Sin padre, o padre sin cambio: no puede haber ciclo ni exceso de profundidad nuevo.
    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN
        RETURN NEW;
    END IF;

    -- Serializa todo cambio de jerarquía (ver constante en el encabezado). Debe ir ANTES de leer ancestros.
    PERFORM pg_advisory_xact_lock(1100110);

    -- Ancestros del nuevo padre (incluido él), con tope de iteraciones por si ya hubiera datos corruptos.
    WITH RECURSIVE anc(id, parent_id, lvl) AS (
        SELECT c.id, c.parent_id, 1 FROM "app"."categories" c WHERE c.id = NEW.parent_id
        UNION ALL
        SELECT c.id, c.parent_id, a.lvl + 1
          FROM "app"."categories" c JOIN anc a ON c.id = a.parent_id
         WHERE a.lvl < 10
    )
    SELECT count(*)::int, coalesce(bool_or(id = NEW.id), false) INTO v_ancestors, v_cycle FROM anc;

    IF v_cycle THEN
        RAISE EXCEPTION 'categories_parent_cycle' USING ERRCODE = '23514';
    END IF;
    IF v_ancestors >= 10 THEN
        RAISE EXCEPTION 'categories_max_depth' USING ERRCODE = '23514';
    END IF;

    -- Altura del subárbol que cuelga del nodo (0 si es hoja o alta nueva).
    IF TG_OP = 'UPDATE' THEN
        WITH RECURSIVE sub(id, lvl) AS (
            SELECT c.id, 1 FROM "app"."categories" c WHERE c.parent_id = NEW.id
            UNION ALL
            SELECT c.id, s.lvl + 1 FROM "app"."categories" c JOIN sub s ON c.parent_id = s.id WHERE s.lvl < 10
        )
        SELECT coalesce(max(lvl), 0) INTO v_below FROM sub;
    ELSE
        v_below := 0;
    END IF;

    IF v_ancestors + 1 + v_below > 3 THEN
        RAISE EXCEPTION 'categories_max_depth' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
         WHERE tgname = 'categories_hierarchy_trg' AND tgrelid = '"app"."categories"'::regclass
    ) THEN
        CREATE TRIGGER "categories_hierarchy_trg"
            BEFORE INSERT OR UPDATE OF "parent_id" ON "app"."categories"
            FOR EACH ROW EXECUTE FUNCTION "app"."categories_enforce_hierarchy"();
    END IF;
END $$;

-- Privilegios: igual que 0006/0009 (RLS sin políticas + REVOKE guardado por existencia de rol). Acceso solo vía API.
ALTER TABLE "app"."categories" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "app"."categories" FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."categories_enforce_hierarchy"() FROM PUBLIC;

DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            EXECUTE format('REVOKE ALL ON "app"."categories" FROM %I', v_role);
            EXECUTE format('REVOKE ALL ON FUNCTION "app"."categories_enforce_hierarchy"() FROM %I', v_role);
        END IF;
    END LOOP;
END $$;
