# MFA TOTP del backoffice (F02)

Estado: **implementada y verificada manualmente** (2026-11-14) contra Supabase de pruebas con Google y app TOTP: enrolar,
verificar al reingresar, código incorrecto con reintento, cuenta no autorizada, acceso directo por URL en aal1
(redirige a verify) y ausencia de bucles/parpadeo. Pruebas automáticas con JWT ES256 firmados y Supabase simulado.

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

## Recuperación de MFA (implementada: reinicio por otro administrador)

Estado: **API implementada con Supabase simulado** (`POST /v1/admin/staff/{id}/mfa-reset`, operación `resetAdminStaffMfa`).
Decisión del propietario C1 (`docs/business-rules/decisiones-pendientes.md`). **No verificada contra Supabase real**: requiere
configurar `SUPABASE_SERVICE_ROLE_KEY` en el servidor y una prueba manual controlada. La UI (Usuarios del backoffice) es un paso posterior.

No hay códigos de recuperación propios ni desactivación libre. Un empleado que pierde su app:

1. Contacta a un administrador global (verificación de identidad fuera de banda).
2. El administrador, desde el backoffice, ejecuta el reinicio. La API elimina TODOS los factores MFA del empleado en Supabase Auth
   (Admin API de GoTrue: `GET /auth/v1/admin/users/{userId}/factors` y `DELETE …/factors/{factorId}`, los mismos endpoints que
   `auth.admin.mfa.listFactors/deleteFactor` de `@supabase/supabase-js`), usando la clave de servicio **solo desde el servidor**.
3. En su siguiente inicio con Google el empleado llega con `aal1` → `MFA_REQUIRED` → sin factor verificado → `/backoffice/mfa/setup`
   (el flujo F02 existente; no hay código nuevo en la web para el enrolamiento).

### Reglas del endpoint

| Regla         | Detalle                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autenticación | JWT + personal activo + **`aal2`** (`@RequireStaff('staff.update')`; reutiliza `staff.update`, sin permiso ni migración nuevos)                                                                                                                                                                                                                                                 |
| Quién         | Solo **alcance global** de `staff.update` (el administrador global). Un encargado de sucursal recibe 403 aunque tenga `staff.update` acotado                                                                                                                                                                                                                                    |
| A quién       | Nunca a uno mismo (403). El objetivo debe existir y ser visible en el alcance del actor (404 `STAFF_NOT_FOUND`) y estar vinculado (409 `STAFF_NOT_LINKED`)                                                                                                                                                                                                                      |
| Idempotencia  | Sin factores → `204` igualmente. Un empleado **inactivo** es un objetivo válido (necesario para el procedimiento de robo de dispositivo). Reintentar tras un fallo parcial es seguro                                                                                                                                                                                            |
| Respuesta     | `204` sin cuerpo, `Cache-Control: no-store`                                                                                                                                                                                                                                                                                                                                     |
| Throttle      | 5 por minuto por **actor** autenticado (`authUserId` del JWT verificado) y 20 por minuto por IP (`429 RATE_LIMITED`). Un guard dedicado corre DESPUÉS de `JwtAuthGuard`: las solicitudes anónimas (401) no consumen el cupo del actor; lo demuestra `test/staff-mfa-reset.e2e-spec.ts`                                                                                          |
| Errores 5xx   | `503 MFA_RESET_UNAVAILABLE` (sin `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_URL`), `502 MFA_RESET_FAILED` (el proveedor falló). Mensajes fijos; nunca se filtra el detalle                                                                                                                                                                                                           |
| Auditoría     | `staff.mfa_reset` (actor, objetivo, `factorsRemoved`) y `staff.mfa_reset_failed` (+ categoría fija en `reason`: `unavailable`, `timeout`, `network`, `http_status_NNN`, `bad_response`, `unexpected`). Sin PII, sin `auth_user_id`, sin secretos. Las denegaciones por regla se auditan como `staff.denied_escalation` (`mfa_reset_requires_global_scope`, `self_modification`) |

La verificación de reglas se hace en una transacción corta (permisos vigentes del actor releídos en BD); la llamada a Supabase va
**fuera** de la transacción (no se retiene una conexión del pool durante la red) y la auditoría se escribe después en su propia
transacción. Si la auditoría de éxito fallara tras eliminar los factores, la solicitud responde 500 y el reintento (idempotente) vuelve a auditar.

### Configuración

- `SUPABASE_SERVICE_ROLE_KEY` (opcional, solo servidor; `sushimon-api/.env.example` la lista vacía). Jamás con prefijo `NEXT_PUBLIC_`,
  jamás en el repo, logs, errores, auditoría ni respuestas. Es la clave más poderosa del proyecto: guardarla únicamente en el gestor de
  secretos del despliegue de la API y rotarla si se sospecha de exposición. Sin ella (o sin `SUPABASE_URL`) el endpoint responde 503.
