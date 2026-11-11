# ADR-0003 ORM / acceso a datos

**Estado**: **propuesta** (pendiente de decisión)

**Contexto**: Supabase PostgreSQL con esquema `app` y RLS. Prisma es el candidato preferido.
**Hallazgo (2026-11-11)**: el dist-tag `latest` de `prisma` en npm apuntaba a un RC (8.0.0-rc.33) mientras `@prisma/client` estable era 7.10.1; no se instaló nada para evitar fijar una versión inestable o desalineada.
**Decisión pendiente**: confirmar versión estable y compatibilidad con Supabase (pooler, esquema `app`, migraciones SQL con CHECK/índices parciales que el DBML no expresa) en el primer slice con base de datos. No instalar varios ORMs.
