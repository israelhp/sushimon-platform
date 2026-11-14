# ADR-0010 RBAC con permisos granulares, alcance por sucursal y anti-escalada

**Estado**: **propuesta** (2026-11-14, F03). Se acepta al fusionar la spec `specs/006-staff-rbac-management`.
Complementa a ADR-0009 (identidad); no lo reemplaza.

**Contexto**: F01 sembró 10 permisos gruesos (`dashboard`, `orders.accept`, `orders.status`, `orders.dispatch`,
`products.edit`, `products.availability`, `promotions`, `branches`, `users`, `reports`) y 3 roles. Un permiso como
`branches` mezcla leer, crear y editar; `users` no distingue crear de desactivar. El alcance se calcula hoy en dos sitios
(la unión plana de `StaffContext` y el provisional `BranchScopeService` de F07). No existe gestión de empleados: nadie
puede preautorizar a un empleado salvo por el script `staff:bootstrap`.

## Decisión

1. **Catálogo granular `modulo.accion`** (43 permisos, ver spec 006) sembrado por migración. Los 10 gruesos se
   **remapean y retiran** (son datos de referencia sembrados por nosotros). Mapeo (se aplica a `role_permissions`
   existentes, de modo que cualquier edición manual previa se conserva):

   | Antiguo                 | Nuevos                                                                                                            |
   | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
   | `dashboard`             | `dashboard.read`                                                                                                  |
   | `orders.accept`         | `orders.read`, `orders.accept`, `orders.reject`                                                                   |
   | `orders.status`         | `orders.read`, `orders.prepare`, `orders.complete` (NO `orders.cancel`: mínimo privilegio, ver adiciones)         |
   | `orders.dispatch`       | `deliveries.read`, `deliveries.assign`, `deliveries.update`, `riders.read`, `riders.assign`                       |
   | `products.edit`         | `catalog.read`, `catalog.create`, `catalog.update`                                                                |
   | `products.availability` | `catalog.read`, `catalog.manage_availability`                                                                     |
   | `promotions`            | `promotions.read`, `promotions.create`, `promotions.update`                                                       |
   | `branches`              | `branches.read`, `branches.create`, `branches.update`, `branches.manage_hours`, `branches.manage_delivery_zones`  |
   | `users`                 | `staff.read`, `staff.create`, `staff.update`, `staff.disable`, `staff.assign_roles`, `roles.read`, `roles.manage` |
   | `reports`               | `reports.read` (`reports.export` solo por adición a `admin`)                                                      |

   **Adiciones explícitas (más allá de la equivalencia)**: `admin` recibe TODO el catálogo (incluye `orders.cancel`,
   `payments.*`, `incidents.*`, `audit.read`, `settings.*`, `reports.export`); `manager` recibe `orders.cancel`,
   `branches.read`, `roles.read` y `staff.read/create/update/disable/assign_roles` (D4: el encargado gestiona su
   personal, acotado a sus sucursales); el rol nuevo `staff` ("Empleado") recibe `orders.read/accept/prepare` y
   `deliveries.read`. `kitchen` queda equivalente al actual (`orders.read/accept/reject/prepare/complete`).
   Las adiciones a `manager` son una **decisión de negocio a confirmar**; sin ellas un encargado no podría gestionar a nadie.

2. **Alcance por permiso, no por empleado**: `AuthorizationService` calcula en una lectura los `grants`
   (permiso → `{allBranches, branchIds}`) solo con asignaciones activas de empleado activo hacia sucursales activas
   (las globales `branch_id NULL` siempre cuentan). Se cachea únicamente en `req`; sin caché entre solicitudes para que la
   revocación sea inmediata. `@RequireStaff('perm')` exige cada permiso en **algún** alcance; el alcance por recurso se
   resuelve con `scopeFor(perm)`. Sustituye al `BranchScopeService` de F07 y a la unión plana de `StaffContext`
   (`permissions`, `allBranches`, `branchIds` se conservan marcados `deprecated` solo para la UI; **nunca autorizan**).
3. **`branch_id NULL` = alcance GLOBAL explícito y solo del rol `admin`**; además `admin` solo puede ser global
   (refuerzo respecto al encargo: un admin acotado a una sucursal difuminaría "último administrador" y la inmutabilidad
   del rol; es fácil de relajar con otro ADR). Se refuerza en BD con un trigger (CHECK no puede mirar otra tabla) y en
   servicio. La unicidad ya está cubierta: `UNIQUE(staff_id, role_id, branch_id)` + índice parcial
   `(staff_id, role_id) WHERE branch_id IS NULL` (cubre el NULL que UNIQUE ignora).
4. **Anti-escalada (regla del subconjunto)**: un actor otorga o retira un rol en un alcance solo si posee **todos** los
   permisos del rol en ese alcance (y `staff.assign_roles` en él); el alcance global exige alcance global. Se aplica a
   las asignaciones **añadidas y retiradas** (un encargado no puede quitarle un rol superior a nadie), y se exige
   "dominio" para cualquier mutación del empleado: todas sus asignaciones dentro del alcance del actor y cada rol
   otorgable por él. Nadie se modifica a sí mismo (asignaciones, estado, reactivación); solo puede editar su `fullName`.
   Cambiar permisos de un rol exige `roles.manage` y que el actor posea con alcance global cada permiso añadido.
   Roles `is_system` (solo `admin` en 0005; columna nueva) no son editables. `manager`, `kitchen` y `staff` sí lo son:
   de lo contrario `PUT /roles/{id}/permissions` sería una operación muerta mientras no existan roles personalizados.
