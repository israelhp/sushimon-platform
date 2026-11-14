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

## Entorno de pruebas: Supabase en la nube

No se usa Supabase local (se retiró la CLI y `supabase/`). El entorno de desarrollo y pruebas es un proyecto
Supabase gratuito, separado de producción.

1. En Supabase → Connect → ORM → Prisma, copiar `DATABASE_URL` (pooler de transacciones, 6543) y `DIRECT_URL`
   (pooler de sesión, 5432) a `sushimon-api/.env` (sin corchetes; codificar caracteres especiales de la clave),
   más `SUPABASE_URL` y un `HEALTH_READY_TOKEN`.
2. `pnpm --filter sushimon-api db:migrate:deploy` desde `sushimon-api/` (requiere aprobación humana).
3. `pnpm dev:api` y `curl -H "x-health-token: <token>" localhost:3001/v1/health/ready`.

Las migraciones de la aplicación viven en `sushimon-api/prisma/migrations` (Prisma).

Pruebas de integración: `DATABASE_URL_TEST` (en `sushimon-api/.env`, misma cadena directa 5432 que `DIRECT_URL`) y
`pnpm --filter sushimon-api test:integration`. Contra este proyecto de pruebas crean datos marcados
(`@sushimon.test`, sucursales de prueba, filas mínimas en `auth.users`) y los borran al terminar; no tocan datos
reales. La prueba de PostgreSQL plano (crea otra base) se omite sola en Supabase. **Nunca** apuntar a producción.

## Pendiente

Supabase real (credenciales + autorización), logging JSON/observabilidad, rate limit distribuido, auth.
