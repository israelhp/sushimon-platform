import { defineConfig } from 'prisma/config';

/**
 * Prisma 7: la URL ya no vive en schema.prisma.
 * - Migraciones (`prisma migrate`): usan DIRECT_URL (conexión directa o session pooler, puerto 5432).
 *   Nunca el transaction pooler (6543), que no soporta los comandos de migración.
 * - Runtime (PrismaService): usa DATABASE_URL (transaction pooler) a través de @prisma/adapter-pg.
 * Los valores vienen del entorno; no hay credenciales en el repositorio.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'] ?? '' },
});
