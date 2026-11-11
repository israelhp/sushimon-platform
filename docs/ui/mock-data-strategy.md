# Estrategia de Mock Data

Objetivo: construir ambas UIs sin red externa y migrar a la API real **sin reescribir pantallas**.

```text
UI / Components → Features / Hooks → Services (queries) → lib/data-access (DataClient)
                                                              ├─ mock adapter → fixtures/factories/scenarios
                                                              └─ http adapter → API NestJS (/v1)
```

## Estado actual (✅ implementado en el bootstrap)

- `resolveDataSource(env)` (`lib/data-access/config.ts`): `NEXT_PUBLIC_DATA_SOURCE=mock|http`. Con `http` exige `NEXT_PUBLIC_API_URL`.
- **Sin fallback silencioso**: configuración inválida lanza error; en producción `mock` exige `NEXT_PUBLIC_ALLOW_MOCK_IN_PRODUCTION=true` (demos).
- Adaptador HTTP mínimo (`createHttpClient`) y catálogo de escenarios (`mocks/scenarios`). Pruebas en `config.test.ts`.
- 📐 Adaptador mock, fixtures y factories: Etapa 1.

## Escenarios (`NEXT_PUBLIC_MOCK_SCENARIO`)

`default` (cargado) · `empty` · `loading` · `error` · `request-rejected` · `offline` · `forbidden` (permiso insuficiente) ·
`promotion-expired` · `branch-closed` · `product-unavailable` · `order-pending` · `payment-rejected` · `rider-unavailable`.

## Reglas

1. Fixtures tipadas con `@sushimon/contracts`; factories con semilla fija (resultados deterministas).
2. Nada de arreglos gigantes dentro de componentes.
3. Simulaciones de PedidosYa/Neonet muestran la insignia **“Simulación”**; sin cargos ni solicitudes reales.
4. `localStorage` no es autenticación. El login del backoffice mock es una pantalla de demostración sin sesión real.
5. MSW: solo si aporta (p. ej., pruebas de contrato HTTP); un adaptador simple es el valor por defecto.
