# F02 — MFA TOTP obligatorio para el backoffice

**Rama**: `feature/F02-backoffice-mfa` (apilada sobre `feature/f01-auth-supabase`: F01 aún no está en `develop`)
**Prioridad**: P0 · **Dependencias**: F01 · **Estado**: `INTEGRATED` (API y web probadas con dobles y, manualmente, contra Supabase + Google reales:
enrolar, verificar, error y reintento, cuenta no autorizada). Falta confirmar acceso directo por URL en aal1 y bucles (T020b); sin E2E automatizado.

## Historias

- **US1** Empleado autorizado sin factor: configura TOTP (QR + clave) y entra solo cuando la API confirma `aal2`.
- **US2** Empleado con factor: tras Google, verifica el código (aal1 → aal2); con sesión ya aal2 no se pide de nuevo.
- **US3** Cliente (con o sin MFA propio), empleado desactivado o sin permiso/sucursal: nunca obtiene acceso admin.

## Requisitos funcionales

FR-001 Supabase Auth MFA es la única fuente de verdad de factores (`mfa.listFactors/enroll/challenge/verify/
getAuthenticatorAssuranceLevel`); nada de secretos/códigos/QR en PostgreSQL ni en logs · FR-002 la API lee `aal` SOLO del
JWT verificado; `aal2` exige claim `aal=aal2` **y** `amr` con `totp`, cualquier otra forma degrada a `aal1` ·
FR-003 `@RequireStaff()` aplica en orden JWT → personal activo/permisos → `MfaGuard(aal2)`; una consulta de personal por
solicitud · FR-004 `GET /v1/auth/context` funciona en aal1 pero no revela roles/permisos/sucursales hasta `aal2`
(`access = NOT_STAFF | MFA_REQUIRED | GRANTED`) · FR-005 `GET /v1/admin/me/context` (aal2) · FR-006 web: login,
`/backoffice/mfa/setup`, `/backoffice/mfa/verify`, `/backoffice/access-denied`; estado único
`BackofficeAccessKind`; `proxy.ts` envía aal1 a verificar y marca el backoffice `no-store` · FR-007 enrolar solo por
acción explícita; se descartan factores pendientes anteriores; un factor pendiente no cuenta como habilitado ·
FR-008 verificar el código no concede acceso: solo `STAFF_AUTHORIZED` (API) redirige.

## Criterios de aceptación → evidencia

| Criterio                                                   | Evidencia                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| aal1 → 403 `MFA_REQUIRED`; aal2 → 200                      | `test/auth.e2e-spec.ts` (bloque «MFA aal2 obligatorio»), `mfa.guard.spec.ts` |
| Claim falsificado/inválido, firma ajena, token expirado    | e2e + `jwt-verifier.service.spec.ts` (8 degradaciones a aal1)                |
| Cliente aal2, desactivado aal2, sin permiso, otra sucursal | e2e (403 uniformes; sin filtrar permisos ni correo)                          |
| `auth/context` sin permisos antes de aal2                  | e2e `MFA_REQUIRED` con `staff: null`                                         |
| Enrolar/verificar/errores/formato/doble envío              | `lib/auth/mfa.test.ts`, `MfaScreens.test.tsx`                                |
| Sin bucles ni parpadeo; `?next=` solo interno              | `MfaScreens.test.tsx`, `use-access-redirect.ts`, `proxy.test.ts`             |
| Sin caché pública en backoffice                            | `proxy.test.ts` (`private, no-store`)                                        |

## Fuera de alcance / pendiente

Verificación real con Supabase + Google + app TOTP (T020) · recuperación administrativa de MFA (requiere F03, ver
`docs/security/mfa.md`) · auditoría persistente · E2E de navegador con Supabase local · endpoints administrativos
reales (cada uno hereda `@RequireStaff`).
