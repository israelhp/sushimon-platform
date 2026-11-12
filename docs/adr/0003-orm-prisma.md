# ADR-0003 ORM / acceso a datos: Prisma 7

**Estado**: **aceptada** (2026-11-12, F00). Reemplaza la propuesta anterior.

**Contexto**: Supabase PostgreSQL con esquema `app` y RLS; API NestJS desplegable en serverless; el DBML es la línea
base relacional y contiene CHECK/índices parciales que Prisma no expresa.

**Decisión**:

- **Prisma `7.10.1`** (versión estable fijada; el dist-tag `latest` de npm apunta a un RC 8.0, que no se usa).
  `@prisma/client` y `@prisma/adapter-pg` en la misma versión exacta que `prisma`.
- **Driver adapter `pg`** (`@prisma/adapter-pg`): sin binarios de motor, pool de `node-postgres` controlado por la
  aplicación (`DB_POOL_MAX`, timeouts) y compatible con serverless.
- **Dos URLs**: `DATABASE_URL` (transaction pooler de Supabase, 6543, `pgbouncer=true`) para el runtime;
  `DIRECT_URL` (directa/session pooler, 5432) solo para migraciones (`prisma.config.ts`). El pooler de
  transacciones no soporta `prisma migrate`.
- **Esquema `app`**: `datasource.schemas = ["app"]`; cada modelo lleva `@@schema("app")`. La migración `0001`
  crea el esquema.
- **Migraciones SQL escritas a mano** cuando haga falta (CHECK, índices parciales, RLS, triggers); Prisma las
  versiona en `prisma/migrations`. Toda migración la revisa `database-engineer` y no se aplica a Supabase sin
  autorización explícita.
- Cliente generado en `src/generated/prisma` (ignorado por Git; se genera en `postinstall` y `build`).
- `$queryRaw` solo con plantillas etiquetadas (parametrizadas); nunca `$queryRawUnsafe` con entrada del usuario.

**Consecuencias**: un solo ORM (no instalar otros). Modelos se añaden por vertical slice desde el DBML, con
pruebas de integración contra PostgreSQL real (`test:integration`). Si Supabase exige SSL con certificado propio,
se ajusta el `ssl` del adaptador en `PrismaService` (no probado contra Supabase real: sin credenciales en F00).
