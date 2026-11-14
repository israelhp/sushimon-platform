-- F03 (ADR-0010, specs/006-staff-rbac-management): RBAC con permisos granulares y gestión de empleados.
-- PROPUESTA: NO aplicar a ninguna base real sin aprobación humana explícita (esta migración BORRA filas de
-- app.permissions: 9 de los 10 permisos gruesos sembrados en 0002 (`orders.accept` se conserva: está en el catálogo nuevo); no hay DROP de tablas ni de columnas).
--
-- Atomicidad: Prisma ejecuta el archivo como un único lote; cualquier RAISE (precondiciones y verificaciones
-- finales) revierte TODO el lote, incluidas las columnas nuevas. No se usa BEGIN/COMMIT explícito.
-- Orden de aplicación: 0005 debe aplicarse ANTES de desplegar la API de F03 y antes de ejecutar staff:bootstrap
-- (el rol admin debe contener ya los permisos nuevos). Incompatible con la API anterior (F01/F07): esta consulta
-- permisos gruesos ('branches', 'users', ...), que dejan de existir -> desplegar migración y API juntas.
-- NO es relanzable: ADD COLUMN, CREATE FUNCTION, CREATE TRIGGER y CREATE INDEX fallan la segunda vez (Prisma la aplica
-- una sola vez y, si falla, revierte todo el lote). Solo el remapeo de permisos es inocuo si se repitiera
-- (INSERT ... ON CONFLICT DO NOTHING y, sin permisos gruesos, el JOIN no produce filas); no hay modo seguro de
-- reaplicar el archivo completo sobre una base ya migrada.
-- Reversión manual (solo sin datos nuevos que conservar): reinsertar los 9 códigos gruesos retirados de 0002 (orders.accept se conserva), remapear
-- role_permissions a la inversa, DROP TRIGGER staff_assignments_admin_global_guard / FUNCTION, quitar índices,
-- CHECK y columnas añadidos aquí y borrar el rol `staff` (si no tiene asignaciones). audit_events no se toca.

-- ------------------------------------------------------------------------------------------------
-- 0) Precondición sobre datos de acceso existentes: NO se corrigen en silencio.
--    Impacto: si hay filas que violan la regla «alcance global (branch_id NULL) <=> rol admin», la migración
--    aborta con un mensaje y el operador decide qué hacer (cambiar rol o sucursal) antes de reintentar.
--    Se evalúan TODAS las filas (activas e inactivas). Solo se reporta el recuento, sin datos personales.
-- ------------------------------------------------------------------------------------------------
DO $$
DECLARE
    v_global_no_admin integer;
    v_admin_scoped integer;
BEGIN
    SELECT count(*) INTO v_global_no_admin
    FROM "app"."staff_assignments" sa
    JOIN "app"."roles" r ON r."id" = sa."role_id"
    WHERE sa."branch_id" IS NULL AND r."code" <> 'admin';

    SELECT count(*) INTO v_admin_scoped
    FROM "app"."staff_assignments" sa
    JOIN "app"."roles" r ON r."id" = sa."role_id"
    WHERE sa."branch_id" IS NOT NULL AND r."code" = 'admin';

    IF v_global_no_admin > 0 OR v_admin_scoped > 0 THEN
        RAISE EXCEPTION
            '0005 abortada: % asignacion(es) con branch_id NULL y rol distinto de admin; % asignacion(es) admin con sucursal. Corregir manualmente (ADR-0010 d.3) y reintentar.',
            v_global_no_admin, v_admin_scoped
            USING ERRCODE = 'check_violation';
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 1) Columnas nuevas
--    roles.is_system: existentes quedan en false; solo `admin` se marca true (inmutable por API).
--    staff_users.created_at: las filas existentes reciben now() de la migración (fecha real desconocida).
--    staff_users.linked_at: NULL aunque la fila ya esté vinculada (no se inventa el dato).
--    staff_users.created_by: NULL = proceso manual/anterior a F03; ON DELETE SET NULL conserva al empleado creado.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "app"."roles" ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "app"."staff_users"
    ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    ADD COLUMN "linked_at" TIMESTAMPTZ(6),
    ADD COLUMN "created_by" UUID;

ALTER TABLE "app"."staff_users"
    ADD CONSTRAINT "staff_users_created_by_fkey" FOREIGN KEY ("created_by")
    REFERENCES "app"."staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Todas las filas existentes tienen linked_at NULL, así que el CHECK se valida sin rechazar datos previos.
