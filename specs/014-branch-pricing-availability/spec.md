# F13 — Precio y disponibilidad por sucursal

**Rama**: `feature/F13-branch-pricing-availability` (desde `develop` 04e4a53)
**Prioridad**: P0 (backlog oficial) · **Dependencias**: F07 (sucursales), F11 (productos), F10 (visibilidad de categorías), F03 (RBAC) · **Integración posterior**: F17 (agregados de tienda), F19 (cotización de checkout), F15 (promociones)
**Decisiones**: `docs/adr/0019-precio-disponibilidad-sucursal.md`
**Estado global**: `IN_PROGRESS`. Contrato `CONTRACT_DEFINED`; API/BD/web se implementan en la misma rama y se reportan por componente.

## Alcance

Gestionar `app.branch_products`: **precio de sucursal** (override del precio base) y **disponibilidad booleana** por sucursal; exponer un overlay público ligero
(`GET /v1/store/menu?branchId=`), dos matrices administrativas (por sucursal y por producto), dos escrituras (precio y disponibilidad) y un **servicio reutilizable**
(`BranchOffersService`) que F17 y F19 consumirán. Fuera de alcance: stock numérico/kardex (el DBML no lo contempla; «agotado» = `available=false`), checkout y cotización
(F19), agregados de tienda (F17), promociones (F15), imágenes (F14), precio o disponibilidad **por sucursal de opciones modificadoras** (F12 sigue global), borrado físico.

## Estados por componente

| Componente                                                                                     | Estado                  | Nota                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrato OpenAPI (5 operaciones nuevas) + tipos                                                | `CONTRACT_DEFINED`      | `pnpm contracts:check` en rojo hasta implementar la API (patrón F08–F12). Verificado: lista las 5 operaciones                                                 |
| Migración `0014_branch_products` + Prisma                                                      | propuesta               | Preparada en paralelo en el árbol de trabajo (`sushimon-api/prisma/migrations/0014_branch_products/`); sin aplicar a bases reales; requiere aprobación humana |
| API `src/branch-products/` (público + admin + `BranchOffersService`)                           | pendiente               | `CONTRACT_DEFINED` → `API_IMPLEMENTED`                                                                                                                        |
| Web: menú filtrado por sucursal, matrices admin, editor de producto                            | pendiente               | Mock hasta integrar; `http` solo tras la API                                                                                                                  |
| Rutas demo `/v1/demo/catalog/products/:id/availability` y `available`/`availability` del extra | `MOCK_ONLY` (se retira) | Se sustituyen por los endpoints reales; `product-extras` conserva ilustración/destacado/textos EN (F15/otros)                                                 |
| Checkout/cotización que rechaza productos agotados                                             | pendiente               | F19. F13 solo entrega `assertOrderable` (sin consumidores)                                                                                                    |
| Agregados de tienda (Home/menú/búsqueda con precio de sucursal)                                | pendiente               | F17 usará `BranchOffersService.resolve`                                                                                                                       |
| Disponibilidad por sucursal de opciones modificadoras                                          | fuera de alcance        | F12 las trata como globales; negocio no lo ha pedido                                                                                                          |

## Hechos verificados del repo

- DBML (`docs/references/monsushi_dbdiagram.dbml:165-174`): `app.branch_products (branch_id, product_id, price_override numeric(12,2) null, available boolean default true)`, PK `(branch_id, product_id)`;
  refs `branch_products.branch_id > branches.id` y `.product_id > products.id` (líneas 468-469). No hay columna de stock.
- Visibilidad pública de producto (F11, D3): `active` Y categoría efectivamente visible (`CategoriesQueryService.getVisibleIds`, `sushimon-api/src/categories/categories-query.service.ts:50`).
- Alcance por sucursal (F07/F08): `AuthorizationService.scopeFor/canAccess` (`sushimon-api/src/auth/authorization.service.ts`); fuera de alcance = inexistente = 404 (`branch-hours.service.ts`, `delivery-zones.service.ts`).
  Los `grants` solo incluyen asignaciones hacia sucursales activas (ADR-0010 d.2): un empleado acotado no puede gestionar una sucursal inactiva; el alcance global sí.
