# Estrategia de Mock Data

Objetivo: construir ambas UIs sin red externa y migrar a la API real **sin reescribir pantallas** (ADR-0008).

```text
UI / Components → features/<dominio>/hooks.ts (TanStack Query) → services/*.ts → lib/data-access (DataClient)
                                                                                   ├─ mock: mocks/handlers → MockStore
                                                                                   └─ http: API NestJS (/v1)
```

## Estado (Etapa 1)

| Pieza                                                                                      | Estado                       |
| ------------------------------------------------------------------------------------------ | ---------------------------- |
| `resolveDataSource` sin fallback silencioso (`config.ts`)                                  | ✅ implementado (Etapa 0)    |
| Esquemas draft en `openapi.yaml` (`components/schemas`, `x-status: draft`) + tipos         | ✅ implementado              |
| `DataClient`, `ApiError`, `paths.ts`, adaptadores http y mock, `DataProvider`              | ✅ implementado              |
| MockStore + reloj + PRNG + fixtures conciliadas + handlers de todas las rutas + escenarios | ✅ implementado              |
| Services, hooks (TanStack Query), query keys                                               | ✅ implementado              |
| Carrito, modo de pedido, sesión de demostración (cliente y personal)                       | ✅ implementado (simulado)   |
| Prueba de paridad mock ↔ http (`lib/data-access/parity.test.ts`)                           | ✅ implementado              |
| Endpoints reales en la API                                                                 | 📐 Etapa 2/3 (slice a slice) |
| PedidosYa / NeoNet reales                                                                  | ⏳ pendiente de proveedor    |

## Estructura

```text
src/lib/data-access/   types · errors · paths · models (alias del contrato) · config · http-client · mock-client · provider
src/lib/               order-status (máquina única + mapeos UI) · schedule · time · permissions · demo-session · persisted-store
src/mocks/
  clock.ts             reloj inyectable (fecha base fija) — único lugar que lee la hora real
  factories/random.ts  mulberry32 + hash de semilla
  factories/history.ts historial determinista de 60 días (genDay del backoffice)
  fixtures/            store · branches · products (29) · promotions · staff · orders
  seed.ts              createSeedStore(scenario)
  store.ts             tipo MockStore + persistencia en sessionStorage (clave sushimon-mock-store-v1:<escenario>)
  domain.ts            reglas puras (cobertura, totales, validaciones, fail())
  handlers/            public · orders · account · backoffice · backoffice-admin · logistics · index (mockRoutes)
  index.ts             createMockDataClient({ scenario, latencyMs?, store?, clock?, session?, persist? })
  testing.ts           createHarness() para pruebas
src/services/          store · orders · account · backoffice-orders · backoffice-admin
src/features/          query-keys · <dominio>/hooks.ts · cart/ · order-mode/ · session/ · account/reorder.ts
```

## Determinismo

- **Reloj**: fecha base `2026-11-11T20:25:00Z` = miércoles 11/11/2026 14:25 en Guatemala (UTC−6). En pruebas,
  `createFixedClock()`; en el navegador, fecha base + tiempo real transcurrido desde que empezó la pestaña. La UI debe
  usar `StoreConfig.serverTime` (no `new Date()`) para horarios.
- **PRNG**: `mulberry32(hashSeed("fecha|sucursal|n"))`. Ninguna fixture usa `Math.random()`/`Date.now()`.
- **Historial**: los días pasados no se guardan; `generateDayOrders(fecha, hoy)` los regenera idénticos. Solo los
  pedidos "vivos" (hoy + cliente demo + creados en la sesión) viven en el store.
- **Store**: una instancia por pestaña y escenario, compartida por tienda y backoffice (FR-011), persistida en
  `sessionStorage` tras cada escritura; SSR-safe.

## Conciliación de datos entre prototipos

- **Catálogo canónico = tienda**: 29 productos, 6 categorías de productos + `happy` (acceso a Happy Hour,
  `kind: happy_hour`). `all` es solo una pestaña de UI. Las 6 categorías del backoffice se descartan.
- **Productos del backoffice → canónicos** (para pedidos sembrados e historial): p1 california-roll · p2 salomon-roll ·
  p3 dynamita-roll · p4 mulato-roll · p5 cayibel-roll · p6 acevichado-roll · p7 la-suegra-roll · p8 platanito-roll ·
  p9 alaska-roll · p10 joselito-roll · p11 dumplings · p12 poporopos-cangrejo · p13 loco-ribs · p14 te-lipton ·
  p15 licuado-sandia · p16 gaseosas · p17 helados-asiaticos · p18 licuado-melon. Disponibilidad: joselito-roll sin
  stock en sucursal-3 y gaseosas en sucursal-2 (p10/p16 del prototipo).
- **Sucursales**: `sucursal-1..3` (ids y cobertura de la tienda) = `s1..s3` del backoffice (zona, dirección, horario,
  teléfono y radio). `sucursal-4/5` = `coming_soon`. Precio de envío siempre por cobertura (near 15 · mid 20 ·
  extended 25 · far 30). Direcciones sembradas de sucursal-3 fuera de su cobertura canónica se reubicaron.
