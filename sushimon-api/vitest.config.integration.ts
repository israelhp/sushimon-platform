import { defineConfig } from 'vitest/config';

/** Pruebas contra PostgreSQL real. Requieren DATABASE_URL_TEST (p. ej. el servicio de CI o Docker local). */
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