- Permisos existentes (ADR-0010; `specs/006-staff-rbac-management/spec.md:30`): `catalog.read`, `catalog.update`, `catalog.manage_availability`. **No se crean permisos.** Por defecto `manager` tiene `catalog.read` y
  `catalog.manage_availability` (puede marcar agotados en su sucursal) pero NO `catalog.update`; fijar precios por sucursal queda para `admin` (o un rol con `catalog.update` acotado a sucursales, decisión de negocio).
- Simulado hoy (web): `PATCH /v1/demo/catalog/products/:id/availability` y `GET /v1/demo/catalog/product-extras` (`sushimon-web/src/mocks/handlers/products.ts:593-640`, `lib/data-access/paths.ts:121-122`, `SimulatedProductExtras.available/availability` en
  `lib/data-access/models.ts:258-272`). No existe precio por sucursal en el mock.
- `ProductPrice` (`^[0-9]{1,6}\.[0-9]{2}$`), `AdminProductCategory`, parámetros `BranchId`/`ProductId` ya existen en el contrato y se reutilizan.

## Criterios de aceptación del backlog

| Criterio                                    | Cómo se cumple                                                                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No mostrar precio de otra sucursal          | El overlay público es por UNA sucursal y solo trae `price` efectivo (sin precio base ni indicio de override); la matriz por producto filtra sucursales por `scopeFor`                                 |
| Cambio de disponibilidad invalida caché     | HTTP: ventana ≤ 15 s (`max-age=15`, sin SWR); web: `invalidateQueries` del menú de la sucursal tras cada cambio + `staleTime` ≤ 15 s; el servidor revalida en checkout (D8), nunca confía en la caché |
| No prometer stock numérico                  | Solo `available` booleano; ningún campo de cantidad en contrato, BD ni UI (texto «Agotado»/«No disponible»)                                                                                           |
| Precio de sucursal correcta                 | `effectivePrice = coalesce(price_override, base_price)` calculado en SQL con `numeric`; cadena `"85.00"`; prueba por sucursal                                                                         |
| No ofertar inactivo                         | El overlay solo incluye productos visibles (D3 de F11); `assertOrderable` rechaza ocultos aunque tengan fila                                                                                          |
| Seguridad por `branchId`                    | `canAccess(staff, permiso, branchId)` en cada operación; fuera de alcance = 404; listas por producto filtradas con `scopeFor`; pruebas de IDOR                                                        |
| Rechazar producto no disponible en checkout | `BranchOffersService.assertOrderable` (D6) con 422 `PRODUCT_NOT_AVAILABLE`; el endpoint de checkout es F19                                                                                            |

## Decisiones (resumen; razones en ADR-0019)

- **D1 Modelo**: `app.branch_products` = DBML + `created_at`/`updated_at` (la API mantiene `updated_at`); PK `(branch_id, product_id)`; `CHECK price_override IS NULL OR (price_override > 0 AND price_override <= 999999.99)`;
  FK a `branches` y `products` `ON DELETE RESTRICT` (nada se borra físicamente); índice por `product_id`. Migración **0014** (la última de `develop` es 0013). RLS sin políticas + `REVOKE` como 0006–0013. El DBML no se edita.
- **D2 Semántica «excepciones»**: **ausencia de fila = disponible al precio base**. Una fila existe solo si hay override o `available=false`; cuando ambos vuelven al valor por defecto (`price_override=NULL` y `available=true`)
  la API **elimina la fila** (única operación de borrado de F13; es un dato derivado, no una entidad de negocio). Productos nuevos nacen disponibles en todas las sucursales sin sembrar filas. Un override igual al precio base
  se conserva (congela el precio de la sucursal ante cambios futuros del base); no se normaliza.
