# MFA TOTP del backoffice (F02)

Estado: **API y web implementadas y probadas con dobles** (JWT ES256 firmados en pruebas; Supabase simulado en la web).
**Pendiente de verificación manual** contra un proyecto Supabase real con Google y una app autenticadora (T020).

## Principio

Supabase Auth gestiona identidad y factores; **NestJS decide el acceso**; Next.js solo guía la experiencia.
Nada de secretos TOTP, códigos, QR ni tokens en PostgreSQL, logs ni `localStorage`.

## Quién puede qué

| Sesión                               | Tienda |    `GET /v1/auth/context`    | `/v1/admin/**` y `@RequireStaff` |
| ------------------------------------ | :----: | :--------------------------: | :------------------------------: |
| Cliente (con o sin MFA propio)       |   ✅   |    `NOT_STAFF`, sin datos    |      403 `Acceso denegado`       |
| Personal activo, `aal1`              |   ✅   | `MFA_REQUIRED`, sin permisos |        403 `MFA_REQUIRED`        |
| Personal activo, `aal2`              |   ✅   |  `GRANTED` + roles/permisos  |     según permiso y sucursal     |
| Personal desactivado (aunque `aal2`) |   ✅   |         `NOT_STAFF`          |      403 `Acceso denegado`       |

## Cómo valida la API `aal2`

`JwtVerifierService` (tras verificar firma, emisor, audiencia y expiración) fija `aal2` **solo** si el claim firmado
`aal` vale `aal2` **y** `amr` contiene `{method:'totp'}`. Cualquier otra cosa (ausente, otro valor/tipo, `aal2` sin TOTP)
es `aal1`. Body, query, cabeceras, cookies y `user_metadata` no se leen. `MfaGuard` lee `req.principal.aal`.

Orden fijo en `@RequireStaff(...permisos)`: **JWT (guard global) → `StaffGuard` (personal activo, asignación, permisos;
una consulta por solicitud, cacheada en `req.staff`) → `MfaGuard` (aal2)** → alcance por sucursal (`canAccessBranch`,
por recurso). Quien no es personal recibe el mismo 403 que quien carece de permiso (no se revela quién es personal);
el personal en aal1 recibe `MFA_REQUIRED` (dato de su propia cuenta).

> **Convención para endpoints futuros**: toda ruta administrativa (pedidos, catálogo, promociones, sucursales,
> usuarios/roles, repartidores, entregas, pagos, reportes, configuración, auditoría) usa `@RequireStaff(...)` a nivel de
> clase o método — hereda `aal2` automáticamente. `StaffGuard` suelto NO exige MFA y no debe usarse en rutas. Las únicas
> excepciones sin aal2 son `GET /v1/auth/context` (necesario para completar el proceso) y los endpoints de cliente/públicos.

## Flujo web

```
Google OAuth (F01) → /auth/callback → GET /v1/auth/context
  NOT_STAFF     → /backoffice/access-denied
  MFA_REQUIRED  → Supabase: ¿factor TOTP verificado?
                    no → /backoffice/mfa/setup  (enroll → QR/clave → challenge+verify)
                    sí → /backoffice/mfa/verify (challenge+verify)
  GRANTED       → /backoffice (o ?next= interno)
```

- Tras `mfa.verify` Supabase entrega un JWT `aal2`; la web comprueba `getAuthenticatorAssuranceLevel()`, **revalida con la
  API** (`invalidateQueries(['auth'])`) y solo redirige cuando `access = GRANTED`. Una variable local nunca basta.
- Enrolar solo al pulsar «Comenzar» (no al renderizar). Se descartan los factores TOTP pendientes de intentos anteriores;
  un factor pendiente no cuenta como habilitado. Con un factor ya verificado no se enrola otro desde la UI.
- Si el cliente cree estar en `aal2` y la API ve `aal1` (token anterior): se refresca la sesión una vez y se revalida;
  si persiste, se pide verificar. Nunca se concede.
- `proxy.ts` (UX, no autorización): sin sesión → login; `aal1` → `/backoffice/mfa/verify`; backoffice con
  `Cache-Control: private, no-store`. `getClaims()` verifica la firma; no se usa `getSession()` como prueba de identidad.
- Estados: `INITIALIZING · UNAUTHENTICATED · SESSION_EXPIRED · STAFF_UNAUTHORIZED · MFA_ENROLLMENT_REQUIRED ·
MFA_CHALLENGE_REQUIRED · STAFF_AUTHORIZED · ERROR` (`features/session/backoffice-access.ts`). `AUTHENTICATED_PUBLIC`
  no aplica al backoffice: el cliente va a `STAFF_UNAUTHORIZED`.

## Configuración necesaria en Supabase

1. Authentication → **Multi-Factor** (MFA): habilitar **TOTP** (Enroll y Verify).
2. Mantener Google como único proveedor, Email deshabilitado y sin sign-ins anónimos (ver `auth.md`).
3. Claves de firma asimétricas (ES256): el claim `aal` y `amr` van firmados en el access token.
4. Rate limits de Auth: se respetan los de Supabase (`over_request_rate_limit` → «Demasiados intentos»).
5. (Recomendado) Considerar RLS con `auth.jwt()->>'aal'` en tablas `app.*` expuestas por PostgREST como defensa en profundidad.

## Recuperación de MFA (procedimiento; parte requiere F03)

No hay códigos de recuperación propios ni desactivación libre. Un empleado que pierde su app:

1. Contacta a un administrador (verificación de identidad fuera de banda).
2. Un **administrador con `aal2`** elimina el factor del empleado (Supabase Admin API `auth.admin.mfa.deleteFactor`, desde
   el servidor con la service role, nunca desde la web) → **bloqueado hasta F03** (gestión de usuarios + auditoría).
3. Se revocan las sesiones del empleado (`auth.admin.signOut`) y se registra el evento (quién, a quién, cuándo).
4. En su siguiente inicio con Google el empleado vuelve a `/backoffice/mfa/setup`.

Recomendación para F03: permitir enrolar un segundo factor TOTP de respaldo (la UI actual no lo ofrece a propósito).
Último recurso hoy: operación manual controlada en el panel de Supabase por un responsable, con registro.

## Riesgos y límites

- **Enrolar un segundo factor con sesión aal1 (revisión de seguridad, ALTO, por verificar)**: la restricción «no enrolar si ya
  hay factor verificado» está solo en la UI. Si Supabase permite `mfa.enroll` + `verify` a una sesión aal1 que ya tiene factor,
  una sesión Google comprometida podría obtener `aal2` con su propio autenticador. **Antes de producción** comprobar en el
  proyecto real que el enrolamiento adicional exige `aal2`; si no, limitar a 1 factor o mover el enrolamiento a la API (F03).
- aal2 sin frescura: un token aal2 sirve hasta `exp`; para acciones sensibles futuras exigir `amr.totp.timestamp` reciente.
- Falta log/auditoría de 403 `MFA_REQUIRED` y accesos denegados en los guards (sin PII) → F03.

- **No probado con Supabase/Google reales** (T020): firmas de la API de `supabase-js` verificadas contra los tipos de la
  versión instalada, pero no ejecutadas de extremo a extremo.
- El `aal2` de un access token vive hasta su `exp` (1 h): desactivar a un empleado corta el acceso al instante (se
  consulta la BD), pero quitar el factor no invalida un token `aal2` ya emitido → revocar sesiones al recuperar MFA.
- Brecha `staff_users.auth_user_id` (preregistro/vinculación por correo): ver ADR-0009; auditoría persistente → F03.
- Rate limit específico de `/auth/*` pendiente (F01 T022).