ALTER TABLE "app"."staff_users"
    ADD CONSTRAINT "staff_users_linked_at_requires_auth" CHECK ("auth_user_id" IS NOT NULL OR "linked_at" IS NULL);

UPDATE "app"."roles" SET "is_system" = true WHERE "code" = 'admin';

-- ------------------------------------------------------------------------------------------------
-- 2) Rol nuevo `staff` (Empleado). Sus permisos se asignan en el paso 5.
-- ------------------------------------------------------------------------------------------------
INSERT INTO "app"."roles" ("code", "name", "is_system") VALUES ('staff', 'Empleado', false)
ON CONFLICT ("code") DO NOTHING;

-- ------------------------------------------------------------------------------------------------
-- 3) Catálogo granular de 43 permisos `modulo.accion`. Los de módulos aún inexistentes (pagos, incidencias,
--    auditoría, ajustes) se siembran para poder asignarlos; no habilitan nada hasta que exista el módulo.
-- ------------------------------------------------------------------------------------------------
INSERT INTO "app"."permissions" ("code", "description") VALUES
  ('dashboard.read', 'Ver el panel'),
  ('branches.read', 'Ver sucursales'),
  ('branches.create', 'Crear sucursales'),
  ('branches.update', 'Editar y activar o desactivar sucursales'),
  ('branches.manage_hours', 'Gestionar horarios de sucursales'),
  ('branches.manage_delivery_zones', 'Gestionar zonas de entrega de sucursales'),
  ('staff.read', 'Ver empleados'),
  ('staff.create', 'Preautorizar empleados'),
  ('staff.update', 'Editar datos de empleados'),
  ('staff.disable', 'Activar o desactivar empleados'),
  ('staff.assign_roles', 'Asignar roles y sucursales a empleados'),
  ('roles.read', 'Ver roles y permisos'),
  ('roles.manage', 'Editar los permisos de un rol'),
  ('catalog.read', 'Ver el catálogo'),
  ('catalog.create', 'Crear productos y categorías'),
  ('catalog.update', 'Editar productos y categorías'),
  ('catalog.manage_availability', 'Cambiar la disponibilidad de productos'),
  ('promotions.read', 'Ver promociones'),
  ('promotions.create', 'Crear promociones'),
  ('promotions.update', 'Editar promociones'),
  ('orders.read', 'Ver pedidos'),
  ('orders.accept', 'Aceptar pedidos'),
  ('orders.reject', 'Rechazar pedidos'),
  ('orders.prepare', 'Marcar pedidos en preparación'),
  ('orders.complete', 'Completar pedidos'),
  ('orders.cancel', 'Cancelar pedidos'),
  ('payments.read', 'Ver pagos'),
  ('payments.confirm', 'Confirmar pagos'),
  ('payments.refund', 'Reembolsar pagos'),
  ('riders.read', 'Ver repartidores'),
  ('riders.create', 'Crear repartidores'),
  ('riders.update', 'Editar repartidores'),
  ('riders.assign', 'Asignar repartidores'),
  ('deliveries.read', 'Ver entregas'),
  ('deliveries.assign', 'Asignar entregas'),
  ('deliveries.update', 'Actualizar entregas'),
  ('incidents.read', 'Ver incidencias'),
  ('incidents.manage', 'Gestionar incidencias'),
  ('reports.read', 'Ver reportes'),
  ('reports.export', 'Exportar reportes'),
  ('audit.read', 'Consultar la auditoría'),
  ('settings.read', 'Ver ajustes'),
  ('settings.update', 'Editar ajustes')
ON CONFLICT ("code") DO NOTHING;
-- `orders.accept` ya existía (0002, «aceptar o rechazar»): misma fila, ahora solo «aceptar» (rechazar = orders.reject).
UPDATE "app"."permissions" SET "description" = 'Aceptar pedidos' WHERE "code" = 'orders.accept';

