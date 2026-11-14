# Tareas — F01

- [x] T001 Contrato: `/v1/auth/context`, `/v1/me`, esquemas, `security` por operación
- [x] T002 Migración 0002: customers, staff_users, roles, permissions, role_permissions, staff_assignments, branches (RLS)
- [x] T003 Verificador JWT (`jose`): firma, iss, aud, exp, sub, role; sin `none`; HS256 solo con secreto
- [x] T004 Guard global (denegar por defecto) + `@Public()` + `@CurrentUser()`
- [x] T005 `IdentityService`: cliente idempotente; contexto de personal; vinculación segura
- [x] T006 `StaffGuard` / `@RequireStaff()` + `canAccessBranch`
- [x] T007 Pruebas: unidad, e2e, integración con PostgreSQL real, humo con Supabase local
- [x] T008 ADR-0009 + script `staff:bootstrap`
- [x] T009 Web: config de auth, clientes Supabase (browser/server), `proxy.ts`, callback PKCE
- [x] T010 Web: `AuthProvider` (sesión, renovación, expiración), token en el cliente HTTP con reintento único
- [x] T011 Web: login Google del backoffice, `StaffGate`, modal y cuenta del cliente, cierre de sesión
- [x] T012 Docs de seguridad y configuración (Google Cloud, Supabase, variables)
- [ ] T020 (bloqueado: credenciales de Google y proyecto Supabase) prueba de ida y vuelta real con Google
- [ ] T021 E2E de navegador (Playwright) del flujo de login contra Supabase local con proveedor de prueba
- [ ] T022 Auditoría persistente del vínculo de empleados; rate limit específico de `/auth/*`
