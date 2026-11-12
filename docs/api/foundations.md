# Fundamentos de la API (F00)

Estado: **implementado y verificado** con PostgreSQL real local/CI. **No verificado** contra Supabase real.

## Ejecutar

```bash
cp sushimon-api/.env.example sushimon-api/.env      # completar DATABASE_URL si se quiere BD
pnpm install                                         # postinstall genera el cliente Prisma
pnpm dev:api                                         # http://localhost:3001/v1/health
```

Sin `DATABASE_URL` la API arranca (liveness OK) y `/v1/health/ready` responde 503.

## Base de datos

| Variable                                | Uso                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`                          | Runtime. Transaction pooler de Supabase (6543, `pgbouncer=true`).                         |
| `DIRECT_URL`                            | Solo `prisma migrate` (5432, directa/session pooler).                                     |
| `DB_POOL_MAX` (3)                       | Conexiones por instancia; en serverless cada instancia abre su pool → mantenerlo pequeño. |
| `DB_CONNECTION_TIMEOUT_MS`, `DB_IDLE_*` | Fallar rápido y liberar conexiones ociosas.                                               |

Migraciones: `DIRECT_URL=… pnpm --filter sushimon-api db:migrate:deploy`. **No se aplican a Supabase sin
autorización.** Prueba local: `docker run -e POSTGRES_PASSWORD=… -p 55432:5432 postgres:17-alpine` y
`DATABASE_URL_TEST=postgresql://postgres:…@127.0.0.1:55432/postgres pnpm --filter sushimon-api test:integration`.

## Errores

`{ statusCode, error, message, requestId?, details? }`. 400 de validación → `message: "Solicitud inválida"` +
`details[]`. 5xx → mensaje genérico (la causa va solo al log con el `requestId`). 429 por rate limit.
`X-Request-Id` viaja en toda respuesta y está expuesto a CORS.

## Seguridad transversal

CORS por lista (`CORS_ORIGINS`, sin `*` en producción) · `helmet` · rate limit global por IP
(`RATE_LIMIT_TTL_MS`/`RATE_LIMIT_MAX`; **por instancia**, no global exacto en serverless) · `TRUST_PROXY_HOPS`
para IP real tras proxy · `/health/ready` con `x-health-token` comparado en tiempo constante.

## Supabase local (recomendado para desarrollar)

Requiere Docker. La CLI es una devDependency (`supabase`); la configuración está en `supabase/config.toml`
(puertos 54341–54349 para no chocar con otros proyectos Supabase locales; sin realtime, storage ni analytics;
pooler de transacciones activo para imitar producción).

1. `pnpm db:local:start` (la primera vez descarga varios GB de imágenes).
2. Crear `sushimon-api/.env` con los valores del bloque «Supabase LOCAL» de `.env.example`
   (`DATABASE_URL` por el pooler 54349, `DIRECT_URL` directa 54342) y un `HEALTH_READY_TOKEN`.
3. `pnpm db:local:migrate` con las variables cargadas (crea el esquema `app`; requiere aprobación humana).
4. `pnpm dev:api` y `curl -H "x-health-token: <token>" localhost:3001/v1/health/ready`.
5. `pnpm db:local:stop` al terminar.

Studio <http://127.0.0.1:54343> · API <http://127.0.0.1:54341> · Mailpit <http://127.0.0.1:54344>.
Las migraciones de la aplicación viven en `sushimon-api/prisma/migrations` (Prisma); `supabase/migrations`
queda vacío a propósito para no tener dos fuentes de verdad.

## Pendiente

Supabase real (credenciales + autorización), logging JSON/observabilidad, rate limit distribuido, auth.