-- ------------------------------------------------------------------------------------------------
-- 4) Remapeo de role_permissions: gruesos -> granulares (ADR-0010 d.1). Se parte de las asignaciones REALES
--    existentes, de modo que las ediciones manuales previas se conservan. Idempotente (ON CONFLICT DO NOTHING;
--    si los gruesos ya no existen, el JOIN no produce filas).
-- ------------------------------------------------------------------------------------------------
CREATE TEMPORARY TABLE "_rbac_0005_map" ("old_code" TEXT NOT NULL, "new_code" TEXT NOT NULL);
INSERT INTO "_rbac_0005_map" ("old_code", "new_code") VALUES
  ('dashboard','dashboard.read'),
  ('orders.accept','orders.read'), ('orders.accept','orders.accept'), ('orders.accept','orders.reject'),
  ('orders.status','orders.read'), ('orders.status','orders.prepare'), ('orders.status','orders.complete'),
  ('orders.dispatch','deliveries.read'), ('orders.dispatch','deliveries.assign'), ('orders.dispatch','deliveries.update'),
  ('orders.dispatch','riders.read'), ('orders.dispatch','riders.assign'),
  ('products.edit','catalog.read'), ('products.edit','catalog.create'), ('products.edit','catalog.update'),
  ('products.availability','catalog.read'), ('products.availability','catalog.manage_availability'),
  ('promotions','promotions.read'), ('promotions','promotions.create'), ('promotions','promotions.update'),
  ('branches','branches.read'), ('branches','branches.create'), ('branches','branches.update'),
  ('branches','branches.manage_hours'), ('branches','branches.manage_delivery_zones'),
  ('users','staff.read'), ('users','staff.create'), ('users','staff.update'), ('users','staff.disable'),
  ('users','staff.assign_roles'), ('users','roles.read'), ('users','roles.manage'),
  ('reports','reports.read');

INSERT INTO "app"."role_permissions" ("role_id", "permission_id")
SELECT rp."role_id", pn."id"
FROM "app"."role_permissions" rp
JOIN "app"."permissions" po ON po."id" = rp."permission_id"
JOIN "_rbac_0005_map" m ON m."old_code" = po."code"
JOIN "app"."permissions" pn ON pn."code" = m."new_code"
ON CONFLICT DO NOTHING;

-- Verificación de completitud del remapeo. Debe ejecutarse ANTES de las adiciones del paso 5: el rol nuevo `staff`
-- recibe `orders.accept` (código que también existía como grueso) sin `orders.reject`, y eso NO es un remapeo
-- incompleto. Cada (rol, grueso) existente debe tener TODOS sus destinos; si no, se aborta en vez de perder permisos.
DO $$
DECLARE
    v_missing integer;
BEGIN
    SELECT count(*) INTO v_missing
    FROM "app"."role_permissions" rp
    JOIN "app"."permissions" po ON po."id" = rp."permission_id"
    JOIN "_rbac_0005_map" m ON m."old_code" = po."code"
    LEFT JOIN "app"."permissions" pn ON pn."code" = m."new_code"
    LEFT JOIN "app"."role_permissions" rn ON rn."role_id" = rp."role_id" AND rn."permission_id" = pn."id"
    WHERE rn."role_id" IS NULL;
    IF v_missing > 0 THEN
        RAISE EXCEPTION '0005 abortada: remapeo de permisos incompleto (% pares rol/permiso sin destino)', v_missing
            USING ERRCODE = 'data_exception';
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 5) Adiciones explicitas (ADR-0010 d.1; las de `manager` estan POR CONFIRMAR con negocio).
--    admin  = catálogo completo; manager += orders.cancel, branches.read, roles.read, staff.*(sin roles.manage);
--    staff  = orders.read/accept/prepare, deliveries.read; kitchen ya queda equivalente por el remapeo.
-- ------------------------------------------------------------------------------------------------
INSERT INTO "app"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "app"."roles" r CROSS JOIN "app"."permissions" p
WHERE r."code" = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO "app"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM (VALUES
  ('manager','orders.cancel'), ('manager','branches.read'), ('manager','roles.read'),
  ('manager','staff.read'), ('manager','staff.create'), ('manager','staff.update'),
  ('manager','staff.disable'), ('manager','staff.assign_roles'),
  ('staff','orders.read'), ('staff','orders.accept'), ('staff','orders.prepare'), ('staff','deliveries.read')
) AS a(role_code, perm_code)
JOIN "app"."roles" r ON r."code" = a.role_code
JOIN "app"."permissions" p ON p."code" = a.perm_code
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------------------------
-- 6) Retiro de los permisos gruesos (9 filas; DELETE de datos de referencia; ON DELETE CASCADE limpia
--    role_permissions). La completitud del remapeo ya se verificó (tras el paso 4, antes de las adiciones).
-- ------------------------------------------------------------------------------------------------
DO $$
DECLARE
    v_admin_missing integer;
    v_left integer;