- **D3 Precio**: cadena decimal `"85.00"` en entrada y salida (como F11/F12), aritmética decimal/`numeric` sin `Number`. `effectivePrice = coalesce(price_override, base_price)` calculado en SQL. El precio de modificadores sigue **global** (F12).
- **D4 Overlay público** `GET /v1/store/menu?branchId={uuid}` (`getStoreBranchMenu`): para TODOS los productos públicamente visibles devuelve `{branchId, items:[{productId, slug, price, available}]}`, orden `slug, productId`, sin paginación (catálogo de cientos).
  No duplica nombre/descripción/categoría/imágenes (la web combina con `listStoreProducts`; F17 construirá agregados) ni expone `basePrice`. `branchId` ausente/mal formado ⇒ 400; sucursal inexistente o **inactiva** ⇒ 404 `BRANCH_NOT_FOUND`.
  `Cache-Control: public, max-age=15` (errores `no-store`); límite de tasa 60/min por IP. Algoritmo: (1) sucursal activa por id; (2) IDs de categorías visibles (F10); (3) un `SELECT` de productos activos de esas categorías con `LEFT JOIN branch_products ON branch_id=$1`. Tres lecturas, constantes (sin N+1).
  El horario/cierre de la sucursal (F08) NO afecta `available` (son conceptos distintos; F19 valida ambos).
- **D5 Invalidación** (sin dependencias nuevas): la caché HTTP no se puede invalidar; «invalidar» = ventana ≤ 15 s + `queryClient.invalidateQueries(['store-menu', branchId])` en la web (al guardar en backoffice, al cambiar de sucursal, `refetchOnWindowFocus` con `staleTime` ≤ 15 s).
  Las peticiones del backoffice a endpoints admin son `no-store`. No hay Redis, colas ni webhooks. La verdad la fija el servidor en checkout (D6/D8).
- **D6 Servicio reutilizable** (`BranchProductsModule` exporta `BranchOffersService`; **sin endpoint ni lógica de checkout**):
  - `resolve(branchId, productIds[]) → Map<productId, {price: string, basePrice: string, available: boolean}>`: UNA consulta (`products LEFT JOIN branch_products`, `WHERE id = ANY($2)`), sin N+1; ids duplicados se colapsan; ids inexistentes están **ausentes** del mapa; no aplica reglas de visibilidad (es un cálculo de precio/disponibilidad). Máx. 200 ids (si no, error de programación).
  - `assertOrderable(branchId, productIds[]) → void`: lanza **422 `PRODUCT_NOT_AVAILABLE`** con `violations[{path, code, message}]` (todas, no solo la primera; `path` `productIds/<id>`) con códigos `PRODUCT_UNKNOWN` (no existe), `PRODUCT_HIDDEN`
    (inactivo o categoría no visible: **nunca ordenable aunque tenga fila**) y `PRODUCT_SOLD_OUT` (`available=false` en esa sucursal). Sucursal inexistente o inactiva ⇒ 422 `BRANCH_NOT_AVAILABLE` (código ya existente en F09). Como mucho dos lecturas (visibilidad F10 + la consulta de `resolve`).
  - **F17** (agregados Home/menú/búsqueda) consumirá `resolve` para incrustar `price` y `available` de la sucursal en sus respuestas. **F19** (cotización) llamará `assertOrderable` y `resolve` en cada cotización, usará `price` del servidor (jamás del cliente) y devolverá el 422 con
    los precios/estados vigentes para que la UI se refresque. F13 no valida horario, cobertura ni modificadores.
- **D7 Administración** (`@RequireStaff()`, aal2, `no-store`; permisos existentes; alcance POR SUCURSAL):
  - `GET /v1/admin/branches/{id}/products` (`listAdminBranchProducts`; `catalog.read` en esa sucursal): matriz por sucursal, todos los productos (activos e inactivos) con `basePrice`, `priceOverride`, `effectivePrice`, `available`, `offered`, categoría y `publiclyVisible`. Filtros `q` (nombre/slug/SKU, ≤ 80), `categoryId`, `available`, `hasOverride`; `page` ≤ 200, `pageSize` ≤ 100; orden `name, id`.
  - `GET /v1/admin/products/{id}/branches` (`listAdminProductBranches`; `catalog.read`): una fila por sucursal dentro de `scopeFor(staff, 'catalog.read')` (global = todas; acotado = las suyas; activas e inactivas si el alcance las incluye). 404 `PRODUCT_NOT_FOUND`.
  - `PUT /v1/admin/branches/{id}/products/{productId}/pricing` (`setAdminBranchProductPricing`; `catalog.update` con `canAccess(branchId)`): body `{priceOverride: "85.00" | null}` (`null` elimina el override). Idempotente. 200 con `AdminBranchProductState`.
  - `PATCH /v1/admin/products/{id}/availability` (`setAdminProductAvailability`; `catalog.manage_availability` con `canAccess(body.branchId)`): body `{branchId, available}`. Idempotente. 200 con `AdminBranchProductState`.
  - Orden de comprobaciones en escrituras: forma (400) → alcance de sucursal (404 `BRANCH_NOT_FOUND`, sin distinguir inexistente de ajena) → producto (404 `PRODUCT_NOT_FOUND`) → regla (422). Productos inactivos u ocultos admiten precio/disponibilidad (preparar con antelación).
  - Sucursal inactiva: se puede consultar y escribir con alcance global (los empleados acotados no la ven: ADR-0010).
