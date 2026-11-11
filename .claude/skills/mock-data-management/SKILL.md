---
name: mock-data-management
description: 'Fixtures, factories y escenarios deterministas, y el adaptador mock/http. Úsala al crear o cambiar datos simulados.'
---

# Mock Data

Estructura: `sushimon-web/src/mocks/{fixtures,factories,scenarios,handlers}` + `lib/data-access`.

- Fixtures tipadas con `@sushimon/contracts`; factories con semilla (determinismo).
- Escenarios: default, empty, loading, error, request-rejected, offline, forbidden, promotion-expired,
  branch-closed, product-unavailable, order-pending, payment-rejected, rider-unavailable.
- Selección por `NEXT_PUBLIC_MOCK_SCENARIO`; fuente por `NEXT_PUBLIC_DATA_SOURCE`.
- MSW solo si aporta (contract tests/simulación HTTP); un adaptador simple basta por defecto.
- Sin fallback silencioso a mock en producción (`resolveDataSource` lo impide).
