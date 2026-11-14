import { defineConfig } from 'prisma/config';

/**
 * Prisma 7: la URL ya no vive en schema.prisma.
 * - Migraciones (`prisma migrate`): usan DIRECT_URL (conexión directa o session pooler, puerto 5432).
 *   Nunca el transaction pooler (6543), que no soporta los comandos de migración.
 * - Runtime (PrismaService): usa DATABASE_URL (transaction pooler) a través de @prisma/adapter-pg.
 * Los valores vienen del entorno; no hay credenciales en el repositorio.
 */
// Prisma 7 ya no carga `.env` por sí mismo: se carga aquí (Node >= 20.12) sin pisar variables ya definidas
// (CI y producción las inyectan por entorno). Si no existe `.env`, se ignora.
try {
  process.loadEnvFile('.env');
} catch {
  /* sin .env: se usa el entorno del proceso */
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'] ?? '' },
});