- `SUPABASE_ADMIN_TIMEOUT_MS` (opcional, 500–30000, defecto 8000): tope de cada llamada a la Admin API.
- Las pruebas usan un doble del puerto `AuthAdminPort`; no hay llamadas reales a Supabase.

### Salvaguardas de la fase externa

- **Intención auditada primero**: `staff.mfa_reset_requested` (sin PII) se escribe en su propia transacción ANTES de llamar a Supabase,
  así un fallo posterior deja rastro. Justo antes, el actor se reevalúa (permisos y alcance vigentes): si se desactivó entre fases, 403 genérico.
- **Plazo total** de 15 s para listar y borrar (además de `SUPABASE_ADMIN_TIMEOUT_MS` por llamada): si se agota, `502 MFA_RESET_FAILED`
  y `staff.mfa_reset_failed` (`reason: timeout`); los borrados pendientes se cancelan.
- **Tope de 20 factores** por solicitud: si el proveedor devuelve más, se procesan 20 y responde 502 (`reason: too_many_factors`).
- Un `TimeoutError` al leer el cuerpo de la respuesta se clasifica como `timeout` (no `bad_response`).
- En producción `SUPABASE_URL` debe ser `https:`, sin credenciales, query ni fragmento (si no, la API no arranca).

### Procedimiento operativo: robo o pérdida de dispositivo

Cuando hay sospecha de que un tercero tiene el dispositivo (y por tanto la sesión) del empleado:

1. **Desactivar al empleado primero** (`PATCH /v1/admin/staff/{id}/status`, con motivo): corta el acceso al instante porque la API consulta la BD en cada petición, aunque exista un token `aal2` vigente.
2. **Reiniciar su MFA** (`POST …/mfa-reset`; válido con el empleado inactivo).
3. **Reactivar** al empleado cuando se confirme su identidad fuera de banda. En su siguiente login enrolará un factor nuevo.

### Verificación manual PENDIENTE contra el proyecto de pruebas de Supabase

No verificado (hallazgo A2 de la revisión de seguridad): tras borrar el factor, ¿el **refresh token** de la sesión existente sigue emitiendo
tokens `aal2`? Pasos: sesión `aal2` del empleado de pruebas → reiniciar su MFA → refrescar la sesión → inspeccionar `aal`/`amr` del nuevo
access token. Si sigue emitiendo `aal2`, hay que invalidar sus sesiones con la Admin API de Supabase y añadirlo al endpoint. Mientras no
se verifique, el límite «≤ 1 h» de abajo es una **hipótesis**, no un hecho comprobado.

### Límites conocidos

- Un access token `aal2` ya emitido al empleado sigue válido hasta su `exp` (hipótesis de ≤ 1 h; ver la verificación pendiente); no se revocan sesiones (la Admin API de `signOut`
  exige el JWT del usuario, no su id). Mitigación: desactivar al empleado (`PATCH …/status`) corta el acceso al instante si hay sospecha de robo del dispositivo.
- No se ofrece enrolar un segundo factor de respaldo (la UI actual no lo permite a propósito).

### El único administrador que pierde su factor (procedimiento manual)

Nadie puede reiniciarse a sí mismo y no hay otro administrador que lo haga. Operación manual controlada, con registro de quién/cuándo/por qué:

1. Un responsable con acceso al **panel de Supabase** abre Authentication → Users, busca al usuario por correo y abre su ficha.
2. En la sección de factores MFA elimina el/los factores TOTP del usuario (o usa la Admin API con la service role desde un entorno controlado, nunca desde el navegador).
3. Se registra el evento fuera de la app (ticket/bitácora) y, de ser posible, se agrega una nota de auditoría manual.
4. El administrador inicia sesión con Google → `/backoffice/mfa/setup` → enrola de nuevo. Recomendado: mantener siempre **al menos dos administradores globales** vinculados para que uno pueda reiniciar al otro.

## Riesgos y límites

- **Enrolar un segundo factor con sesión aal1: VERIFICADO, cerrado por Supabase (2026-11-14).** Con un factor TOTP ya
  verificado, `POST /auth/v1/factors` con un token `aal1` responde `403 insufficient_aal` («AAL2 required to enroll a new
  factor»). La restricción de la UI no es la única barrera. Probado manualmente contra el proyecto Supabase de pruebas.
  Pendiente de observar: el primer enrolamiento (usuario sin factor) sí se permite en aal1, por diseño.
- aal2 sin frescura: un token aal2 sirve hasta `exp`; para acciones sensibles futuras exigir `amr.totp.timestamp` reciente.
- Falta log/auditoría de 403 `MFA_REQUIRED` y accesos denegados en los guards (sin PII) → F03.

- El `aal2` de un access token vive hasta su `exp` (1 h): desactivar a un empleado corta el acceso al instante (se
  consulta la BD), pero quitar el factor no invalida un token `aal2` ya emitido → revocar sesiones al recuperar MFA.
- Brecha `staff_users.auth_user_id` (preregistro/vinculación por correo): ver ADR-0009; auditoría persistente → F03.
- Rate limit específico de `/auth/*` pendiente (F01 T022).
