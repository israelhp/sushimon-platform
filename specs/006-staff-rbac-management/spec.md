# F03 — Gestión de empleados y RBAC granular

**Rama**: `feature/F03-staff-rbac-management` (apilada sobre F07/F02/F01 según el estado de `develop`)
**Prioridad**: P0 · **Dependencias**: F00, F01, F02, F07 · **Estado**: `CONTRACT_DEFINED` (spec, ADR-0010 y OpenAPI listos; API,
migración 0005 y web **pendientes**; la web sigue en `MOCK_ONLY` para usuarios/roles)
**Decisión de arquitectura**: `docs/adr/0010-rbac-permisos-granulares.md` (reutiliza ADR-0009).

## Alcance

Gestión de empleados internos (`staff_users`), sus asignaciones rol+sucursal (`staff_assignments`), consulta de roles y
edición de los permisos de un rol, y la autorización centralizada con permisos granulares y alcance por sucursal.
Fuera: roles personalizados (crear/borrar), recuperación de MFA (`auth.admin.mfa.deleteFactor`, requiere service-role:
decisión aparte), cambio de correo de identidad vinculada, expiración de preautorizaciones, consulta/exportación de
auditoría (F36), módulos que consumen los permisos nuevos (catálogo, pedidos, pagos... los usan cuando existan).

## Historias

- **US1** Como administrador preautorizo a un empleado (correo, rol, sucursal); al iniciar sesión con Google queda
  vinculado y ve solo lo suyo.
- **US2** Como encargado gestiono (alta, edición, desactivación, asignaciones) al personal de mis sucursales, sin poder
  otorgar más de lo que yo tengo ni tocar a quien opera fuera de mi alcance.
- **US3** Como administrador consulto el catálogo de permisos y ajusto lo que puede hacer cada rol (salvo `admin`).
- **US4** Como administrador desactivo a un empleado y pierde el acceso en su siguiente solicitud; el sistema nunca queda sin
  administrador.
- **US5** Como auditor interno veo quién cambió qué (eventos en `audit_events`).

## Catálogo de permisos (43) y matriz

Módulos y acciones: `dashboard.read` · `branches.{read,create,update,manage_hours,manage_delivery_zones}` ·
`staff.{read,create,update,disable,assign_roles}` · `roles.{read,manage}` · `catalog.{read,create,update,manage_availability}` ·
`promotions.{read,create,update}` · `orders.{read,accept,reject,prepare,complete,cancel}` · `payments.{read,confirm,refund}` ·
`riders.{read,create,update,assign}` · `deliveries.{read,assign,update}` · `incidents.{read,manage}` ·
`reports.{read,export}` · `audit.read` · `settings.{read,update}`. Los permisos de módulos aún inexistentes (pagos, incidencias,
auditoría, ajustes) se siembran ya para que los roles los referencien; no habilitan nada hasta que el módulo exista.

