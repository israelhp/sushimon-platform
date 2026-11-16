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
  fixtures/            store · branches · products (29 + 2 de demostración F11) · promotions · staff · orders · geography · delivery (F09) · categories (F10) · modifiers (F12)
  seed.ts              createSeedStore(scenario)
  store.ts             tipo MockStore + persistencia en sessionStorage (clave sushimon-mock-store-v1:<escenario>)
  domain.ts            reglas puras (totales, validaciones, fail(), failCode()/badRequest() con `code`/`violations`)
  coverage.ts          motor de cobertura F09 (OWN, PedidosYa simulado, elegibilidad A–G): réplica de la API
  handlers/            public · orders · account · backoffice · backoffice-admin · logistics · schedule · delivery (F09) · categories (F10) · products (F11) · modifiers (F12) · branch-products (F13) · media (F14) · favorites (F06) · index (mockRoutes)
  index.ts             createMockDataClient({ scenario, latencyMs?, store?, clock?, session?, persist? })
  testing.ts           createHarness() para pruebas
src/services/          store · orders · account · favorites (F06) · backoffice-orders · backoffice-admin
src/features/          query-keys · <dominio>/hooks.ts · cart/ · order-mode/ · session/ · account/reorder.ts
```

## Determinismo

- **Reloj**: fecha base `2026-11-11T20:25:00Z` = miércoles 11/11/2026 14:25 en Guatemala (UTC−6). En pruebas,
  `createFixedClock()`; en el navegador, fecha base + tiempo real transcurrido desde que empezó la pestaña. La UI debe
  usar `StoreConfig.serverTime` (no `new Date()`) para horarios. F08: la disponibilidad de una sucursal NO se calcula en
  la UI: la devuelve `GET /v1/branches/:id/availability` (en mock, el motor `mocks/branch-availability.ts` con este reloj).
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
- **Sucursales**: `sucursal-1..3` (ids y cobertura de la tienda) = `s1..s3` del backoffice (zona, dirección,
  teléfono). Horarios F08 en `fixtures/schedule.ts` (ISO 1–7, varios intervalos): sucursal-1 todos los días
  12:00–22:00; sucursal-2 con viernes hasta 24:00 y madrugada sáb/dom 00:00–01:00; sucursal-3 cierra los lunes;
  sucursal-4/5 sin horario configurado. Cierres sembrados: `cierre-1` (futuro, sucursal-1), `cierre-2` (terminado),
  `cierre-3` (futuro, sucursal-2). `sucursal-4/5` = `coming_soon`. F09: el envío ya NO usa «niveles» (near/mid/extended/far)
  ni ETA ni radio: la tarifa es el `baseFee` de la zona propia sembrada (`fixtures/delivery.ts`, 65 zonas de las
  sucursales 1–3 con tarifas Q15/Q20/Q25/Q30 como datos de demostración). Direcciones sembradas de sucursal-3 fuera de su
  cobertura canónica se reubicaron.
- **Pedidos**: 15 del backoffice (SM-7044…7058 → MON-307044…307058, 13:10–14:22) + 3 de la tienda (MON-490217,
  MON-482193, MON-479850). Historial generado MON-3xxxxx (hoy hasta MON-307043); nuevos desde MON-307059.
  Envíos y totales se recalculan con el catálogo canónico (p. ej., MON-490217 = Q173 + Q15 = Q188).
- **Promociones**: las 3 del backoffice; "Happy Hour 2x1" es la misma del Happy Hour de la tienda y lleva sus 8 ítems.
- **Personal**: 8 usuarios; roles `admin`, `manager` (encargado), `kitchen` (cocina). Demo por rol: u1/u2/u5.
- **Estados** (contrato, en inglés): pedido, pago y entrega separados. Mapeos para la UI en `lib/order-status.ts`:
  `toStoreOrderState`, `toStoreTrackingStep`, `toBackofficeColumn`, `toBackofficeLogistics`, `nextBackofficeAction`.

## Escenarios (`NEXT_PUBLIC_MOCK_SCENARIO`)

| Escenario             | Dónde se aplica | Efecto                                                                                                            |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `default`             | —               | datos cargados                                                                                                    |
| `loading`             | mock-client     | ninguna solicitud resuelve                                                                                        |
| `error`               | mock-client     | 500 en todo                                                                                                       |
| `offline`             | mock-client     | `ApiError` status 0                                                                                               |
| `forbidden`           | mock-client     | 403 en `/v1/backoffice/*`                                                                                         |
| `request-rejected`    | mock-client     | 422 en toda escritura                                                                                             |
| `empty`               | seed            | sin categorías, productos, promociones, pedidos, historial ni datos de cuenta                                     |
| `promotion-expired`   | seed            | promociones vencidas ayer (`status: expired`)                                                                     |
| `branch-closed`       | seed            | F08: cierre extraordinario EN CURSO en cada sucursal activa (`EXCEPTIONAL_CLOSURE`): "ahora" → 409; programado sí |
| `product-unavailable` | seed            | Calientito Roll y Platanito Roll no disponibles                                                                   |
| `order-pending`       | seed + handler  | MON-490217 y los pagos aprobados quedan `review` (no se confirman)                                                |
| `payment-rejected`    | handler         | toda tarjeta → `declined`                                                                                         |
| `rider-unavailable`   | handler         | la búsqueda de PedidosYa pasa a `failed`; se puede despachar con repartidor propio                                |

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

## F08 — Horarios, cierres y disponibilidad (spec 007)

Estado: **web conectada al contrato, API pendiente** (`CONTRACT_DEFINED` en la API; en la web el flujo es `MOCK_ONLY`
mientras `NEXT_PUBLIC_DATA_SOURCE=mock`). Los 8 `operationId` (`getBranchHours`, `getBranchAvailability`,
`getAdminBranchHours`, `replaceAdminBranchHours`, `listAdminBranchClosures`, `createAdminBranchClosure`,
`updateAdminBranchClosure`, `deleteAdminBranchClosure`) tienen servicio (`services/branch-schedule.ts`), hooks
(`features/branch-schedule/hooks.ts`), rutas en `lib/data-access/paths.ts` y handlers mock (`mocks/handlers/schedule.ts`).
Pasar a http no cambia pantallas.

| Pieza                                                                                           | Estado                                                                       |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Editor semanal, cierres, estado diferenciado (backoffice), horario/estado públicos, carrito     | implementado (contra el mock)                                                |
| Motor de disponibilidad (`mocks/branch-availability.ts`), `version` SHA-256, reglas 400/409/422 | simulado (emula al servidor)                                                 |
| `ErrorResponse.code` / `violations` (`ApiError.businessCode`/`violations`)                      | implementado (mock y http)                                                   |
| Motivo del cierre solo en admin; `INACTIVE` nunca por HTTP público (404)                        | implementado (mock) / lo decide la API                                       |
| Auditoría, cabeceras `Cache-Control`, UUID de cierres, EXCLUDE de solapes                       | no simulado (lo hace la API)                                                 |
| `isAcceptingOrders ≠ isOpenNow` (pausa operativa, «último pedido»)                              | bloqueado: decisión de negocio                                               |
| `StoreConfig.weeklyHours` / `openingHours` (borrador, día 0–6, pie de página)                   | MOCK_ONLY, pendiente de F17                                                  |
| Reglas de programación (paso 30 min, último pedido −30 min, 45 min de anticipación)             | MOCK_ONLY (F19/F20); usan el horario real de F08                             |
| Validación definitiva al crear el pedido                                                        | mock: `POST /v1/orders` usa el motor; real: F20 con `BranchAvailabilityPort` |

Cambios respecto a F07: `Branch` (vista operativa simulada de cobertura) ya no trae `hours`, `hoursLabel`, `isOpen` ni
`openNow`; el interruptor `isOpen` y `PATCH /v1/demo/branches/:id/operations` con `hours`/`isOpen` desaparecen.
`BranchHours`/`BranchAvailability` en `models.ts` son ahora los esquemas reales; los borradores quedan como
`DraftBranchHours` (solo `StoreConfig`/`Branch` del contrato) y `ProductBranchAvailability` (catálogo).

Convenciones: `weekday` ISO 1–7 (nunca `getDay`; el único punto de conversión del navegador es
`lib/time.ts#browserDateIsoWeekday`), horas locales de America/Guatemala, instantes ISO UTC con `Z`; los formularios de
cierres usan `datetime-local` en hora de Guatemala y envían UTC. Refetch de la disponibilidad en `nextTransitionAt`
(tope 10 min) y al enfocar la ventana; sin polling por segundo.

## F09 — Geografía, zonas propias y cobertura (spec 008, ADR-0013)

Estado: **web conectada al contrato; API implementada y commiteada, integración http real NO verificada** (en la web el
flujo es `MOCK_ONLY` mientras `NEXT_PUBLIC_DATA_SOURCE=mock`). Las 10 operaciones (`listLocationDepartments`,
`listLocationMunicipalities`, `listAdminDeliveryZones`, `createAdminDeliveryZone`, `getAdminDeliveryZone`,
`updateAdminDeliveryZone`, `updateAdminDeliveryZoneStatus`, `getAdminBranchDeliverySettings`,
`updateAdminBranchDeliverySettings`, `checkDeliveryCoverage`) tienen servicio (`services/locations.ts`,
`services/delivery-zones.ts`, `services/delivery-coverage.ts`), hooks (`features/delivery-coverage/hooks.ts`), rutas en
`lib/data-access/paths.ts` y handlers mock (`mocks/handlers/delivery.ts` + `mocks/coverage.ts`).

| Pieza                                                                                                                         | Estado                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Backoffice: proveedores por sucursal (interruptores con confirmación) y zonas propias (CRUD sin borrado, filtros, paginación) | implementado (contra el mock)                                                                                                                 |
| Tienda: departamento → municipio → «Zona N», comprobación al completar la selección, mensajes CONFIRMED/PENDING/NONE          | implementado (contra el mock)                                                                                                                 |
| Catálogos: 22 departamentos y SOLO los 17 municipios de Guatemala (igual que la migración 0007)                               | simulado coherente con el seed real; resto pendiente de fuente oficial                                                                        |
| Normalización D6, unicidad con `zone_key`, prioridad específica > general, `baseFee` string, 409/422/400, `version`           | simulado (emula al servidor)                                                                                                                  |
| Elegibilidad `CONFIRMED/PENDING/NONE` (escenarios A–G)                                                                        | simulado: la deriva el «servidor»; el cliente no la recalcula                                                                                 |
| PedidosYa                                                                                                                     | `UNKNOWN` + `BLOCKED_EXTERNAL` por defecto; solo el selector de demostración (mock) devuelve `AVAILABLE`/`UNAVAILABLE` con `MOCK`/`simulated` |
| Auditoría, `Cache-Control`, UUID, alcance real por JWT/aal2                                                                   | no simulado (lo hace la API)                                                                                                                  |
| Checkout/pedidos reales con cobertura y tarifa congelada                                                                      | pendiente (F19/F20); el mock de `POST /v1/orders` usa la tarifa de la zona                                                                    |
| PedidosYa real (cobertura, cotización, ETA)                                                                                   | `BLOCKED_EXTERNAL` (F29)                                                                                                                      |

Retirado: `GET /v1/delivery/quote` y `useDeliveryQuote` (tiers 15/20/25/30 y ETA inventados), `radiusKm`/`coverage`/
`coverageLabels` como fuente de cobertura (se emiten vacíos solo porque el borrador `Branch` del contrato aún los exige),
`StoreConfig.departments`/`deliveryTiers` (se emiten vacíos por el mismo motivo), `PATCH /v1/demo/branches/:id/operations` y
`coveringBranch`. `Order.deliveryTier` queda `null` en el mock. Las instantáneas de pedidos sembrados usan el `baseFee` de la zona.

Seed del mock: sucursales 1–3 con `ownDeliveryZonesEnabled=true` y `pedidosyaEnabled=true`; sucursales 4–5 sin fila (= defaults
de la API: propia apagada, PedidosYa habilitado, `isDefault=true`). Con PedidosYa habilitado y sin zona propia, un domicilio
queda `PENDING` («no podemos confirmar»), nunca «sin cobertura»; `NONE` solo aparece con PedidosYa deshabilitado.

Claves TanStack: `locations.departments()` / `.municipalities(id)` (≥ 1 h, nunca se invalidan), `deliveryZones.admin(filters)` /
`.detail(id)`, `deliverySettings.branch(id)`, `deliveryCoverage.check(branch, municipio, zona)` (30 s, sin refetch por foco).
Tras guardar una zona se invalidan las listas, su detalle y la cobertura de ESA sucursal; tras cambiar la configuración, la de
la sucursal y su cobertura. La etiqueta de zona de la tienda (`Zona 10`) es la misma que escribe el backoffice (`lib/delivery-zone.ts`).

## F06 — Favoritos del cliente (spec 010, ADR-0015)

Estado: **web `MOCK_ONLY`, alineada al contrato; API implementada y commiteada (catálogo `BLOCKED` por F11, dependencia interna)**. El
flujo real de extremo a extremo NO existe hasta F11: sin catálogo la API responde `503 CATALOG_UNAVAILABLE` al marcar y `UNKNOWN` al
listar, y `NEXT_PUBLIC_DATA_SOURCE=http` rompería también menú y carrito (no hay catálogo `http`). Operaciones: `listMyFavorites`,
`addMyFavorite`, `removeMyFavorite` → `services/favorites.ts`, `features/favorites/hooks.ts`, `mocks/handlers/favorites.ts`.

| Pieza                                                                                                                                              | Estado                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET` con `favoriteProductIds` completos + página (`pageSize=0` ⇒ solo ids), `limit`, `catalogStatus`; 400 de forma                                | simulado (emula al servidor)                                                                             |
| `PUT`/`DELETE` idempotentes (204), 404 `PRODUCT_NOT_FOUND`, 422 `FAVORITES_LIMIT_REACHED` (200), 503 `CATALOG_UNAVAILABLE`, aislamiento por cuenta | simulado; estado `ACTIVE/INACTIVE/UNAVAILABLE/REMOVED/UNKNOWN` derivado del catálogo mock                |
| Escenario "catálogo no disponible"                                                                                                                 | `MockStore.favoritesCatalog = 'unavailable'` (pruebas y e2e); la API real lo está hasta F11              |
| 503 `FAVORITES_BUSY` (candado/tiempo agotados, reintentable)                                                                                       | simulado de forma determinista con `MockStore.favoritesBusy` (nº de altas que fallan antes de funcionar) |
| 429 `RATE_LIMITED`, `Cache-Control`, UUID de producto, throttle por IP                                                                             | no simulado (lo hace la API); en MOCK_ONLY el id es el **slug** y se valida por existencia               |
| Mis favoritos: unión con `useProducts()` (precio solo del catálogo), filas seguras para no disponible/retirado/`UNKNOWN`, quitar                   | implementado (contra el mock); imagen del resumen NO se pinta (requiere `remotePatterns`, F11)           |
| "Agregar al carrito" desde favoritos                                                                                                               | reutiliza `ProductCard` (carrito local mock); el carrito real es F18                                     |
| Favoritos locales de invitado                                                                                                                      | **descartado** (D14): el corazón del visitante abre el login y no crea nada                              |

Claves TanStack con la identidad en la raíz (`queryKeys.customer.favorites.*`): `['customer', scope, 'favorites', 'ids'|'list', page]`,
`scope` = id de Supabase Auth o `demo:<correo>`. UN solo query de `ids` (`staleTime` 5 min: las mutaciones propias ya lo actualizan; los cambios desde OTRO dispositivo aparecen en el
siguiente refetch o montaje en frío) observado por `FavoritesProvider` (un observer, una mutación y un lector de identidad para toda la
tienda); cada `FavoriteButton` se suscribe solo a SU producto (`useIsFavorite`/`useIsFavoritePending`, `useSyncExternalStore`), así que
marcar A no re-renderiza B (test con `Profiler`). El contador de Mi cuenta/Más usa `useFavoriteIds`; Mis favoritos usa `list(page)` (30 s) y siembra `ids` con la misma respuesta. `CustomerCacheGuard`
(`features/session/customer-scope.tsx`; además `signOut` limpia `['customer']` explícitamente) descarta las claves `['customer', otraIdentidad]` al cerrar sesión o cambiar de cuenta. Mutación
optimista: `cancelQueries`, rollback SOLO del producto afectado, sin doble envío por producto (`aria-busy`/`aria-disabled`), invalidación
de `ids` y listas solo al terminar la última mutación en vuelo. Errores por `code` (`features/favorites/errors.ts`), nunca por `message`.

Retirado: `queryKeys.account.favorites`, `useFavorites`, los favoritos `string[]` del store/handler y el texto "se guardan en este
dispositivo" (`fav.guestNote`). `MOCK_STORE_VERSION` sube a 6 (los favoritos pasan a `{ productId, addedAt }`; los stores persistidos
anteriores se descartan y se vuelven a sembrar). `home/favorites-section.tsx` es una selección editorial (`featured`), NO los favoritos del cliente.

## F10 — Categorías y jerarquía del menú (spec 011, ADR-0016)

Estado: **web conectada al contrato; API de F10 implementada en la misma rama, integración http real NO verificada** (en la web el
flujo es `MOCK_ONLY` mientras `NEXT_PUBLIC_DATA_SOURCE=mock`). Las 5 operaciones (`listStoreCategories`, `listAdminCategories`,
`createAdminCategory`, `updateAdminCategory`, `reorderAdminCategories`) tienen servicio (`services/categories.ts`), hooks
(`features/categories/hooks.ts`), rutas en `lib/data-access/paths.ts` y handlers mock (`mocks/handlers/categories.ts`, fixtures en
`mocks/fixtures/categories.ts`, reglas puras compartidas en `lib/category-tree.ts`). El mock reproduce las reglas del contrato:
visibilidad efectiva (activa y con todos los ancestros activos), `CATEGORY_CYCLE`, profundidad máx. 3, `CATEGORY_PARENT_INVALID`
(padre inexistente, inactivo u oculto por un ancestro inactivo), `CATEGORY_SLUG_TAKEN` (slug autogenerado y desambiguado),
`CATEGORY_REORDER_MISMATCH`, `CATEGORY_LIMIT_REACHED`, 403 en escrituras sin alcance global y `catalog.read|create|update`.
`MOCK_STORE_VERSION` sube a 7 (`store.menuCategories`).

| Pieza                                                                                                                                          | Estado                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Menú público: chips de raíces + subcategorías desde `GET /v1/store/categories` (solo visibles), estados carga/vacío/error                      | implementado (contra el mock; http tras verificar la API)                                          |
| Backoffice `/backoffice/categorias`: árbol, alta/edición/mover, activar/desactivar con confirmación, reordenar con botones, errores por `code` | implementado (contra el mock)                                                                      |
| Productos del menú por categoría                                                                                                               | **mock hasta F11**: `Product.categoryId` es texto y se une a la categoría real por `slug` (o `id`) |
| Nombres en inglés (`menu.categoryNames.<slug>`)                                                                                                | puente solo para los slugs sembrados; el contrato no trae traducciones (spec 011)                  |
| Ilustración y rótulo japonés por categoría                                                                                                     | decoración por slug en `features/menu/menu-model.ts` (sin imágenes hasta F14)                      |

Legado: `/v1/catalog/categories` y `/v1/backoffice/categories` (categorías planas del catálogo simulado) se conservan SOLO como soporte
de los productos mock (selector de producto, ficha, favoritos) hasta F11; ya no gobiernan el menú ni la pantalla de Categorías. La
pantalla de Categorías pasa de exigir `catalog.update` a `catalog.read` (el encargado la ve en solo lectura).

## F11 — Productos y fichas (spec 012, ADR-0017)

Estado: **web conectada al contrato (mock fiel a las reglas del servidor); integración http real NO verificada** (la API se implementa en
paralelo; no se ha probado la web contra ella).

| Qué                                                                                                | Estado                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Menú, búsqueda (`q`, «Ver más») y ficha (`categoryAncestors`, imágenes o placeholder)              | **Contrato F11** (`GET /v1/store/products[/{slug}]`) vía `services/products` → `useProducts` (catálogo completo en páginas de 100, tope 10 páginas) y `useStoreProductSearch`            |
| Backoffice Productos: lista paginada, filtros, alta, edición, activar/desactivar, `media`          | **Contrato F11** (`/v1/admin/products`), errores por `code`, permisos `catalog.*` con alcance global para escribir                                                                       |
| Precio                                                                                             | Cadena `"85.00"` (`lib/product-rules`, céntimos enteros); `price: number` solo en el modelo UI `Product` para sumar/mostrar; precio = `basePrice` global (sin precio por sucursal)       |
| Ilustración, destacado, `food`, nombre/descripción en inglés                                       | **SIMULADO** (mock: `GET /v1/demo/catalog/product-extras`). En http: ilustración por categoría (`lib/product-decor`), sin destacado, sin inglés (el contrato no tiene textos por idioma) |
| `available` / disponibilidad por sucursal, interruptor del backoffice                              | **Contrato F13** (ver sección F13): ya no es simulada; la ruta demo `/v1/demo/catalog/products/:id/availability` y `available`/`availability` de `product-extras` se **retiraron**       |
| Modificadores (F12), promociones/insignias (F15), agregados de tienda (F17), subida de fotos (F14) | Sin cambios / pendientes: las imágenes solo se **referencian** por URL https (≤ 8, reordenables)                                                                                         |

Notas del mock:

- Los ids de producto siguen siendo legibles (`dumplings`, igual al slug sembrado; no UUID) para no romper carritos, pedidos ni favoritos de la demo;
  los productos creados reciben `prod-<slug>-<n>`. Hay dos productos de demostración de visibilidad: `gyoza-vegetal` (inactivo) y
  `roll-edicion-limitada` (activo bajo una categoría oculta); no aparecen en la tienda y el backoffice los marca con el motivo.
- `GET /v1/catalog/products` y `/v1/backoffice/products` se **retiraron** del mock (los sustituyen F11 y `/v1/demo/catalog/*`).
- Reglas emuladas: visibilidad (activo + categoría efectivamente visible), `q` público solo en nombre y descripción (admin: también slug y SKU),
  `categorySlug` con descendientes, `page ≤ 200`, `pageSize ≤ 100`, orden `name,id`, 400/401/403/404/409/422, media que reemplaza (https con dominio, sin IP
  literales/localhost/credenciales), 503 `PRODUCTS_BUSY` determinista (`store.productsBusy`). No simula auditoría, caché ni UUID.
- El pedido simulado solo acepta productos publicados y usa `basePrice`; los favoritos usan la misma visibilidad (`INACTIVE` si se despublica).
- `MOCK_STORE_VERSION` = 8 en F11 (la forma de `products` cambió); F12 la subió a 9 (ver más abajo).

## F12 — Modificadores (extras) de producto (spec 013, ADR-0018)

Estado: **web conectada al contrato (mock fiel a las reglas del servidor); integración http real NO verificada** (la API se implementa en
paralelo; no se ha probado la web contra ella). El carrito, la cotización y los pedidos con extras NO existen (F18/F19/F20).

| Qué                                                                                                                                                    | Estado                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backoffice **Extras** (`/backoffice/modificadores`): lista paginada de grupos, búsqueda, filtro activo, alta con opciones, edición, activar/desactivar | **Contrato F12** (`/v1/admin/modifier-groups`) vía `services/modifiers` → `features/modifiers/hooks`; errores por `code`; permisos `catalog.read` (ver) y `catalog.create/update` con alcance global (escribir)     |
| Opciones de un grupo: crear, nombre, precio extra, activar/desactivar, reordenar (subir/bajar)                                                         | **Contrato F12** (`POST …/modifiers`, `PATCH /v1/admin/modifiers/{id}`, `PUT …/modifiers/reorder`); sin borrado; sin arrastrar (botones accesibles, `aria-live`, foco conservado)                                   |
| Asociar grupos a un producto (sección «Extras del producto» del editor)                                                                                | **Contrato F12** (`GET /v1/admin/products/{id}/modifiers`, `PUT …/modifier-groups` reemplaza la lista, máx. 10); se guarda aparte de «Guardar producto»                                                             |
| Selector de extras en la ficha pública (radio si `maxSelect = 1`, casillas con tope si > 1; obligatorio/opcional; regla)                               | **Contrato F12** (`PublicProductDetail.modifierGroups` de `GET /v1/store/products/{slug}`): solo grupos ofrecibles y opciones activas. La lista pública NO los trae                                                 |
| Total estimado (base + extras, céntimos enteros)                                                                                                       | **Estimado en el cliente** y rotulado como tal: el servidor recalcula (F19). La suma usa cadenas decimales → céntimos (`lib/modifier-rules`), nunca coma flotante                                                   |
| Validación de selección (`REQUIRED/TOO_MANY/NOT_IN_GROUP/GROUP_NOT_ON_PRODUCT/INACTIVE/DUPLICATED`)                                                    | Misma lógica pura en `lib/modifier-rules.validateSelection` (la ficha la usa en vivo). El validador del servidor (`ModifierSelectionService`) NO tiene endpoint en F12: **no hay llamada real de validación**       |
| Carrito con extras, cotización, snapshot en pedido                                                                                                     | **PENDIENTE (F18/F19/F20)**: el carrito mock agrega el producto base (la ficha lo avisa). La selección estructurada `{groupId, modifierIds[]}[]` queda disponible vía `useModifierSelection` y `ProductSheet.onAdd` |
| Disponibilidad de opciones por sucursal, cantidad por opción, textos por idioma                                                                        | No existen (F13 / extensión futura / sin contrato): los extras son globales, se eligen 0 o 1 vez y el nombre es el del servidor (sin traducción)                                                                    |

Notas del mock:

- Semillas (`mocks/fixtures/modifiers.ts`): «Extras» (opcional, máx. 3: Queso crema Q5.00, Aguacate Q4.00, Salsa extra Q3.00 y Crunch de tempura Q6.00 INACTIVA)
  en California Roll, Cayibel Roll y Sushi Pizza; «Salsa» (obligatoria, elige 1, opciones Q0.00) en Sushi Pizza y Poporopos de Cangrejo; «Bebida del combo» (inactivo,
  sin productos). Los productos usados por los carritos/pedidos/e2e de la demo (p. ej. Dumplings) siguen sin extras. No existían extras simulados previos que retirar:
  la ficha no tenía selector.
- Reglas emuladas: 400 de forma (propiedades desconocidas, cuerpo vacío en PATCH, nombre 1–80, precio `^[0-9]{1,4}\.[0-9]{2}$`, `groupIds` > 50, `orderedIds` > 30, `options` > 100),
  401/403 (alcance global para escribir), 404 `MODIFIER_GROUP_NOT_FOUND|MODIFIER_NOT_FOUND|PRODUCT_NOT_FOUND`, 409 `MODIFIER_GROUP_NAME_TAKEN|MODIFIER_NAME_TAKEN` (sin distinguir
  mayúsculas), 422 `MODIFIER_LIMITS_INVALID` (min/max y grupo activo con menos opciones activas que `minSelect`), `MODIFIER_GROUP_UNSATISFIABLE`, `MODIFIER_LIMIT_REACHED` (30 opciones, 10 grupos),
  `MODIFIER_REORDER_MISMATCH` (conjunto exacto) y `MODIFIER_GROUP_INVALID` (duplicados, inexistentes o inactivos NUEVOS; un asociado desactivado puede permanecer), 503 `MODIFIERS_BUSY`
  determinista (`store.modifiersBusy`). Sin cambios => 200 sin escribir. No simula auditoría, caché de la ficha (60 s + SWR) ni UUID.
- La ficha pública omite grupos no ofrecibles (inactivos o sin opciones activas suficientes) sin ocultar el producto, como el servidor (D9).
- Invalidación TanStack Query: toda mutación invalida `modifiers.*` y las fichas públicas (`products.storeDetails`); la lista pública y el catálogo no cambian.
- `MOCK_STORE_VERSION` = 9 (`modifierGroups`, `modifiers`, `productModifierGroups`, `sequences.modifierGroup|modifier`, `modifiersBusy`): un store persistido de otra versión se descarta.

## F13 — Precio y disponibilidad por sucursal (spec 014, ADR-0019)

Estado: **web conectada al contrato (mock fiel a las reglas del servidor); integración http real NO verificada** (la API se implementa en
paralelo; no se ha probado la web contra ella). El checkout/cotización que rechaza agotados en el servidor es F19; los agregados de tienda son F17.

| Qué                                                                                                                            | Estado                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Menú, búsqueda, ficha, favoritos, carrito y reorden con precio y disponibilidad de la sucursal elegida                         | **Contrato F13** (`GET /v1/store/menu?branchId=`, `getStoreBranchMenu`) combinado con `GET /v1/store/products` (F11) en `useProducts` (`features/catalog/hooks`). Clave TanStack `['store-menu', branchId]`, `staleTime` 15 s, refetch al volver al foco y al cambiar de sucursal |
| «Agotado» (producto visible, `available=false`): atenuado, texto «Agotado», botón «Agregar» deshabilitado con nombre accesible | **Contrato F13**. Sin cantidades: nunca se promete stock numérico                                                                                                                                                                                                                 |
| Producto que el overlay no trae                                                                                                | No se oferta (el overlay solo incluye productos visibles de una sucursal activa)                                                                                                                                                                                                  |
| Fallo del overlay                                                                                                              | El menú sigue con precios BASE y un aviso con «Reintentar» (`overlayFailed`); el precio definitivo lo recalcula el servidor (F19)                                                                                                                                                 |
| Backoffice: sección «Sucursales» (editor de producto, solo editar, y hoja «Sucursales» de cada tarjeta)                        | **Contrato F13** (`GET /v1/admin/products/{id}/branches`, `PUT …/pricing`, `PATCH …/availability`): base, precio especial editable, interruptor, efectivo, `updatedAt`. Errores por `code`                                                                                        |
| Backoffice: vista «Por sucursal» (matriz)                                                                                      | **Contrato F13** (`GET /v1/admin/branches/{id}/products`): q, categoría, disponibilidad, solo con precio especial, paginada, edición en línea; reutiliza el selector de sucursal del shell                                                                                        |
| Permisos en la UI (solo cosmético; la API decide)                                                                              | Sin `catalog.update` el precio queda de solo lectura con aviso; sin `catalog.manage_availability` el interruptor se deshabilita; un empleado acotado solo ve sus sucursales                                                                                                       |
| Ilustración, destacado, `food`, textos en inglés                                                                               | Siguen **SIMULADOS** (`/v1/demo/catalog/product-extras`, sin `available`/`availability`); promociones/insignias (F15) y agregados (F17) pendientes                                                                                                                                |
| Pedido mock (`POST /v1/orders`)                                                                                                | **SIMULADO**: el mock usa el precio EFECTIVO de la sucursal del pedido y responde 409 si está agotado allí; la API real aún no tiene pedidos (F19/F20)                                                                                                                            |

Notas del mock:

- Estado en `store.branchProducts` (solo excepciones: ausencia de fila = disponible al precio base; la fila se ELIMINA al volver al defecto, D2). Semillas:
  `dynamita-roll` Q86.00 en Sucursal 2 (base Q82.00), `cerveza-nacional` Q35.00 en Sucursal 3 (base Q33.00); agotados `joselito-roll` (Sucursal 3) y `gaseosas`
  (Sucursal 2); el escenario `product-unavailable` agota Calientito y Platanito en todas las sucursales activas.
- Reglas emuladas: overlay solo de la sucursal pedida (400 sin `branchId`; 404 `BRANCH_NOT_FOUND` si no existe o está inactiva), alcance POR SUCURSAL con 404 para ajena
  (el encargado de A no ve ni modifica B), el encargado marca agotado pero NO fija precio (403: no tiene `catalog.update`), orden 400 → 404 sucursal → 404 producto → 422
  (`"0.00"` = 422 `BRANCH_PRICE_INVALID`; cualquier otra forma, incluida 85 o `1000000.00`, es 400), idempotencia (sin cambio = 200 sin escribir ni consumir el fallo simulado),
  503 `BRANCH_PRODUCTS_BUSY` determinista (`store.branchProductsBusy`). No simula auditoría, `Cache-Control: max-age=15`, throttling ni UUID.
- Invalidación: toda mutación invalida `branch-products.*`, `store-menu.*` (todas las sucursales) y las fichas públicas (`products.storeDetails`); el cambio de sucursal invalida `store-menu`.
  La caché HTTP real no se puede invalidar: la ventana máxima de obsolescencia es 15 s (ADR-0019 D5).
- `MOCK_STORE_VERSION` = 10 (`branchProducts`, `branchProductsBusy`; `ProductRecord.availability` retirado): un store persistido de otra versión se descarta.

## F14 — Imágenes y medios en Cloudflare R2 (spec 015, ADR-0020)

Estado web: `MOCK_ONLY` (adaptador mock de `lib/data-access`). **No se probó contra R2 ni contra la API real**: ninguna prueba, e2e ni el mock hace peticiones a Cloudflare o a un dominio de CDN; la integración real sigue `BLOCKED_EXTERNAL` (ver `docs/integrations/cloudflare-r2.md`).

| Pieza                                                                                                                                                                                                                                                                                       | Estado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/media.ts` (9 operaciones del contrato: `createAdminMediaUpload`, `completeAdminMediaUpload`, `listAdminMedia`, `getAdminMedia`, `deleteAdminMedia`, `attachAdminProductMedia`, `updateAdminProductMedia`, `reorderAdminProductMedia`, `detachAdminProductMedia`), tipos y `paths` | **Contrato F14**: mismos services contra mock y http (paridad en `parity.test.ts`, caso F14)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Mock fiel al contrato (`mocks/handlers/media.ts`): 400/401/403/404/409/410/422/503, dedup por checksum (200 vs 201), `MEDIA_IN_USE`, tope de 8, reorden exacto, alcance global para escribir, intent con vigencia de 300 s, enlace automático por `PATCH media` de F11                      | Emula al servidor; sin auditoría, sin `no-store`, ids legibles (no UUID)                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Fallos deterministas                                                                                                                                                                                                                                                                        | `store.mediaStorageUnavailable` (503 `MEDIA_STORAGE_UNAVAILABLE`), `store.mediaBusy` (503 `MEDIA_BUSY`), `store.productsBusy`                                                                                                                                                                                                                                                                                                                                                                                                    |
| Semillas                                                                                                                                                                                                                                                                                    | 3 assets READY (`media-seed-1..3`, el primero vinculado a «dumplings» → `MEDIA_IN_USE`); `MOCK_STORE_VERSION` = 11                                                                                                                                                                                                                                                                                                                                                                                                               |
| Almacenamiento y URLs                                                                                                                                                                                                                                                                       | **SIMULADO**: el PUT lo reemplaza `PUT /v1/demo/media/objects/:assetId` (solo mock; registra tamaño/tipo/checksum como vería `HeadObject`). URLs públicas con el host reservado `media-simulado.invalid` (nunca resuelve ni se pide). Los bytes de lo subido en la pestaña se guardan en memoria y se muestran con `blob:`; tras recargar o en los assets sembrados se muestra «Sin vista previa»/ilustración                                                                                                                    |
| `MediaUploader` (`services/media-uploader.ts`)                                                                                                                                                                                                                                              | http: `XMLHttpRequest` con `PUT` a `uploadUrl` y los `headers` EXACTOS devueltos (sin añadir ni cambiar ninguno, `withCredentials=false`, solo https, progreso, cancelable `AbortSignal`, errores tipados). mock: almacén simulado sin red. **El camino http real solo está probado con un doble de XHR**                                                                                                                                                                                                                        |
| Optimización previa (`lib/media-optimize.ts`)                                                                                                                                                                                                                                               | Canvas → WebP calidad 0.82, lado máx. 1600 px; WebP/AVIF que ya cumplen se suben tal cual; GIF/SVG/HTML renombrado rechazados por firma real de bytes; SHA-256 con `crypto.subtle`; rechazo si > 5 MiB. El canvas va tras `ImageProcessor` (inyectable en pruebas). Verificado de verdad en Chromium (e2e) con un PNG; AVIF/WebP grandes solo con dobles                                                                                                                                                                         |
| Backoffice                                                                                                                                                                                                                                                                                  | `ProductModal` (solo editar) → `ProductMediaSection`: carga múltiple (selector y arrastrar y soltar), cola con estado por archivo, reordenar con botones (aria-live, foco conservado), texto alternativo, desvincular con confirmación (no borra el asset), biblioteca (reutilizar/eliminar sin uso), aviso «Almacenamiento de imágenes no configurado», solo lectura sin `catalog.update` global. Alta de producto: sin imágenes (se añaden al editar). El formulario ya **no** envía `media`; se retiró el campo de URL manual |
| Tienda                                                                                                                                                                                                                                                                                      | `ProductArt`: `<img>` con `loading="lazy"` (eager + `fetchpriority=high` solo la imagen visible de la ficha), `decoding="async"`, `width/height`, `sizes`, `alt` (texto alternativo o nombre), fallback a la ilustración si no hay imagen o `onError` (una vez). **Sin `next/image`**, sin optimizador de Vercel ni `/cdn-cgi/image`, por lo que no se configura `images.remotePatterns` ni `NEXT_PUBLIC_MEDIA_HOST`                                                                                                             |
| Invalidación                                                                                                                                                                                                                                                                                | `['media']`, `['products']` (admin, fichas y búsquedas públicas) y `['catalog']` (menú/lista) tras cada mutación                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Pendiente de proveedor / integración                                                                                                                                                                                                                                                        | PUT real a R2 y CORS, dominio/CDN con caché, `complete` real, `img-src`/`connect-src` de la CSP (Etapa 3), `MEDIA_UPLOAD_EXPIRED` real (el mock lo simula con el reloj)                                                                                                                                                                                                                                                                                                                                                          |

## Corrección de la auditoría F00–F09 (web)

Estado: **web alineada; sin API real verificada** (web contra API/Supabase reales NO comprobada en esta pasada).

| Hallazgo                                                                       | Decisión / estado                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 · cuenta/direcciones solo con la sesión demo                                | `useMe`, `useAddresses`, `useMyOrders`, `AccountSection` y el checkout usan `useCustomerScope()` (Supabase Auth real o `demo:<correo>`). Claves `queryKeys.customer.account.{me,addresses}(scope)` y `customer.orders.mine(scope)`: otra cuenta no lee la caché ajena; `CustomerCacheGuard`, `signOut` y el cambio de cuenta demo las descartan. Retiradas `queryKeys.account.*` y `orders.mine`. |
| Hub de Mi cuenta con Supabase real                                             | Reutiliza el hub con datos, direcciones y favoritos reales; **sin** tarjeta de pedidos ni insignia de simulación (los pedidos del cliente son F20, sin API: `useMyOrders({ enabled: false })`).                                                                                                                                                                                                   |
| A2 · `useBranches`/`useStoreConfig` solo-mock                                  | Checkout (`use-checkout-data.ts`) y `OrderModeSheet` toman sucursales activas de `usePublicBranches()` (F07), disponibilidad de `useBranchesAvailability()` (F08) y cobertura de `useAddressCoverage()` (F09). El subtítulo de la sucursal pasa de `area` (campo simulado) a `address` (público).                                                                                                 |
| Aislado y rotulado como simulado                                               | `useStoreConfig` (F10: reglas de programación, zonas inexistentes, `serverTime`, contacto), `useBranches` (vista operativa rica: confirmación/seguimiento/incidencias de pedidos F20 y backoffice demo), catálogo F11, pedidos F20. En modo `http` siguen fallando hasta tener API (estado de error, sin fallback silencioso).                                                                    |
| F05 · guardar la dirección del checkout                                        | Se guarda al **continuar desde Entrega** (`save-address.ts`, `CheckoutFlow.saveAddressIfWanted`), no tras el pedido. `municipalityId` sale del catálogo real (`useLocationOptions`); avisos explícitos de éxito, fallo, catálogo sin municipio y máximo de direcciones; nunca bloquea; firma de dirección para no duplicar y reintento si falló.                                                  |
| F08 · `lib/schedule.ts`, `lib/branch-hours.ts`, `mocks/branch-availability.ts` | **No se eliminó nada**: ver abajo.                                                                                                                                                                                                                                                                                                                                                                |
| Pruebas intermitentes (`bo-admin.test.tsx`)                                    | `asyncUtilTimeout` global de Testing Library = 5000 ms (`src/test/setup-dom.ts`) y `testTimeout` de las pruebas DOM = 15 s (`vitest.config.ts`) para que la espera máxima no coincida con el tope de la prueba. Las aserciones no cambian.                                                                                                                                                        |

### F02 · Restablecer MFA y F05 · zona de la dirección (web)

Estado: **web alineada con el contrato; MOCK_ONLY. Web contra la API real NO verificada** (la API de F02/F05 está commiteada con Supabase simulado).

- **F02 `POST /v1/admin/staff/{id}/mfa-reset` (204)**: acción «Restablecer MFA» en Usuarios (`StaffMfaResetModal` sobre `ConfirmModal`). Visible solo con `grants['staff.update'].allBranches`, nunca en la fila propia y solo para empleados `LINKED` (`canResetStaffMfa`). El texto indica que la persona deberá volver a enrolar su autenticador y remite al procedimiento manual de Supabase si es el único administrador. Errores 403/404/409/429/502/503 con mensaje de negocio por estado, sin mostrar el detalle del servidor (`mfaResetErrorMessage`). Sin invalidar consultas (la API no expone el MFA por persona). Con datos simulados el modal y el aviso llevan la insignia «Simulación» (no se contacta a ningún proveedor de identidad). El mock reproduce solo-admin-global, no a uno mismo, 404 `STAFF_NOT_FOUND`, 409 `STAFF_NOT_LINKED`, 204 idempotente y `store.mfaResetUnavailable` ⇒ 503 `MFA_RESET_UNAVAILABLE`; **no** simula 429 ni 502 `MFA_RESET_FAILED` (la UI los maneja, probado con la función de mensajes).
- **F05 zona (decisión C2)**: ciudad de Guatemala ⇒ zona obligatoria «Zona N», N de 1 a 25 (`<select>` «Zona 1»…«Zona 25», sin excluir 20/22/23); otros municipios ⇒ campo de texto opcional ≤ 60. `features/account/validation.ts` (`checkAddressZone`) y mensajes es/en (`validation.zone*`). La conversión «N» (UI/checkout/pedido) ↔ «Zona N» (API) vive solo en `services/account.ts` (`zoneToApi`/`zoneFromApi`). El mock de direcciones responde 400 `ZONE_REQUIRED`/`ZONE_INVALID` (`violations[0].path = zone`), normaliza «zona 05» → «Zona 5», evalúa PATCH sobre el resultado fusionado y una dirección antigua de la ciudad sin zona pide la zona al editarla. El checkout ya exigía la zona de la ciudad y conserva su filtro de zonas inexistentes (regla del pedido, no de la libreta de direcciones). Con la API real, el formulario muestra en el campo de zona los 400 `ZONE_REQUIRED`/`ZONE_INVALID`.

### F08: ¿código muerto?

Verificado con `grep` (consumidores fuera de pruebas):

- `lib/schedule.ts` (`slotsFor`, `availableDates`, `isScheduleValid`): lo usan `OrderModeSheet`, `OrderTypeFields`, `order-mode/when.ts`, `use-checkout-data.ts` y el handler mock de pedidos. Es lógica de **presentación** (genera los horarios que se ofrecen a partir de las horas públicas del servidor); el servidor sigue siendo quien valida. `intervalsForDate` es interna.
- `lib/branch-hours.ts`: lo usan el editor admin (`WeeklyHoursEditor`, `branch-schedule-view.ts`), `BranchHoursPanel` público, `lib/schedule.ts` y los handlers/fixtures mock. `validateWeek` replica las reglas del servidor para el editor y el mock.
- `mocks/branch-availability.ts`: solo lo usa el handler mock (`mocks/handlers/schedule.ts`) para reproducir `GET /v1/branches/:id/availability`; **ninguna pantalla** lo importa, por diseño (la UI consume la disponibilidad del servidor).

Los tres tienen consumidores reales y sus pruebas siguen cubriendo código vivo, así que no se borran ni sus pruebas. Las constantes exportadas solo por uso interno (`WEEKDAYS`, `MINUTES_PER_DAY`, `nextWeekday`, `RANGE_MESSAGE`, `formatHm`) se dejan: se usan dentro de su módulo.
