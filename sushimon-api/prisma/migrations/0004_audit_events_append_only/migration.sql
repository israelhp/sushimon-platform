-- F07 (revisión de seguridad M3): app.audit_events es SOLO-AÑADIR. Incremental; no edita la 0003.
-- Un trigger de fila rechaza UPDATE y DELETE para que un bug o una cuenta de aplicación no reescriban ni
-- borren el historial. Limitación: no frena a un superusuario/propietario que desactive el trigger; para eso
-- hacen falta roles con permisos mínimos (F36). TRUNCATE no se cubre aquí.
-- Excepción controlada: un DELETE se permite solo si la transacción habilitó
-- `SET LOCAL app.allow_audit_cleanup = 'on'` (lo usa únicamente la limpieza de pruebas; la API nunca lo hace).
-- Reversión: DROP TRIGGER audit_events_append_only ON app.audit_events;
--            DROP FUNCTION app.audit_events_append_only();

CREATE FUNCTION "app"."audit_events_append_only"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_audit_cleanup', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'app.audit_events es solo-añadir (% rechazado)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_events_append_only"
    BEFORE UPDATE OR DELETE ON "app"."audit_events"
    FOR EACH ROW EXECUTE FUNCTION "app"."audit_events_append_only"();