| Rol (`code`)             | Permisos                                                                                                                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin` (sistema)        | Los 43 (solo lectura; debe contener el catálogo completo). Solo alcance global.                                                                                                                                                                                  |
| `manager` "Encargado"    | `dashboard.read`, `branches.read`, `orders.read/accept/reject/prepare/complete/cancel`, `deliveries.read/assign/update`, `riders.read/assign`, `catalog.read/manage_availability`, `reports.read`, `roles.read`, `staff.read/create/update/disable/assign_roles` |
| `kitchen` "Cocina"       | `orders.read/accept/reject/prepare/complete`                                                                                                                                                                                                                     |
| `staff` "Empleado" nuevo | `orders.read/accept/prepare`, `deliveries.read`                                                                                                                                                                                                                  |

Mapeo desde los 10 gruesos (9 se retiran; `orders.accept` se conserva) y adiciones: ver ADR-0010 (decisión 1). Las adiciones a `manager` (`staff.*`, `branches.read`,
`roles.read`, `orders.cancel`) están **por confirmar con negocio**. Sin superadmin oculto.

## Requisitos funcionales

**Identidad / preautorización**

- **FR-001** `POST /v1/admin/staff` crea `staff_users` con `auth_user_id` NULL + asignaciones (≥1) en una transacción.
  Correo normalizado a minúsculas; `authUserId` no existe en ninguna entrada (400 por `forbidNonWhitelisted`).
- **FR-002** `identityStatus` = `PENDING_LINK | LINKED` derivado de `auth_user_id`; independiente de `active`. Ninguna respuesta
  expone `authUserId`; el detalle da `identityStatus` y `linkedAt`.
- **FR-003** El vínculo sigue siendo el `UPDATE` atómico de ADR-0009 y ahora, en la MISMA transacción, fija `linked_at` y escribe
  `staff.linked` (`actor` = el propio empleado; `newValues {identityStatus:'LINKED'}`, sin correo ni `auth_user_id`).
- **FR-004** Sin `auth.admin.createUser`, sin correos, sin creación automática de personal.

**Gestión**

- **FR-005** `GET /v1/admin/staff`: `q` (nombre/correo, ≤100, comodines escapados), `branchId` (asignación a esa sucursal exacta),
  `roleId`, `active`, `identityStatus`, `sort` (`fullName|email|createdAt`), `order`, `page` ≤ 1 000 000, `pageSize` ≤ 100 (def. 20).
  Solo empleados con alguna asignación en el alcance de `staff.read`; `manageable` por fila.
- **FR-006** `GET /v1/admin/staff/{id}`: fuera de alcance de lectura o inexistente = 404.
- **FR-007** `PATCH /v1/admin/staff/{id}` (`fullName`, `email`): el correo solo cambia en `PENDING_LINK` (409 si está vinculado:
  procedimiento futuro). Unicidad con `UNIQUE` y 409 ante `P2002` (sin comprobación previa racy). Nadie edita su propia cuenta salvo `fullName`.
- **FR-008** `PATCH /v1/admin/staff/{id}/status` (`staff.disable` para activar y desactivar): `reason` obligatorio al desactivar;
  idempotente (sin cambio no escribe ni audita); nadie cambia su propio estado ni se reactiva.
- **FR-009** `PUT /v1/admin/staff/{id}/assignments`: reemplazo transaccional completo (1..20, sin duplicados `(roleId, branchId)`).
  Las filas retiradas se eliminan (el diff queda en la auditoría); idempotente.
- **FR-010** Roles y permisos: `GET /v1/admin/roles`, `GET /v1/admin/roles/{id}`, `GET /v1/admin/permissions` (agrupado por módulo;
  `roles.read`), `PUT /v1/admin/roles/{id}/permissions` (`roles.manage`). No hay `POST/PATCH/DELETE` de roles (pendiente).

**Autorización**

- **FR-011** `AuthorizationService` (módulo `auth`): una lectura calcula `grants` solo con asignaciones activas de empleado activo
  hacia sucursales activas (globales siempre), cacheado en `req` y nunca entre solicitudes. API: `grantsFor(req)`, `scopeFor(req, perm)`,
  `canAccessBranch(scope, id)`, `canGrant(actor, role, branchId)`.
- **FR-012** `@RequireStaff('p1', 'p2')` se mantiene (JWT → `StaffGuard` → `MfaGuard aal2`): exige TODOS los permisos listados, cada uno
  en algún alcance; el alcance por recurso se resuelve con `scopeFor`. Reemplaza `BranchScopeService` (F07) y deja de usar la unión plana de `StaffContext`.
- **FR-013** `AuthStaffContext` añade `grants: {perm: {allBranches, branchIds}}` y `branches: [{id,name,code}]` (activas con algún permiso;
  todas las activas si hay alcance global); `permissions`, `allBranches`, `branchIds` se mantienen `deprecated` (solo UI). `GET /v1/auth/context`
  sigue sin datos administrativos en `aal1`; `GET /v1/admin/me/context` incluye los nuevos campos.
- **FR-014** Alcance global: `branch_id NULL` solo con rol `admin` y `admin` solo global (trigger + servicio); solo un actor con
  `staff.assign_roles` global lo otorga. Una sucursal inactiva no concede acceso operativo (sus asignaciones no entran en `grants`);
  un administrador global puede seguir gestionándola. La sucursal de una asignación debe existir y estar activa (`BranchesQueryService`, 400).

**Anti-escalada**

- **FR-015** Regla del subconjunto sobre asignaciones añadidas y retiradas (ADR-0010 d.4); el encargado nunca otorga `admin` ni global.
- **FR-016** Dominio del objetivo: para mutar a un empleado, todas sus asignaciones deben estar en el alcance del actor y cada rol otorgable
  por él; si no es visible = 404, si es visible y no gestionable = 403.
- **FR-017** Nadie modifica su propia cuenta (asignaciones, estado) ni se reactiva; sí su `fullName`.
- **FR-018** Cambiar permisos de un rol: `roles.manage`, actor con alcance global sobre cada permiso añadido, rol no `is_system` (409), al menos 1
  permiso, códigos desconocidos = 400. Auditoría con añadidos/retirados e ids de empleados afectados.
- **FR-019** Último administrador (ADR-0010 d.5): 409 si una desactivación o reemplazo dejaría 0 administradores activos, vinculados y globales;
  `pg_advisory_xact_lock` + recuento en la misma transacción. Un administrador `PENDING_LINK` no cuenta.

**Auditoría y respuestas**

- **FR-020** Eventos `staff.created|linked|updated|activated|deactivated|assignments_changed|bootstrapped`, `role.permissions_changed` y
  `staff.denied_escalation` en `audit_events` (`entity_type` `staff_user`/`role`), misma transacción, solo diff, sin secretos (el correo sí figura en
  `created`/`updated`: dato interno de trazabilidad; no `auth_user_id`). El evento de denegación va en transacción aparte.
- **FR-021** 401/403/404/409 consistentes y genéricos (403 sin detalle de la regla); `no-store` en `/v1/admin/**`. Errores 5xx sin trazas.

**Bootstrap (`staff:bootstrap`)**

- **FR-022** Pasa por la misma lógica de datos: el rol `admin` ya incluye los permisos nuevos (migración 0005 antes que el script).
  Escribe `staff.bootstrapped` (actor NULL) en la misma transacción y `created_by` NULL.
- **FR-023** Idempotente: si el correo ya es administrador global activo no cambia nada ni audita (exit 0). Protección contra ejecución accidental:
  muestra host/base de destino (nunca credenciales) y exige `--yes`; si ya existe un administrador activo y vinculado aborta (exit 3) salvo
  `--allow-existing-admin` (recuperación, p. ej. cuenta perdida); reactivar una fila existente se avisa explícitamente. El correo siempre viene de
  argumento/entorno, jamás en código. Contra producción requiere autorización explícita (regla del repo).

## Contrato

OpenAPI ya actualizado (`packages/contracts/openapi/openapi.yaml`); `contracts:check` fallará hasta que la API implemente las rutas (esperado).

| operationId                    | Ruta                                   | Permiso (alcance)                                    | Respuestas              |
| ------------------------------ | -------------------------------------- | ---------------------------------------------------- | ----------------------- |
| `listAdminStaff`               | `GET /v1/admin/staff`                  | `staff.read`                                         | 200 400 401 403         |
| `createAdminStaff`             | `POST /v1/admin/staff`                 | `staff.create` + `staff.assign_roles` por asignación | 201 400 401 403 409     |
| `getAdminStaff`                | `GET /v1/admin/staff/{id}`             | `staff.read`                                         | 200 400 401 403 404     |
| `updateAdminStaff`             | `PATCH /v1/admin/staff/{id}`           | `staff.update`                                       | 200 400 401 403 404 409 |
| `updateAdminStaffStatus`       | `PATCH /v1/admin/staff/{id}/status`    | `staff.disable`                                      | 200 400 401 403 404 409 |
| `replaceAdminStaffAssignments` | `PUT /v1/admin/staff/{id}/assignments` | `staff.assign_roles`                                 | 200 400 401 403 404 409 |
| `listAdminRoles`               | `GET /v1/admin/roles`                  | `roles.read`                                         | 200 401 403             |
| `getAdminRole`                 | `GET /v1/admin/roles/{id}`             | `roles.read`                                         | 200 400 401 403 404     |
| `replaceAdminRolePermissions`  | `PUT /v1/admin/roles/{id}/permissions` | `roles.manage`                                       | 200 400 401 403 404 409 |
| `listAdminPermissions`         | `GET /v1/admin/permissions`            | `roles.read`                                         | 200 401 403             |

Existentes modificados: `getAuthContext` y `getAdminContext` (esquema `AuthStaffContext` con `grants`/`branches`), y los permisos de las 5 operaciones
admin de sucursales (`listAdminBranches`, `getAdminBranch` → `branches.read`; `createAdminBranch` → `branches.create` con alcance global;
`updateAdminBranch`, `updateAdminBranchStatus` → `branches.update`). Cambios de esquema que rompen tipos de la web:
`StaffPermission` (enum de 10 → patrón `modulo.accion`) y `StaffRole` (+`staff`).

## Datos: migración 0005 (propuesta; NO aplicar sin autorización)

Una migración incremental `0005_rbac_granular_permissions` (las que siguen: 0006+ para otros slices; si otra rama toma 0005, renumera la que
se fusione después ANTES de fusionar, nunca una migración ya aplicada):

1. `roles.is_system BOOLEAN NOT NULL DEFAULT false` (`admin` = true). `staff_users`: `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
   `linked_at TIMESTAMPTZ`, `created_by UUID REFERENCES staff_users ON DELETE SET NULL`; CHECK `auth_user_id IS NOT NULL OR linked_at IS NULL`.
2. Inserta los 43 permisos y el rol `staff`; remapea `role_permissions` con la tabla de ADR-0010; aplica las adiciones; asegura `admin` = catálogo
   completo; **elimina 9** de los 10 permisos gruesos (`orders.accept` se conserva: existe en el catálogo nuevo; el `ON DELETE CASCADE` limpia `role_permissions`): requiere aprobación humana.
3. Precondición: aborta con mensaje claro si existen asignaciones `branch_id NULL` con rol distinto de `admin` o `admin` con sucursal
   (no se corrigen datos de acceso en silencio). Después, trigger `BEFORE INSERT OR UPDATE` en `staff_assignments` que impone «NULL ⇔ rol `admin`».
4. **5 índices nuevos** (baratos y preventivos con decenas de filas): `staff_assignments(branch_id) WHERE active`, `role_permissions(permission_id)`, `lower(staff_users.full_name)`, `staff_users(created_by)` y `staff_users(created_at DESC)`; no hay otros. RLS ya activo sin políticas (ADR-0009).
5. Prisma: `Role.isSystem`, `StaffUser.createdAt/linkedAt/createdBy`; reversión manual documentada (restaurar gruesos requeriría reinsertarlos y remapear a la inversa).
6. `AuditValues` admite `string[]`. Nombres de acciones nuevos no requieren cambio de esquema (`action` es texto libre).

## Plan del slice y tareas

1. **Contrato** ✅ (este PR): spec, ADR, OpenAPI, `schema.d.ts`.
2. **Datos**: migración 0005 + `schema.prisma` + pruebas de integración (matriz remapeada, trigger, precondición, admin con catálogo completo).
3. **API**: módulo `staff` (controllers/DTO, `StaffService`, `StaffRepository`), `roles` (`RolesService`), `AuthorizationService` en `auth`,
   `IdentityService` (vínculo con auditoría), migración de F07 (permisos + retirar `BranchScopeService`), `AuditService` (arrays), bootstrap.
4. **Pruebas API**: unitarias (subconjunto, dominio, auto-modificación, alcance, sucursal inactiva), e2e (401/403/404/409, `no-store`, sin `authUserId`),
   integración con PostgreSQL (concurrencia de último admin con dos transacciones; vínculo + auditoría atómicos; unicidad NULL; auditoría en rollback).
5. **Web**: sustituir `lib/permissions.ts` y mocks por el catálogo nuevo (21 errores de tipos esperados hoy en `backoffice-shell`, `bo-admin`, `session`, `mocks`),
   rol `staff` en i18n (es/en), `UsersScreen`/`UserModal` contra `lib/data-access` http (asignaciones múltiples, estado `PENDING_LINK`, `manageable`),
   pantalla de roles/permisos; comparar con el prototipo (`docs/ui/prototype-inventory.md`).
6. **Docs**: `docs/security/auth.md` y `mfa.md` (auditoría del vínculo ya existe; recuperación de MFA sigue pendiente), `docs/contracts/planned-endpoints.md`,
   ADR-0009 (referencia cruzada), `sushimon-api/CLAUDE.md` (permiso granular).
7. Agentes: `database-engineer` (migración), `api-engineer`, `web-engineer`, `security-reviewer` (obligatorio: anti-escalada y concurrencia), `qa-engineer`.

## Criterios de aceptación

- Encargado de A: crea empleado en A (200/201); intenta rol `admin`, alcance global o sucursal B → 403; ve solo personal de A; GET de un empleado solo de B → 404.
- Nadie se desactiva, reactiva ni cambia sus asignaciones; sí su nombre.
- Dos desactivaciones simultáneas de los dos últimos administradores: exactamente una tiene éxito; la otra 409 (prueba de integración real).
- `PUT /roles/{admin}/permissions` → 409; añadir a `kitchen` un permiso que el actor no tiene en global → 403 + `staff.denied_escalation`.
- Desactivar a un empleado: su siguiente solicitud con el mismo JWT recibe 403. Asignación a sucursal inactiva: no aparece en `grants`.
- Ninguna respuesta contiene `authUserId`; todas las rutas admin `no-store`; el vínculo escribe `staff.linked` en la misma transacción.
- `pnpm check` verde al cerrar el slice (incluye `contracts:check`).

## Riesgos

- **(Revisión de seguridad) Corregido en esta rama:** permisos del actor releídos con el cliente de la transacción tras el candado (A1); `email_verified === true` default-deny (A2); sin conexiones anidadas en transacciones interactivas, sucursales/roles con `FOR SHARE` (A3); `staff:bootstrap` exige `--confirm-host` (M3); nombres sin caracteres de control/formato (B1).
- **Aceptado/pendiente:** **M4** una asignación a una sucursal inactiva solo la gestiona un administrador global (el alcance acotado excluye sucursales inactivas). **M5** un encargado puede editar el correo de un empleado `PENDING_LINK` de su alcance (quien controle el nuevo correo en Google lo reclamaría); falta expiración de preautorizaciones. **B3** si falla la auditoría de `staff.linked`, el login de ese empleado falla en cada intento (atómico a propósito; DoS acotado). **B7** sin rate limit específico para gestión de personal (solo el global). **B8** el correo queda en `audit_events` (PII append-only, aceptado). **A2 residual:** el proveedor Email deshabilitado y el linking controlado son configuración de Supabase no verificable desde el repo (ver `docs/security/auth.md`).
- **Toma de preautorización por correo** (heredado de ADR-0009): una fila `PENDING_LINK` olvidada puede reclamarla quien controle ese correo en Google.
  Mitigación: Email deshabilitado en Supabase, estado visible, desactivación; expiración automática = pendiente.
- **Subconjunto permite pares**: un encargado puede otorgar `manager` a otro en su sucursal (permisos iguales). Alternativa: exigir rol estrictamente inferior; decisión pendiente de negocio.
- **Existencia de correos**: el 409 de `POST` revela a quien crea que un correo ya es empleado (aunque sea de otra sucursal). Aceptado (rol de confianza).
- **Visibilidad parcial**: un encargado ve los nombres de sucursal/rol de otras sucursales del mismo empleado (los datos de sucursal son públicos).
- **Migración con DELETE de referencia** y precondición que aborta: probar contra copia antes de producción.
- **Trazas de auditoría con correo** son append-only (F07/0004): no se pueden borrar; aceptable para personal interno.
- **Contrato rompe tipos de la web** hasta que se migre (checks de `sushimon-web` en rojo en esta rama hasta la tarea 5).
- **Concurrencia**: el advisory lock serializa todas las mutaciones de administradores; volumen insignificante.

## Pendiente (no incluido)

- Sesiones ya emitidas siguen válidas hasta `exp` (≤1 h) en Supabase; la API revalida permisos y estado en cada petición, por lo que el acceso al backoffice se corta de inmediato. No se revocan sesiones de Auth (requeriría service-role).
- Cambio de correo de una identidad vinculada: procedimiento futuro (hoy 409).
- Roles personalizados (crear/renombrar/eliminar) y asignación por API de roles al crearlos.
- Recuperación de MFA por un administrador (`auth.admin.mfa.deleteFactor` + `auth.admin.signOut`): bloqueada por decisión sobre service-role; F03 aporta auditoría y permisos previos.
- Frescura de `aal2` para acciones sensibles; rate limit específico de gestión de personal; consulta de auditoría (F36); expiración de `PENDING_LINK`.
