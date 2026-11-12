import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

/**
 * E2E de la demo UI First (datos simulados, sin red externa).
 * - `e2e`: flujos y accesibilidad (axe). Corre en CI.
 * - `visual`: comparación de capturas contra los prototipos (reporte, no gate de CI).
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // `next dev` compila rutas bajo demanda: pocos workers en CI evitan timeouts en frío.
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    locale: 'es-GT',
    timezoneId: 'America/Guatemala',
  },
  projects: [
    {
      name: 'e2e',
      testIgnore: /visual\//,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e-mobile',
      testMatch: /\.mobile\.spec\.ts$/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'visual',
      testMatch: /visual\/.*\.spec\.ts$/,
      testIgnore: /prototype-gallery/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Capturas de referencia de los prototipos, solo bajo demanda: `pnpm capture:prototypes`.
      name: 'gallery',
      testMatch: /visual\/prototype-gallery\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_DATA_SOURCE: 'mock',
      NEXT_PUBLIC_MOCK_SCENARIO: 'default',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
