import { defineConfig } from 'vitest/config';

// DATABASE_URL_TEST puede vivir en sushimon-api/.env (no pisa variables ya definidas).
try {
  process.loadEnvFile('.env');
} catch {
  /* sin .env */
}

/** Pruebas contra PostgreSQL real. Requieren DATABASE_URL_TEST (servicio de CI, un PostgreSQL desechable o el proyecto Supabase de pruebas, con la conexión directa/session pooler 5432). */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.int-spec.ts'],
    // Comparten una sola base de datos: los archivos se ejecutan en serie.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
