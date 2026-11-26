-- 0024 · Pedidos SOLO A DOMICILIO e INMEDIATOS (decisión del dueño: se retiran «Recoger en sucursal» y «Programar pedido»).
-- Incremental y NO destructiva: NO borra ni modifica filas, NO borra columnas, tablas, triggers ni restricciones. Solo (1) añade
-- UNA restricción CHECK sobre app.orders y (2) actualiza comentarios de columnas. Desviación DOCUMENTADA respecto del DBML
-- (docs/references/monsushi_dbdiagram.dbml, línea base inmutable, sigue admitiendo PICKUP): se registra en docs/database/README.md.
-- Relanzable: guarda por catálogo (pg_constraint); si orders_delivery_only_chk ya existe NO se recrea ni se cambia su corte.
-- Requiere 0018 (app.orders y orders_fulfillment_chk). Falla con mensaje claro si falta.
-- PROPUESTA: requiere aprobación humana antes de aplicarse a una base real. Aplicarla DESPUÉS de desplegar la API que ya no
-- crea pedidos PICKUP ni lee scheduled_for (si la API anterior sigue viva, sus INSERT PICKUP fallan con 23514 desde la aplicación).
-- Reversión manual (sin pérdida de datos, mientras no se haya ejecutado la 0025):
--   ALTER TABLE app.orders DROP CONSTRAINT orders_delivery_only_chk;
--
-- Decisiones:
-- * orders.fulfillment_type se CONSERVA (lo usan los triggers de F28/0022 —entrega propia solo para DELIVERY—, la dirección
--   obligatoria de DELIVERY, los reportes y el histórico). orders_fulfillment_chk (IN ('PICKUP','DELIVERY')) NO se toca: los pedidos
--   PICKUP ya registrados son registros legales/históricos y deben seguir siendo válidos.
-- * orders_delivery_only_chk:  CHECK (fulfillment_type = 'DELIVERY' OR placed_at < <corte>)
--   - <corte> es un LITERAL timestamptz fijado AL APLICAR la migración (clock_timestamp() tomado con la tabla bloqueada en
--     SHARE ROW EXCLUSIVE, que bloquea escrituras concurrentes pero no lecturas). placed_at es TIMESTAMPTZ(6) NOT NULL DEFAULT now()
--     (0018) y es inmutable (trigger orders_immutable_fields), así que: toda fila existente tiene placed_at <= corte y la valida;
--     ningún INSERT posterior puede ser PICKUP salvo que fije a mano un placed_at anterior al corte (los INSERT de la API usan el
--     DEFAULT now(); un cliente con rol de BD podría falsear la fecha, pero la API no expone placed_at y los roles anon/authenticated
--     no tienen acceso a app.orders).
--   - NO se usa NOT VALID: una restricción NOT VALID también se evalúa en los UPDATE de filas que no la cumplieran y bloquearía
--     cambiar el estado/cancelar los PICKUP en curso. Con el corte literal todas las filas existentes cumplen, así que la restricción
--     se valida completa sin riesgo y los UPDATE de los PICKUP históricos (status, cancelación, updated_at) siguen permitidos
--     (placed_at es inmutable, por lo que su condición no cambia nunca).
--   - Zona/precisión: el corte se escribe con %L de un timestamptz en la TimeZone de la sesión, con microsegundos y desplazamiento
--     explícito (p. ej. '2026-11-26 10:15:00.123456-06'): es un instante absoluto, no depende de la zona de quien lo lea después.
--   - Si hubiera filas PICKUP con placed_at >= corte (fecha futura/manual), la migración aborta ANTES de añadir la restricción con un
--     mensaje que cuenta cuántas son (no modifica nada); corregirlas a mano o revisar con el equipo.
--   - Violación: SQLSTATE 23514 (check_violation) con CONSTRAINT = 'orders_delivery_only_chk' (el nombre viaja en el error de
--     PostgreSQL; la API puede clasificar por él).
--   - El corte queda registrado en COMMENT ON CONSTRAINT y se puede leer con
--       SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'orders_delivery_only_chk';
-- * Se CONSERVAN sin cambios: orders_fulfillment_chk, orders_provider_chk, orders_provider_coherent_chk (PICKUP histórico:
--   delivery_provider NULL y delivery_fee = 0; DELIVERY: proveedor obligatorio), el trigger orders_immutable_fields, los
--   triggers/constraint triggers de dirección (DELIVERY exige order_addresses; PICKUP la prohíbe), el estado picked_up,
--   payments.collection_context, deliveries*, branch_hours y branch_closures.
-- * orders.scheduled_for NO se elimina aquí: la API desplegada antes de este cambio podría seguir leyéndola. Solo se marca OBSOLETA
--   con COMMENT. Ninguna restricción, índice, vista ni trigger la usa (revisado: solo aparece en la lista de columnas esperadas de la
--   guarda de la 0018). Retirada = 0025 (borrador abajo), SOLO después de desplegar la API sin leerla.
-- * Impacto: sin bloqueo prolongado (ADD CONSTRAINT valida con un barrido de app.orders, ~100 pedidos/día); sin reescritura de tabla;
--   sin índices nuevos (no hay consulta que filtre por esta restricción).
--
-- BORRADOR 0025_drop_scheduled_for (SOLO TEXTO; NO es una migración del repo; requiere aprobación humana y la API desplegada sin
-- leer orders.scheduled_for ni el campo de Prisma; revisar también la guarda de columnas esperadas de 0018, que fallaría si la 0018
-- se relanzara sobre una base ya migrada):
--   DO $$
--   DECLARE v_n bigint;
--   BEGIN
--       IF EXISTS (SELECT 1 FROM information_schema.columns
--                   WHERE table_schema = 'app' AND table_name = 'orders' AND column_name = 'scheduled_for') THEN
--           EXECUTE 'SELECT count(*) FROM app.orders WHERE scheduled_for IS NOT NULL' INTO v_n;
--           IF v_n > 0 THEN
--               RAISE EXCEPTION '0025: % pedidos tienen scheduled_for; no se elimina la columna (datos históricos).', v_n;
--           END IF;
--           ALTER TABLE app.orders DROP COLUMN scheduled_for;
--       END IF;
--   END $$;

