import { defineConfig } from 'vitest/config';

/** Pruebas contra PostgreSQL real. Requieren DATABASE_URL_TEST (p. ej. el servicio de CI o Docker local). */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.int-spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