- **D8 Escritura atómica sin lock global**: en una transacción `ReadCommitted` (`INSERT … ON CONFLICT (branch_id, product_id) DO UPDATE` que modifica SOLO la columna escrita, de modo que PUT y PATCH concurrentes se mezclan sin pisarse) seguido de
  `DELETE … WHERE price_override IS NULL AND available` de esa fila; la auditoría va en la misma transacción. Comparación previa con la fila vigente: sin cambio ⇒ 200 sin escribir ni auditar. El último en escribir gana (sin versión optimista: un solo campo por operación).
  `P2028`/`55P03`/`40P01`/`40001`/timeout ⇒ 503 `BRANCH_PRODUCTS_BUSY` (reintentable, mensaje fijo; whitelist de 5xx con `code`). FK inexistente por carrera (`23503`) ⇒ 404 del recurso correspondiente.
- **D9 Errores y 400 frente a 422** (coherente con F11 D2 y F12 D5, donde forma y rango inválidos son 400): todo lo que viola la **forma** del precio (no cadena, no `^[0-9]{1,6}\.[0-9]{2}$`, por tanto también > 999999.99 y negativos) es 400 del DTO. El único caso bien formado pero inválido, `"0.00"`
  (≤ 0), es regla de negocio ⇒ **422 `BRANCH_PRICE_INVALID`** con `violations[0].path = priceOverride`. La BD tiene el mismo `CHECK` como respaldo.
- **D10 Auditoría** (misma transacción, sin PII): `branch_product.price_set` (`branchId`, `productId`, `oldPrice`/`newPrice`), `branch_product.price_cleared` (`oldPrice`), `branch_product.availability_changed` (`oldAvailable`/`newAvailable`). Sin cambios ⇒ no se audita.
- **D11 Módulos**: `src/branch-products/` (`BranchProductsModule`, `PublicBranchMenuController`, `AdminBranchProductsController`, `AdminBranchProductsService`, `BranchMenuQueryService`, `BranchOffersService`, repositorio, política de precio). Importa `CategoriesModule` (visibilidad) y `AuthModule`;
  **no** modifica `ProductsModule`, ni `ModifiersModule`, ni los contratos de F11/F12 (`basePrice` sigue siendo el precio global). Web: `features/catalog` (menú combina `listStoreProducts` + `getStoreBranchMenu`) y `features/bo-catalog` (matrices).

## Modelo de datos (propuesta para `database-engineer`, migración `0014_branch_products`)

```
app.branch_products (branch_id uuid not null REFERENCES app.branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  product_id uuid not null REFERENCES app.products(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  price_override numeric(12,2) null, available boolean not null default true,
  created_at timestamptz(6) not null default now(), updated_at timestamptz(6) not null default now(),
  PRIMARY KEY (branch_id, product_id),
  CHECK price_override IS NULL OR (price_override > 0 AND price_override <= 999999.99))
INDEX branch_products_product_idx (product_id)
```

RLS: `ENABLE ROW LEVEL SECURITY` sin políticas + `REVOKE`. Sin trigger de «fila por defecto» (lo gestiona la API, D2). El DBML de `docs/references` no se edita.

## Errores

