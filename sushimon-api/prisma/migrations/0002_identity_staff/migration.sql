-- F01: identidad (customers, staff_users, roles, permisos, asignaciones por sucursal) y sucursales mínimas.
-- Línea base: docs/references/monsushi_dbdiagram.dbml. Desviación documentada en ADR-0009:
-- app.staff_users.auth_user_id es NULLABLE (empleado preregistrado que aún no inicia sesión).

CREATE TABLE "app"."branches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id" UUID,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customers_full_name_not_blank" CHECK (btrim("full_name") <> '')
);

CREATE TABLE "app"."staff_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id" UUID,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_users_email_lowercase" CHECK ("email" = lower("email")),
    CONSTRAINT "staff_users_full_name_not_blank" CHECK (btrim("full_name") <> '')
);

CREATE TABLE "app"."roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE "app"."staff_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "branch_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branches_code_key" ON "app"."branches"("code");
CREATE UNIQUE INDEX "customers_auth_user_id_key" ON "app"."customers"("auth_user_id");
CREATE UNIQUE INDEX "staff_users_auth_user_id_key" ON "app"."staff_users"("auth_user_id");
CREATE UNIQUE INDEX "staff_users_email_key" ON "app"."staff_users"("email");
CREATE UNIQUE INDEX "roles_code_key" ON "app"."roles"("code");
CREATE UNIQUE INDEX "permissions_code_key" ON "app"."permissions"("code");
CREATE UNIQUE INDEX "staff_assignments_staff_id_role_id_branch_id_key"
    ON "app"."staff_assignments"("staff_id", "role_id", "branch_id");
-- UNIQUE no cubre NULL: sin este índice parcial se duplicaría la asignación "todas las sucursales".
CREATE UNIQUE INDEX "staff_assignments_all_branches_key"
    ON "app"."staff_assignments"("staff_id", "role_id") WHERE "branch_id" IS NULL;
CREATE INDEX "staff_assignments_staff_active_idx"
    ON "app"."staff_assignments"("staff_id") WHERE "active";
CREATE INDEX "customers_email_idx" ON "app"."customers"(lower("email"));

ALTER TABLE "app"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id")
    REFERENCES "app"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id")
    REFERENCES "app"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app"."staff_assignments"
    ADD CONSTRAINT "staff_assignments_staff_id_fkey" FOREIGN KEY ("staff_id")
    REFERENCES "app"."staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app"."staff_assignments"
    ADD CONSTRAINT "staff_assignments_role_id_fkey" FOREIGN KEY ("role_id")
    REFERENCES "app"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."staff_assignments"
    ADD CONSTRAINT "staff_assignments_branch_id_fkey" FOREIGN KEY ("branch_id")
    REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK hacia Supabase Auth, solo si el esquema `auth` existe (Supabase real/local). En un PostgreSQL
-- plano (CI) las pruebas crean un `auth.users` mínimo antes de migrar.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    ALTER TABLE "app"."customers"
      ADD CONSTRAINT "customers_auth_user_id_fkey" FOREIGN KEY ("auth_user_id")
      REFERENCES auth.users(id) ON DELETE SET NULL;
    -- Un empleado no pierde su vínculo si se borra la cuenta de Auth sin revisión explícita.
    ALTER TABLE "app"."staff_users"
      ADD CONSTRAINT "staff_users_auth_user_id_fkey" FOREIGN KEY ("auth_user_id")
      REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Defensa en profundidad: el acceso a datos pasa SOLO por la API (rol de servicio de la conexión Prisma).
-- RLS activado sin políticas = denegar todo a `anon`/`authenticated` si algún día se expone PostgREST.
ALTER TABLE "app"."branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."staff_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."staff_assignments" ENABLE ROW LEVEL SECURITY;

-- Datos de referencia: roles y permisos del backoffice (espejo de ROLE_PERMISSIONS del prototipo).
INSERT INTO "app"."roles" ("code", "name") VALUES
  ('admin', 'Administrador'), ('manager', 'Encargado'), ('kitchen', 'Cocina')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "app"."permissions" ("code", "description") VALUES
  ('dashboard', 'Ver el panel'),
  ('orders.accept', 'Aceptar o rechazar pedidos'),
  ('orders.status', 'Cambiar el estado de pedidos'),
  ('orders.dispatch', 'Despachar pedidos a domicilio'),
  ('products.edit', 'Editar productos'),
  ('products.availability', 'Cambiar disponibilidad de productos'),
  ('promotions', 'Gestionar promociones'),
  ('branches', 'Gestionar sucursales'),
  ('users', 'Gestionar usuarios internos'),
  ('reports', 'Ver reportes')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "app"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM (VALUES
  ('admin','dashboard'),('admin','orders.accept'),('admin','orders.status'),('admin','orders.dispatch'),
  ('admin','products.edit'),('admin','products.availability'),('admin','promotions'),('admin','branches'),
  ('admin','users'),('admin','reports'),
  ('manager','dashboard'),('manager','orders.accept'),('manager','orders.status'),('manager','orders.dispatch'),
  ('manager','products.availability'),('manager','reports'),
  ('kitchen','orders.accept'),('kitchen','orders.status')
) AS m(role_code, perm_code)
JOIN "app"."roles" r ON r."code" = m.role_code
JOIN "app"."permissions" p ON p."code" = m.perm_code
ON CONFLICT DO NOTHING;
