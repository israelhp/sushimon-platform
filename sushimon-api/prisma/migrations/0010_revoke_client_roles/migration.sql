-- 0010 · Revocar privilegios de clientes Data API (hallazgo M6 de la auditoría F00-F09).
-- Las migraciones 0002, 0003 y 0005 activaron RLS (sin políticas) en branches, customers, staff_users, roles,
-- permissions, role_permissions, staff_assignments y audit_events, pero NO emitieron REVOKE; 0006-0009 sí. En Supabase
-- los privilegios por defecto sobre tablas nuevas pueden dar acceso a anon/authenticated, y RLS sin políticas es la única
-- barrera. Esta migración añade la defensa en profundidad que faltaba. Ya cubiertas por 0006/0007/0008/0009
-- (no se repiten): branch_hours, branch_closures, departments, municipalities, delivery_zones, branch_delivery_settings,
-- customer_addresses, customer_favorites.
--
-- No destructiva e idempotente (REVOKE es relanzable): no toca datos, esquema ni RLS. No hay secuencias en el esquema
-- `app` (ids uuid); el REVOKE sobre secuencias es defensivo y no afecta a nada hoy.
-- La conexión de la API (rol propietario/BYPASSRLS) no se ve afectada. Reversión manual (no recomendada):
-- GRANT <privilegios> ON <tabla> TO anon, authenticated;
-- Cada REVOKE a anon/authenticated está guardado por existencia del rol (PostgreSQL plano no los tiene).

REVOKE ALL ON "app"."branches", "app"."customers", "app"."staff_users", "app"."roles", "app"."permissions",
    "app"."role_permissions", "app"."staff_assignments", "app"."audit_events" FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "app" FROM PUBLIC;

DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            EXECUTE format(
                'REVOKE ALL ON "app"."branches", "app"."customers", "app"."staff_users", "app"."roles", "app"."permissions", "app"."role_permissions", "app"."staff_assignments", "app"."audit_events" FROM %I',
                v_role
            );
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA "app" FROM %I', v_role);
        END IF;
    END LOOP;
END $$;