| HTTP | `code`                  | Cuándo                                                                                                                                               |
| ---- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | (validación)            | UUID inválido, `branchId` ausente, precio no cadena o fuera de forma (incl. > 999999.99/negativo), propiedades desconocidas/faltantes, `q` > 80      |
| 401  | —                       | Sin JWT válido                                                                                                                                       |
| 403  | —                       | No es personal activo, falta el permiso, no aal2                                                                                                     |
| 404  | `BRANCH_NOT_FOUND`      | Sucursal inexistente, inactiva (público) o fuera del alcance (admin); no se distingue                                                                |
| 404  | `PRODUCT_NOT_FOUND`     | Producto inexistente (admin)                                                                                                                         |
| 422  | `BRANCH_PRICE_INVALID`  | `priceOverride` bien formado pero ≤ 0 (`"0.00"`)                                                                                                     |
| 422  | `PRODUCT_NOT_AVAILABLE` | Solo del servicio (`assertOrderable`, F19), con `violations` (`PRODUCT_UNKNOWN`/`PRODUCT_HIDDEN`/`PRODUCT_SOLD_OUT`); no figura en el OpenAPI de F13 |
| 422  | `BRANCH_NOT_AVAILABLE`  | Solo del servicio: sucursal inexistente o inactiva                                                                                                   |
| 503  | `BRANCH_PRODUCTS_BUSY`  | Timeout/bloqueo de la transacción de escritura; reintentable                                                                                         |

## Contrato (resumen)

Tag `branch-products`. Operaciones: `getStoreBranchMenu` (GET `/v1/store/menu`) · `listAdminBranchProducts` (GET `/v1/admin/branches/{id}/products`) · `listAdminProductBranches` (GET `/v1/admin/products/{id}/branches`) ·
`setAdminBranchProductPricing` (PUT `/v1/admin/branches/{id}/products/{productId}/pricing`) · `setAdminProductAvailability` (PATCH `/v1/admin/products/{id}/availability`). Esquemas: `StoreBranchMenuItem`, `StoreBranchMenu`, `AdminBranchProductState`,
`AdminBranchProductRow`, `AdminBranchProductPage`, `AdminProductBranchRow`, `AdminProductBranches`, `SetBranchProductPricingRequest`, `SetProductAvailabilityRequest`; parámetro `BranchProductId`; `ErrorResponse.code` ampliado. No cambia ninguna operación existente (no
hay cambios incompatibles). `contracts:check` exige que la API declare exactamente los códigos HTTP por operación.

## Pruebas exigidas

Servicio: precio efectivo (override/base, decimales exactos, `"0.00"` ⇒ 422, `"1000000.00"`/`85`/número ⇒ 400), D2 (borrar fila al volver al defecto, conservar override al agotar, no borrar si queda uno de los dos), idempotencia sin escritura ni auditoría, PUT/PATCH concurrentes
(merge por columna), `BRANCH_PRODUCTS_BUSY`, auditoría (una fila por cambio real, sin PII), producto inactivo/oculto editable. Overlay: solo visibles, producto inactivo o categoría oculta ausente aunque tenga fila, sucursal inactiva/inexistente 404, **un precio de otra sucursal nunca aparece**,
cabeceras de caché, tres consultas constantes. `BranchOffersService`: `resolve` en una consulta, ids duplicados/inexistentes, `assertOrderable` con todas las violaciones y códigos, oculto con fila no ordenable. Autorización: 401, 403 (sin permiso/aal2), IDOR por `branchId` (otra sucursal ⇒ 404 en lectura y escritura,
mismo mensaje que inexistente), `catalog.manage_availability` sin `catalog.update` no puede fijar precio, listas por producto filtradas por alcance. Contrato: `contracts:check`.
Web: menú por sucursal (precio correcto al cambiar de sucursal, «Agotado» sin añadir al carrito, refetch ≤ 15 s e invalidación tras cambio), matrices admin con errores por `code`, ocultar precio si el permiso es solo de disponibilidad. BD (base real, pendiente de aprobación): CHECK, PK, RESTRICT.

## Contrato para F19/F20 (cotización y pedido)

