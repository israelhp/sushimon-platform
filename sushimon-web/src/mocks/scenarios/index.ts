/**
 * Escenarios de Mock Data (UI First). Cada escenario selecciona fixtures/factories deterministas.
 * Etapa 0: solo el catálogo de nombres; las fixtures se implementan en feature/ui-first-mock-platform.
 */
export const MOCK_SCENARIOS = [
  'default',
  'empty',
  'loading',
  'error',
  'request-rejected',
  'offline',
  'forbidden',
  'promotion-expired',
  'banners-empty',
  'branch-closed',
  'product-unavailable',
  'order-pending',
  'payment-rejected',
  'rider-unavailable',
] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export function isMockScenario(value: string): value is MockScenario {
  return (MOCK_SCENARIOS as readonly string[]).includes(value);
}
