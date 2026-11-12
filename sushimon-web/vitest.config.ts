import { defineConfig } from 'vitest/config';

// Vitest 4: `environmentMatchGlobs` ya no existe; se usan proyectos.
//  - unit: lógica pura (`*.test.ts`) en Node.
//  - dom:  componentes (`*.test.tsx`) en jsdom con matchers de Testing Library.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Cobertura de la lógica (no de la presentación): `pnpm --filter sushimon-web test:coverage`.
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/mocks/**', 'src/services/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/testing.ts', '**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
      // Medido el 2026-11-11: 88 % sentencias · 79 % ramas · 92 % funciones · 92 % líneas.
      thresholds: { statements: 80, branches: 70, functions: 85, lines: 85 },
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./src/test/setup-dom.ts'],
        },
      },
    ],
  },
});
