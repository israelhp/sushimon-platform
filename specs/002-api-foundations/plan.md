# Plan — F00

Contract First: `openapi.yaml` (health, ready, `ErrorResponse` con `requestId`/`details`, esquema `health-token`)
→ `contracts:generate` → API → web. Detalle técnico en `docs/api/foundations.md` y `docs/adr/0003-orm-prisma.md`.

Decisiones: Prisma 7.10.1 + adapter `pg`; `DATABASE_URL` (pooler) vs `DIRECT_URL` (migraciones); conexión
perezosa (la API arranca sin BD); `@Inject` explícito porque `openapi:emit` usa tsx (sin metadata de decoradores).