-- ------------------------------------------------------------------------------------------------
-- 0) Guarda: 0018 debe estar aplicada.
-- ------------------------------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('app.orders') IS NULL THEN
        RAISE EXCEPTION '0024: falta app.orders; aplicar antes 0018_orders.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
         WHERE conrelid = 'app.orders'::regclass AND conname = 'orders_fulfillment_chk'
    ) THEN
        RAISE EXCEPTION '0024: app.orders no tiene orders_fulfillment_chk; definicion ajena, revisar a mano.';
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 1) orders_delivery_only_chk con corte literal fijado al aplicar. Relanzable: si existe, no se toca.
-- ------------------------------------------------------------------------------------------------
DO $$
DECLARE
    v_cutoff timestamptz;
    v_bad bigint;
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
         WHERE conrelid = 'app.orders'::regclass AND conname = 'orders_delivery_only_chk'
    ) THEN
        RETURN;
    END IF;

    -- Bloquea escrituras concurrentes (no lecturas) hasta el COMMIT: ningún pedido PICKUP nuevo puede colarse entre el corte
    -- y la restricción.
    LOCK TABLE "app"."orders" IN SHARE ROW EXCLUSIVE MODE;
    v_cutoff := clock_timestamp();

    SELECT count(*) INTO v_bad
      FROM "app"."orders"
     WHERE "fulfillment_type" <> 'DELIVERY' AND "placed_at" >= v_cutoff;
    IF v_bad > 0 THEN
        RAISE EXCEPTION '0024: % pedidos no DELIVERY con placed_at >= corte (%); corregir a mano antes de aplicar.', v_bad, v_cutoff;
    END IF;

    EXECUTE format(
        'ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_delivery_only_chk" CHECK ("fulfillment_type" = ''DELIVERY'' OR "placed_at" < %L)',
        v_cutoff
    );
    EXECUTE format(
        'COMMENT ON CONSTRAINT "orders_delivery_only_chk" ON "app"."orders" IS %L',
        format('0024: pedidos solo a domicilio. Los PICKUP son históricos: placed_at < %s (corte fijado al aplicar la migración). Un INSERT PICKUP nuevo falla con 23514.', v_cutoff)
    );
END $$;

-- ------------------------------------------------------------------------------------------------
-- 2) Comentarios (idempotentes): modalidad única, proveedor y columna obsoleta.
-- ------------------------------------------------------------------------------------------------
COMMENT ON COLUMN "app"."orders"."fulfillment_type" IS 'PICKUP | DELIVERY (orders_fulfillment_chk). Desde 0024 solo DELIVERY para pedidos nuevos (orders_delivery_only_chk); PICKUP = histórico anterior al corte.';
COMMENT ON COLUMN "app"."orders"."delivery_provider" IS 'Añadida sobre el DBML. OWN | PEDIDOSYA; NULL solo en pedidos PICKUP históricos (los pedidos nuevos son DELIVERY y lo exigen).';
COMMENT ON COLUMN "app"."orders"."scheduled_for" IS 'OBSOLETA desde 0024: los pedidos son inmediatos (no se programan). La API ya no la escribe ni la lee; se eliminará en 0025 tras desplegar la API sin ella.';
