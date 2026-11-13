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
- Sin llamadas reales a Supabase, PedidosYa ni Neonet en la fase UI First. Desde F01, Supabase Auth real es
  opt-in (`NEXT_PUBLIC_AUTH_SOURCE=supabase`, exige `DATA_SOURCE=http`); por defecto sigue la sesión de demostración.
