# Tareas — F02

- [x] T001 Contrato: `getAuthContext` ampliado (aal, access, mfaRequired) y `getAdminContext` (`/v1/admin/me/context`)
- [x] T002 `Principal.aal`: aal2 solo con claim firmado + `amr` totp
- [x] T003 `MfaGuard` y composición en `@RequireStaff` (JWT → personal → aal2); `@CurrentStaff()`
- [x] T004 `AdminController` (`GET /v1/admin/me/context`); `auth/context` sin permisos antes de aal2
- [x] T005 Pruebas API: unidad (verificador, guard) y e2e (matriz aal1/aal2, cliente, desactivado, sucursal, claims falsos)
- [x] T006 Web: `lib/auth/mfa.ts` (Supabase MFA), máquina de estados, `useBackofficeAccess`
- [x] T007 Web: pantallas setup / verify / access-denied; `StaffGate` y login por estado
- [x] T008 Web: `proxy.ts` (aal1 → verificar, `no-store`)
- [x] T009 Pruebas web: estados, servicio MFA, pantallas, proxy
- [x] T010 Docs: `docs/security/mfa.md`, `auth.md`, CLAUDE.md
- [x] T020 Prueba manual real (Supabase de pruebas + Google + app TOTP, 2026-11-14): enrolar, verificar al reingresar, código incorrecto con reintento, cuenta no autorizada → access-denied, y `403 insufficient_aal` al enrolar un 2.º factor en aal1
- [ ] T020b Prueba manual pendiente: URL directa del backoffice en aal1 y ausencia de bucles/parpadeo
- [ ] T021 E2E de navegador del flujo MFA contra Supabase local/cloud de pruebas
- [ ] T022 (F03) Recuperación administrativa de MFA con auditoría y revocación de sesiones
