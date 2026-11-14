# Autenticación y autorización (F01)

Estado: **API y web implementadas y probadas** con pruebas unitarias, e2e y de integración (JWT ES256 firmados en las pruebas). La verificación
manual con Google contra el proyecto Supabase de pruebas en la nube se hace siguiendo esta guía.

## Modelo

- **Una identidad**: `auth.users.id` (Supabase Auth). Mismo UUID para cliente (`app.customers.auth_user_id`) y
  empleado (`app.staff_users.auth_user_id`). Sin contraseñas ni sesiones propias.
- **Autenticación ≠ autorización**. El JWT prueba _quién_; roles, permisos y sucursales salen de la base de datos en cada
  solicitud (`staff_users` → `staff_assignments` → `roles` → `role_permissions`). Desactivar a un empleado corta su
  acceso al instante. Ver ADR-0009.
- **Web**: Google OAuth con **PKCE** (`@supabase/ssr`), sesión en cookies, renovación automática, `proxy.ts` que
  refresca la sesión y manda al login a quien no la tenga. La API se llama con `Authorization: Bearer <access token>`
  (sin cookies hacia la API: no hay CSRF). El token no va a `localStorage`.
- **API (NestJS)**: guard global **denegar por defecto** (`@Public()` para health). `JwtVerifierService` verifica firma
  (JWKS ES256/RS256; HS256 solo con `SUPABASE_JWT_SECRET`), emisor, audiencia, expiración, `sub` UUID y
  `role = authenticated`. `@RequireStaff('permiso')` exige personal activo con ese permiso **y sesión `aal2` (MFA TOTP, F02: `docs/security/mfa.md`)**.

```
Navegador ──Google OAuth (PKCE)──▶ Supabase Auth ──code──▶ /auth/callback (Next) ──cookies──▶ sesión
Navegador ──Bearer JWT──▶ API ──JWKS (caché)──▶ verifica ──▶ IdentityService ──▶ PostgreSQL (app.*)
```

## Endpoints

| Ruta                       | Uso                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/auth/context`     | Identidad + `access` (`NOT_STAFF`/`MFA_REQUIRED`/`GRANTED`). Roles/permisos solo con aal2 (F02). No crea cliente.  |
| `GET /v1/admin/me/context` | Contexto administrativo (personal activo + `aal2`). Ver `docs/security/mfa.md`.                                    |
| `GET /v1/me`               | Perfil de cliente; lo crea de forma idempotente en el primer acceso.                                               |
| `401`                      | Token ausente/ inválido/ expirado/ de otro emisor o audiencia: mismo mensaje, motivo solo en el log con requestId. |
| `403` (`@RequireStaff`)    | No es personal activo o falta el permiso: mismo mensaje en ambos casos. Personal en `aal1`: `MFA_REQUIRED`.        |

## Primer acceso de un empleado (brecha `staff_users.auth_user_id`)

`auth_user_id` es **nullable** (ADR-0009). Un administrador preregistra al empleado por correo (minúsculas) con rol y
sucursal; en su **primer inicio de sesión con Google** la API ejecuta un `UPDATE … WHERE email = $1 AND auth_user_id IS NULL
AND active` atómico y lo vincula. Condiciones: sesión de OAuth con Google (`app_metadata.provider = google` y `amr`
`oauth`), **correo verificado** (`user_metadata.email_verified === true`; ausente o distinto = no vincula, default-deny),
fila activa y sin vincular. Sin preregistro no hay acceso; nunca se crea personal automáticamente.

**Riesgo residual y pendiente de entorno (Supabase):** `user_metadata` es editable por el propio usuario, así que
`email_verified` solo filtra el caso explícito; la defensa real es de configuración y **no está verificada desde el
repositorio**: (1) proveedor **Email deshabilitado** (sin registro con correo/contraseña de un tercero); (2) **linking
automático de identidades controlado** (no permitir que una identidad de otro proveedor se enlace por correo al mismo
`auth.users`). La API no exige `googleOAuth` en cada petición (la sesión puede refrescarse sin pasar por OAuth y romper F01);
el vínculo solo ocurre en el primer acceso. Revisar ambos ajustes antes de producción.

### Primer administrador (proceso manual controlado)

```bash
# DATABASE_URL (o DIRECT_URL) en el entorno; no se pasa como argumento. Correo y nombre: argumentos o
# BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_NAME (nunca en código).
pnpm --filter sushimon-api staff:bootstrap -- --email persona@dominio.com --name "Nombre Apellido" --yes --confirm-host=<host-del-destino>
```

Prerrequisito: migración `0005_staff_rbac` aplicada (el rol `admin` ya contiene el catálogo granular).
Protecciones (spec 006, D8):

- Muestra el destino (host:puerto/base, **nunca** usuario ni contraseña) y exige `--yes` **y** `--confirm-host=<host>`
  igual al host real del destino (evita ejecutarlo contra la base equivocada por un `.env` heredado); sin ellos, o con un
  host distinto, no escribe nada (exit 2).
- Los valores de los argumentos no pueden empezar por `--` (un valor olvidado no consume el flag siguiente).
- Si promueve a administrador a una fila **ya vinculada** a una cuenta, lo avisa explícitamente en consola.
- Si ya existe un administrador global **activo y vinculado** aborta (exit 3) salvo `--allow-existing-admin`
  (recuperación, p. ej. cuenta perdida).
- Idempotente: si el correo ya es administrador global activo no cambia ni audita (exit 0). Reactivar una fila o
  asignación existente se avisa en consola.
- Todo en una transacción con el candado de «último administrador»; escribe `staff.bootstrapped` en `audit_events`
  (actor NULL, `created_by` NULL, sin correo).

Quien tenga ese correo queda vinculado al iniciar sesión con Google. Ejecutarlo contra producción requiere
autorización explícita.

## Configuración

### Google Cloud Console

1. APIs y servicios → Credenciales → **ID de cliente OAuth** (aplicación web).
2. **URI de redireccionamiento autorizado**: `https://<ref>.supabase.co/auth/v1/callback`.
3. Guardar `client_id` y `secret`. **Nunca** al repositorio.

