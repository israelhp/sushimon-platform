import { defineConfig } from 'vitest/config';

// Vitest 4: `environmentMatchGlobs` ya no existe; se usan proyectos.
//  - unit: lógica pura (`*.test.ts`) en Node.
//  - dom:  componentes (`*.test.tsx`) en jsdom con matchers de Testing Library.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
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