- **Pedidos**: 15 del backoffice (SM-7044…7058 → MON-307044…307058, 13:10–14:22) + 3 de la tienda (MON-490217,
  MON-482193, MON-479850). Historial generado MON-3xxxxx (hoy hasta MON-307043); nuevos desde MON-307059.
  Envíos y totales se recalculan con el catálogo canónico (p. ej., MON-490217 = Q173 + Q15 = Q188).
- **Promociones**: las 3 del backoffice; "Happy Hour 2x1" es la misma del Happy Hour de la tienda y lleva sus 8 ítems.
- **Personal**: 8 usuarios; roles `admin`, `manager` (encargado), `kitchen` (cocina). Demo por rol: u1/u2/u5.
- **Estados** (contrato, en inglés): pedido, pago y entrega separados. Mapeos para la UI en `lib/order-status.ts`:
  `toStoreOrderState`, `toStoreTrackingStep`, `toBackofficeColumn`, `toBackofficeLogistics`, `nextBackofficeAction`.

## Escenarios (`NEXT_PUBLIC_MOCK_SCENARIO`)

| Escenario             | Dónde se aplica | Efecto                                                                             |
| --------------------- | --------------- | ---------------------------------------------------------------------------------- |
| `default`             | —               | datos cargados                                                                     |
| `loading`             | mock-client     | ninguna solicitud resuelve                                                         |
| `error`               | mock-client     | 500 en todo                                                                        |
| `offline`             | mock-client     | `ApiError` status 0                                                                |
| `forbidden`           | mock-client     | 403 en `/v1/backoffice/*`                                                          |
| `request-rejected`    | mock-client     | 422 en toda escritura                                                              |
| `empty`               | seed            | sin categorías, productos, promociones, pedidos, historial ni datos de cuenta      |
| `promotion-expired`   | seed            | promociones vencidas ayer (`status: expired`)                                      |
| `branch-closed`       | seed            | sucursales con `isOpen: false`: "ahora" → 409; programado sí                       |
| `product-unavailable` | seed            | Calientito Roll y Platanito Roll no disponibles                                    |
| `order-pending`       | seed + handler  | MON-490217 y los pagos aprobados quedan `review` (no se confirman)                 |
| `payment-rejected`    | handler         | toda tarjeta → `declined`                                                          |
| `rider-unavailable`   | handler         | la búsqueda de PedidosYa pasa a `failed`; se puede despachar con repartidor propio |

## Reglas

1. Fixtures tipadas con `@sushimon/contracts` (vía `lib/data-access/models.ts`); factories con semilla fija.
2. Nada de arreglos gigantes en componentes: los datos viven en `mocks/fixtures`.
3. Simulaciones de PedidosYa/NeoNet y rutas `/v1/demo/*`: insignia **"Simulación"**; `useIsSimulation()` indica el modo.
4. `localStorage` solo preferencias (carrito `monsushi-cart-v1`, modo `monsushi-order-mode-v1`). La sesión de
   demostración (`monsushi-demo-session-v1`, sessionStorage) **no autoriza**: el adaptador mock la lee como lo haría el
   servidor con su cookie; con `http` la identidad la decide el servidor (Supabase Auth, Etapa 3).
5. El total de un pedido lo calcula el handler (el cliente nunca envía precios). De una tarjeta solo se guardan marca,
   últimos 4 y referencia simulada.
6. MSW: no se usa; la paridad http se prueba con un `fetch` falso.

## Cómo añadir un handler

1. Contrato: esquema draft en `openapi.yaml` (`components/schemas`, `x-status: draft`) → `pnpm contracts:generate` →
   alias en `lib/data-access/models.ts`. Ruta en `docs/contracts/planned-endpoints.md`.
2. `paths.ts`: constructor de la ruta.
3. Handler puro en `mocks/handlers/<dominio>.ts` (`(req) => resultado`); validar ANTES de mutar; errores con
   `fail(status, mensaje)`; autorización con `requireStaff(req, permiso)` / `requireCustomer(req)`.
4. Registrar `'METHOD /v1/ruta/:param'` en `mocks/handlers/index.ts`.
5. Service en `services/*.ts` y hook en `features/<dominio>/hooks.ts` (clave en `features/query-keys.ts`; invalidar
   con `invalidateOrders(qc)` si toca pedidos).
6. Pruebas: handler (`createHarness()`) y, si es nuevo flujo, un paso en `parity.test.ts`.

## Cómo añadir un escenario

1. Agregar el nombre a `mocks/scenarios/index.ts` (lo valida `resolveDataSource`).
2. Aplicarlo en `seed.ts` (datos) o en el handler (`req.scenario`), o en `mock-client.ts` si es transversal.
3. Prueba en `seed.test.ts` o en la prueba del handler; documentarlo en la tabla de arriba.