### Supabase (nube: Authentication)

- **Providers**: activar **Google** con el `client_id`/`secret`; **desactivar Email** (si no, un tercero podría registrar
  un correo ajeno y reclamar un puesto preregistrado) y no habilitar sign-ins anónimos.
- **URL Configuration**: _Site URL_ = URL pública de la web; _Redirect URLs_ = `https://<dominio>/auth/callback`.
- **JWT signing keys**: usar claves asimétricas (ES256). Con un proyecto heredado HS256, configurar
  `SUPABASE_JWT_SECRET` en la API (nunca en la web).

### Variables

| Dónde | Variable                                                                              | Nota                                             |
| ----- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| API   | `SUPABASE_URL`                                                                        | Obligatoria en producción. Deriva emisor y JWKS. |
| API   | `SUPABASE_JWT_AUDIENCE` (`authenticated`), `SUPABASE_JWT_ISSUER`, `SUPABASE_JWKS_URL` | Opcionales.                                      |
| API   | `SUPABASE_JWT_SECRET`                                                                 | Solo proyectos HS256. Secreto de servidor.       |
| Web   | `NEXT_PUBLIC_AUTH_SOURCE=supabase`, `NEXT_PUBLIC_DATA_SOURCE=http`                    | La web exige ambas.                              |
| Web   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                    | Públicas. Nunca la service role.                 |

## Probar

```bash
pnpm --filter sushimon-api test && pnpm --filter sushimon-api test:e2e     # JWT, guards, endpoints (sin red)
DATABASE_URL_TEST=… pnpm --filter sushimon-api test:integration           # vinculación, concurrencia, constraints
```

Prueba manual: entrar con Google en `/backoffice/login` (admin preregistrado) y en la tienda (cliente).

## Límites conocidos

- La sesión de cliente no se revoca antes de `exp` (1 h por defecto); el acceso del personal sí es inmediato.
- La vinculación de empleados solo se registra en el log (`auth_user_id`); la auditoría persistente llega con su slice.
- El rate limit es por instancia (ver `docs/api/foundations.md`); no hay límite específico para `/auth/*` aún.
- `StaffSessionBridge` copia al shell el personal autorizado por el servidor mientras las pantallas del backoffice no
  lean el contexto real; con varias sucursales muestra la primera.
- Las secciones de cuenta (pedidos, direcciones, favoritos) siguen siendo mock: con auth real la cuenta muestra solo el
  perfil de `/v1/me`. El `GET /v1/me` del mock devuelve aún el `Customer` borrador; se unifica en el slice de cuenta.