5. **Último administrador**: tras cualquier mutación debe existir ≥1 empleado activo, **vinculado**, con asignación `admin`
   global activa. Se serializa con `pg_advisory_xact_lock(<clave fija>)` al inicio de toda operación que toque a un
   administrador (desactivar, reemplazar asignaciones) y se re-cuenta dentro de la misma transacción antes de confirmar
   (409 y rollback si queda en 0). Se descartó `SELECT … FOR UPDATE` sobre las filas admin porque no protege
   inserciones concurrentes (fantasmas) ni cambios en `staff_users.active`, y un lock sobre el conjunto crece con él.
6. **Preautorización (reutiliza ADR-0009, alternativa B)**: `staff_users.auth_user_id` NULLABLE; el vínculo sigue siendo
   el `UPDATE … WHERE email AND auth_user_id IS NULL AND active` atómico con OAuth Google. F03 añade: estado derivado
   `identityStatus` (`PENDING_LINK` si `auth_user_id IS NULL`, `LINKED` si no), auditoría `staff.linked` en la MISMA
   transacción del vínculo (hoy solo log) y tres columnas en `staff_users`: `created_at` (orden y trazabilidad),
   `linked_at` (se expone como `linkedAt`; CHECK: no puede haber `linked_at` sin `auth_user_id`) y `created_by` (FK a
   `staff_users`, `ON DELETE SET NULL`; NULL = proceso manual/anterior a F03). Filas existentes: `created_at = now()` de la
   migración, `linked_at` NULL aunque estén vinculadas (dato desconocido; no se inventa).
   **No se usa tabla de invitaciones**: duplicaría la unicidad de correo, exigiría mover/reconciliar filas y asignaciones
   al vincular (más ventanas de carrera), y no aporta nada sin envío de correos ni tokens (el "token" es la propia sesión
   Google con ese correo). **Sin `auth.admin.createUser`**: el backend no usa la service-role key de Auth.
7. **Auditoría** en `app.audit_events` (misma transacción, solo diff real, sin secretos ni `auth_user_id`):
   `staff.created`, `staff.linked`, `staff.updated`, `staff.activated`, `staff.deactivated`,
   `staff.assignments_changed`, `staff.bootstrapped`, `role.permissions_changed` (con permisos añadidos/retirados e ids de
   empleados afectados) y el evento de seguridad `staff.denied_escalation` (intento 403 por regla anti-escalada; se
   escribe en una transacción aparte tras el rollback y con la regla violada como `reason`). `AuditValues` se amplía a
   `string[]`.
8. **Respuestas**: sin sesión = 401; sin permiso o regla violada = 403 con mensaje genérico; recurso inexistente o fuera
   del alcance de lectura = 404 (no se revela existencia); conflicto de estado (último admin, correo duplicado, rol del
   sistema) = 409. Todas las rutas admin `Cache-Control: no-store`.
9. **Integración F07**: `BranchesQueryService` valida que cada sucursal de una asignación exista y esté activa
   (400 si no). F07 solo cambia sus permisos: `branches.read` (listados/detalle), `branches.create` (alta, exige alcance
   global), `branches.update` (PATCH y status). Una sucursal inactiva no concede acceso operativo, pero un administrador
   global sigue pudiendo gestionarla.

## Consecuencias

- El contrato cambia el tipo de `StaffPermission` (de enum de 10 a patrón `modulo.accion`) y amplía `StaffRole` con
  `staff`; la web debe migrar `lib/permissions.ts` y los mocks (tareas de la spec). No es `/v2`: ningún cliente externo
  lo consume (los endpoints reales de F01/F02 solo devuelven el contexto a la web propia).
- Migración 0005 **elimina filas** de `app.permissions` (9 de los 10 códigos gruesos; `orders.accept` se conserva; datos sembrados): requiere aprobación humana
  antes de aplicarse a una base real. No hay DROP de tablas/columnas.
- `admin` debe contener todo el catálogo: cada migración futura que añada un permiso lo añade también a `admin` (prueba
  de integración que lo verifica).
- Los permisos se leen de la BD en cada solicitud (una lectura); con ~100 pedidos/día y decenas de empleados es
  despreciable y evita revocaciones diferidas.

## Alternativas descartadas

- **Rol con permisos en el JWT / claims**: editable/obsoleto (ADR-0009).
- **Caché de `grants` entre solicitudes** (memoria/Redis): revocación diferida y Redis no está justificado.
- **Superadmin oculto / bypass por código**: ninguna lógica especial salvo `is_system` y la regla del último admin.
- **Roles personalizados por API ahora**: pendiente; el prototipo solo edita permisos por rol.
- **Tabla separada de invitaciones**: ver decisión 6.
