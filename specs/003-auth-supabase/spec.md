# F01 — Autenticación con Supabase Auth y Google

**Rama**: `feature/f01-auth-supabase` · **Prioridad**: P0 · **Dependencias**: F00 · **Estado**: `API_IMPLEMENTED`
(API real probada; web integrada tras `NEXT_PUBLIC_AUTH_SOURCE=supabase`; Google real **no** verificado: sin credenciales).

## Historias

- **US1**: un cliente inicia sesión con Google y entra a su cuenta (`GET /v1/me`).
- **US2**: un empleado preregistrado entra al backoffice con Google; quien no está autorizado no entra.
- **US3**: un token inválido (firma, emisor, audiencia, expiración, sujeto) se rechaza con 401 uniforme.

## Requisitos funcionales

FR-001 Supabase Auth como única identidad · FR-002 Google OAuth con PKCE (Next.js) · FR-003 sesión y renovación por
Supabase · FR-004 JWT validado en NestJS (firma, emisor, audiencia, exp, sub, role) · FR-005 mismo `auth.users.id`
para cliente y empleado · FR-006 autenticación separada de autorización (permisos desde BD) · FR-007 sin contraseñas ni
sesiones propias · FR-008 `GET /v1/auth/context` y `GET /v1/me` · FR-009 tablas `app.customers`, `app.staff_users`
(+ roles/permisos/asignaciones/sucursales) · FR-010 web: login Google, callback, persistencia y expiración ·
FR-011 vinculación segura de empleados no vinculados (ADR-0009).

## Criterios de aceptación → evidencia

| Criterio                                          | Evidencia                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Cliente autenticado entra a su cuenta             | e2e `GET /v1/me`; humo local con JWT ES256 real; `RealAccountHub`                             |
| Sin autorización administrativa no hay backoffice | e2e 403 en `@RequireStaff`; `backofficeAccess=false`; `StaffGate`; integración con BD real    |
| Token inválido se rechaza                         | 14 casos de unidad del verificador + e2e (expirado, firma ajena, iss, aud, anon, mal formado) |
| Brecha `staff_users.auth_user_id`                 | ADR-0009; integración: vínculo único, carrera entre dos cuentas, inactivo, sesión no-Google   |

## Fuera de alcance / pendiente

Verificación con Google real y proyecto Supabase en la nube (T020) · auditoría persistente · rate limit específico de
`/auth/*` · cuenta (pedidos, direcciones, favoritos) con API real · CSP completa.
