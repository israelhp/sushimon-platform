---
paths:
  - 'sushimon-web/src/mocks/**'
  - 'sushimon-web/src/lib/data-access/**'
  - 'docs/ui/**'
---

# Reglas: ui-mock-data

- Fixtures deterministas (sin `Date.now()`/`Math.random()` sin semilla), tipadas con contratos.
- Escenarios obligatorios: ver `src/mocks/scenarios/index.ts`.
- Prohibido fallback silencioso a mock en producción; simulaciones rotuladas visualmente.
- Sin llamadas reales a Supabase, PedidosYa ni Neonet en la fase UI First.