BEGIN
    -- Se retiran solo los gruesos que NO pertenecen al catálogo nuevo: `orders.accept` existe en ambos (misma fila,
    -- se conserva y se actualiza su descripción); por eso se borran 9 filas y no 10.
    DELETE FROM "app"."permissions"
    WHERE "code" IN (SELECT DISTINCT "old_code" FROM "_rbac_0005_map"
                     WHERE "old_code" NOT IN (SELECT "new_code" FROM "_rbac_0005_map"));

    SELECT count(*) INTO v_left FROM "app"."permissions"
    WHERE "code" IN (SELECT DISTINCT "old_code" FROM "_rbac_0005_map"
                     WHERE "old_code" NOT IN (SELECT "new_code" FROM "_rbac_0005_map"));
    IF v_left > 0 THEN
        RAISE EXCEPTION '0005 abortada: quedan % permisos gruesos tras el retiro', v_left
            USING ERRCODE = 'data_exception';
    END IF;

    -- admin debe contener TODO el catálogo (invariante que cada migración futura debe mantener).
    SELECT count(*) INTO v_admin_missing
    FROM "app"."permissions" p
    WHERE NOT EXISTS (
        SELECT 1 FROM "app"."role_permissions" rp
        JOIN "app"."roles" r ON r."id" = rp."role_id"
        WHERE r."code" = 'admin' AND rp."permission_id" = p."id"
    );
    IF v_admin_missing > 0 THEN
        RAISE EXCEPTION '0005 abortada: admin no contiene % permiso(s) del catalogo', v_admin_missing
            USING ERRCODE = 'data_exception';
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------
-- 7) Invariante «branch_id NULL (alcance global) <=> rol admin» (ADR-0010 d.3). Un CHECK no puede mirar
--    otra tabla, de ahí el trigger. Solo dispara al insertar o al cambiar rol/sucursal. Limitación: si alguien
--    renombra roles.code el trigger lo evaluaría con el código nuevo (la API no edita roles.code).
--    El UNIQUE parcial de 0002 ya evita duplicar la asignación global del mismo (staff, rol).
-- ------------------------------------------------------------------------------------------------
CREATE FUNCTION "app"."staff_assignments_admin_global_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
    v_code text;
BEGIN
    SELECT "code" INTO v_code FROM "app"."roles" WHERE "id" = NEW."role_id";
    IF NEW."branch_id" IS NULL AND v_code IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'alcance global (branch_id NULL) solo para el rol admin'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."branch_id" IS NOT NULL AND v_code = 'admin' THEN
        RAISE EXCEPTION 'el rol admin solo puede tener alcance global (branch_id NULL)'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "staff_assignments_admin_global_guard"
    BEFORE INSERT OR UPDATE OF "role_id", "branch_id" ON "app"."staff_assignments"
    FOR EACH ROW EXECUTE FUNCTION "app"."staff_assignments_admin_global_guard"();

-- ------------------------------------------------------------------------------------------------
-- 8) Índices para listado/filtros. Volumen actual: decenas de filas, así que son baratos y preventivos.
--    - staff_assignments(branch_id) WHERE active: filtro por sucursal y cálculo de alcance.
--    - role_permissions(permission_id): la PK (role_id, permission_id) no sirve para «roles con este permiso».
--    - lower(full_name): orden/búsqueda por nombre sin distinguir mayúsculas. La búsqueda `contains` (ILIKE
--      '%q%') no usa btree; con este volumen basta un scan; pg_trgm se evalúa si el personal crece (no se
--      instala aquí: sería una extensión nueva en Supabase). El correo ya tiene UNIQUE (staff_users_email_key).
--    - created_by: evita scan secuencial en el ON DELETE SET NULL del FK autorreferenciado.
--    - created_at: orden por defecto del listado.
-- ------------------------------------------------------------------------------------------------
CREATE INDEX "staff_assignments_branch_active_idx" ON "app"."staff_assignments"("branch_id") WHERE "active";
CREATE INDEX "role_permissions_permission_id_idx" ON "app"."role_permissions"("permission_id");
CREATE INDEX "staff_users_full_name_lower_idx" ON "app"."staff_users"(lower("full_name"));
CREATE INDEX "staff_users_created_by_idx" ON "app"."staff_users"("created_by");
CREATE INDEX "staff_users_created_at_idx" ON "app"."staff_users"("created_at" DESC);

-- audit_events (0003/0004): esta migración no la toca. El trigger append-only sigue activo; los eventos
-- staff.* se INSERTAN desde la API. La FK created_by apunta a staff_users, no a audit_events.

-- Limpieza de la tabla temporal del remapeo.
DROP TABLE "_rbac_0005_map";
