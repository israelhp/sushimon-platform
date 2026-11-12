# ADR-0009 Identidad: Supabase Auth como única fuente; vinculación de empleados

**Estado**: **aceptada** (2026-11-12, F01).

**Contexto**: clientes y empleados inician sesión con Google. No se desarrollan contraseñas ni sesiones propias.
El DBML define `app.customers.auth_user_id` (único, nullable) y `app.staff_users.auth_user_id` (**NOT NULL**, único).

**Decisión**

1. **Una identidad**: `auth.users.id` (claim `sub`) es el identificador único. El mismo UUID puede tener una fila en
   `customers` y otra en `staff_users`.
2. **Autenticación ≠ autorización**. El JWT solo prueba _quién_ es (firma, emisor, audiencia, expiración, sujeto,
   `role=authenticated`). Roles, permisos y sucursales se leen siempre de `staff_users`/`staff_assignments` en la base
   de datos; las claims `app_metadata`/`user_metadata` **no** otorgan nada (`user_metadata` lo edita el usuario).
3. **Verificación en NestJS** con `jose`: claves asimétricas (ES256/RS256) desde el JWKS de Supabase; HS256 solo si se
   configura `SUPABASE_JWT_SECRET` (proyectos heredados). Nunca `none`. Guard global: denegar por defecto, `@Public()`
   para excepciones.
4. **Brecha `staff_users.auth_user_id`** — desviación del DBML: la columna pasa a **NULLABLE** (único cuando no es
   nulo). Un administrador preregistra al empleado (correo en minúsculas, rol y sucursal) **antes** de que exista su
   cuenta de Auth. En el **primer acceso** se vincula con un `UPDATE … WHERE email = $1 AND auth_user_id IS NULL AND
active` (atómico, una sola vez) y solo si la sesión nació de **OAuth con Google** (`app_metadata.provider = google` y
   `amr` con método `oauth`). Dos cuentas con el mismo correo compiten y gana una (probado). Sin fila preregistrada no
   hay acceso: **nunca se crea personal automáticamente**.
5. **Cliente**: se crea de forma perezosa e idempotente en `GET /v1/me` (nombre desde las claims, solo como dato
   inicial). El backoffice usa `GET /v1/auth/context`, que no crea clientes.
6. **Primer administrador**: proceso manual controlado (`pnpm --filter sushimon-api staff:bootstrap`), que preregistra un
   administrador por correo; el vínculo ocurre en su primer login con Google.
7. **RLS**: las tablas de identidad llevan RLS activado sin políticas; la API accede con el rol de servicio de la conexión
   Prisma. Nada de `app` se expone por PostgREST.

**Riesgos y mitigaciones**

- Toma de cuenta por correo: se exige sesión OAuth Google (correo verificado por Google); en producción hay que
  **desactivar el proveedor Email** de Supabase y dejar solo Google, o un tercero podría registrar un correo ajeno.
- Revocación: el acceso del personal se evalúa en cada solicitud desde la base de datos; desactivar `active` corta el
  acceso de inmediato aunque el JWT siga vigente (hasta 1 h). La sesión de cliente no se revoca antes de `exp`.
- Falta de auditoría persistente del vínculo (hoy solo log con `auth_user_id`): se añade con el slice de auditoría.

**Alternativas descartadas**: mantener `NOT NULL` (obliga a crear antes el usuario en Auth con la Admin API y la
service-role key en el backend); vincular por correo sin exigir OAuth (inseguro); leer el rol del JWT (editable/obsoleto).