- `BranchOffersService.resolve(branchId, productIds)` es SOLO precio y disponibilidad: devuelve `price`, `basePrice` y `available`; NO decide si un producto es ordenable (no aplica visibilidad y no tiene campo `offered`). **F19 debe cobrar `price`, nunca `basePrice`.** Es seguro ante entradas malas: no arreglo o más de 200 ids => 422 `PRODUCT_NOT_AVAILABLE`; `branchId` mal formado => 422 `BRANCH_NOT_AVAILABLE`; ids que no son UUID se tratan como ausentes.
- `assertOrderable(branchId, productIds)` es el ÚNICO punto de decisión de «ordenable». Lista vacía, no arreglo o más de 200 ids => 422 `PRODUCT_NOT_AVAILABLE` con violación `path: productIds`, `code: PRODUCT_UNKNOWN`. Las violaciones por producto usan `path: productIds[i]` (índice de la primera aparición del id).
- **Riesgo TOCTOU**: entre cotizar y crear el pedido un administrador puede cambiar precio o disponibilidad. F20 debe recalcular precio y disponibilidad (`assertOrderable` + `resolve`) DENTRO de la transacción que crea el pedido, o aceptar y documentar la ventana. El pedido guarda un **snapshot de precio** (sin FK a `branch_products`). Jamás se aceptan precios ni nombres del cliente. Los modificadores (F12) se validan aparte con `ModifierSelectionService`; F13 no valida horario, cobertura ni modificadores.
- Alcance administrativo y sucursales inactivas: el personal con alcance GLOBAL puede configurar precio y disponibilidad de sucursales inactivas (p. ej. prepararlas); el empleado acotado no puede, porque sus `grants` solo incluyen sucursales activas (ADR-0010 d.2): recibe 404 `BRANCH_NOT_FOUND`. Cubierto por pruebas e2e.
- Estado previo para auditoría: la fila vigente se lee con `FOR NO KEY UPDATE` dentro de la transacción antes de decidir no-op y de calcular los valores `old`; una sola fila (PK) por transacción, sin riesgo de deadlock con el upsert.

## Orden de despliegue (obligatorio)

La migración `0014_branch_products` debe aplicarse ANTES de desplegar la API de F13: sin la tabla `app.branch_products`, `GET /v1/store/menu` responde 500. No se captura el error ni se toca `/v1/health/ready`. Línea para el PR: «**Despliegue: aplicar la migración 0014_branch_products antes de desplegar la API (el menú público responde 500 si falta).**»

## Tareas por dueño

1. `database-engineer`: migración 0014 (tabla, CHECK, índice por `product_id`, RLS) y Prisma; sin tocar datos existentes.
2. `api-engineer`: módulo `branch-products` (público, admin, `BranchOffersService`), whitelist `BRANCH_PRODUCTS_BUSY`, auditoría, pruebas; `contracts:check` verde.
3. `web-engineer`: menú combina productos + overlay con invalidación (D5), «Agotado», matrices admin, pestaña «Sucursales» en el editor de producto; retirar la ruta demo de disponibilidad y `available/availability` del extra simulado cuando se integre; mocks alineados al contrato.
4. `security-reviewer` / `qa-engineer`: IDOR por sucursal, escrituras concurrentes, confianza cero en cliente, matriz de pruebas.

## Preguntas abiertas y asunciones

- **Asunción (D9)**: se mantiene 400 para toda forma/rango de formato (coherente con F11/F12) y 422 solo para `"0.00"`. Alternativa: 422 también para el rango; descartada por inconsistencia con F11/F12.
- **Asunción**: `manager` no tiene `catalog.update` por defecto, por lo que solo `admin` fija precios por sucursal; negocio puede conceder `catalog.update` acotado a un rol de encargado.
- **Asunción**: el overlay no distingue «agotado» de «no se vende aquí»; ambos son `available=false`. Si negocio quiere «no se ofrece en esta sucursal» (ocultar del menú) distinto de «agotado hoy», requiere una columna nueva (hoy no está en el DBML).
- **Asunción**: sin paginación en el overlay; si el catálogo supera ~1000 productos se pagina o se reemplaza por F17.
- **Asunción**: un override igual al base se acepta tal cual (no se elimina automáticamente).
- **Pendiente F19**: formato de la respuesta de cotización ante `PRODUCT_NOT_AVAILABLE`; el servicio ya entrega las violaciones por producto.
- **Pendiente (opcional)**: `ETag` condicional en el overlay para reducir ancho de banda; no se incluye (sin `ETag`, como F10/F11).
- **Orden de despliegue**: la migración 0014 debe aplicarse ANTES de desplegar la API de F13 (el overlay consulta `app.branch_products`); sin ella `GET /v1/store/menu` responde 500.
