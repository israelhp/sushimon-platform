# Autenticación y autorización (F01)

Estado: **API y web implementadas y probadas** con tokens ES256 reales de Supabase Auth local. **No verificado**: el
viaje de ida y vuelta con Google (requiere credenciales de Google Cloud) ni un proyecto Supabase en la nube.

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
  `role = authenticated`. `@RequireStaff('permiso')` exige personal activo con ese permiso.

```
Navegador ──Google OAuth (PKCE)──▶ Supabase Auth ──code──▶ /auth/callback (Next) ──cookies──▶ sesión
Navegador ──Bearer JWT──▶ API ──JWKS (caché)──▶ verifica ──▶ IdentityService ──▶ PostgreSQL (app.*)
```

## Endpoints

| Ruta                    | Uso                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/auth/context`  | Identidad + si es personal activo (roles, permisos, sucursales) y `backofficeAccess`. No crea cliente.             |
| `GET /v1/me`            | Perfil de cliente; lo crea de forma idempotente en el primer acceso.                                               |
| `401`                   | Token ausente/ inválido/ expirado/ de otro emisor o audiencia: mismo mensaje, motivo solo en el log con requestId. |
| `403` (`@RequireStaff`) | No es personal activo o falta el permiso: mismo mensaje en ambos casos.                                            |

## Primer acceso de un empleado (brecha `staff_users.auth_user_id`)

`auth_user_id` es **nullable** (ADR-0009). Un administrador preregistra al empleado por correo (minúsculas) con rol y
sucursal; en su **primer inicio de sesión con Google** la API ejecuta un `UPDATE … WHERE email = $1 AND auth_user_id IS NULL
AND active` atómico y lo vincula. Condiciones: sesión de OAuth con Google (`app_metadata.provider = google` y `amr`
`oauth`), fila activa y sin vincular. Sin preregistro no hay acceso; nunca se crea personal automáticamente.

### Primer administrador (proceso manual controlado)

```bash
# DATABASE_URL (o DIRECT_URL) en el entorno; no se pasa como argumento
pnpm --filter sushimon-api staff:bootstrap -- --email persona@dominio.com --name "Nombre Apellido"
```

Crea o reactiva la fila y la asignación `admin` (todas las sucursales). Quien tenga ese correo queda vinculado al
iniciar sesión con Google. Idempotente. Ejecutarlo contra producción requiere autorización explícita.

## Configuración

### Google Cloud Console

1. APIs y servicios → Credenciales → **ID de cliente OAuth** (aplicación web).
2. **URI de redireccionamiento autorizado**: `https://<ref>.supabase.co/auth/v1/callback` (nube) y
   `http://127.0.0.1:54341/auth/v1/callback` (local).
3. Guardar `client_id` y `secret`. **Nunca** al repositorio.

### Supabase (nube: Authentication)

- **Providers**: activar **Google** con el `client_id`/`secret`; **desactivar Email** (si no, un tercero podría registrar
  un correo ajeno y reclamar un puesto preregistrado) y no habilitar sign-ins anónimos.
- **URL Configuration**: _Site URL_ = URL pública de la web; _Redirect URLs_ = `https://<dominio>/auth/callback`.
- **JWT signing keys**: usar claves asimétricas (ES256). Con un proyecto heredado HS256, configurar
  `SUPABASE_JWT_SECRET` en la API (nunca en la web).

### Local

`supabase/config.toml` trae `[auth.external.google]` con `enabled = false`. Para probar Google en local:
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` y `…_SECRET` en `supabase/.env` (no versionado), poner `enabled = true` y
`pnpm db:local:stop && pnpm db:local:start`.

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
pnpm db:local:start && pnpm --filter sushimon-api build && pnpm --filter sushimon-api smoke:auth:local
```

`smoke:auth:local` crea un usuario en Supabase Auth local, obtiene un JWT ES256 **real** y lo valida contra la API.

## Límites conocidos

- La sesión de cliente no se revoca antes de `exp` (1 h por defecto); el acceso del personal sí es inmediato.
- La vinculación de empleados solo se registra en el log (`auth_user_id`); la auditoría persistente llega con su slice.
- El rate limit es por instancia (ver `docs/api/foundations.md`); no hay límite específico para `/auth/*` aún.
- `StaffSessionBridge` copia al shell el personal autorizado por el servidor mientras las pantallas del backoffice no
  lean el contexto real; con varias sucursales muestra la primera.
- Las secciones de cuenta (pedidos, direcciones, favoritos) siguen siendo mock: con auth real la cuenta muestra solo el
  perfil de `/v1/me`. El `GET /v1/me` del mock devuelve aún el `Customer` borrador; se unifica en el slice de cuenta.
