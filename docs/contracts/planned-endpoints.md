# Endpoints previstos (📐 planificados · 🎭 simulados en la web)

Fuente única de las rutas que consume `sushimon-web` (`src/lib/data-access/paths.ts`). Hoy **solo existen en el
adaptador mock**; se añaden a `openapi.yaml` (sección `paths`) en la Etapa 2/3, slice a slice, cuando la API los
implemente (`contracts:check` exige que contrato y API coincidan). Los esquemas ya están en
`components/schemas` con `x-status: draft`.

> Implementado en F03 (`API_IMPLEMENTED`): `/v1/admin/staff[...]`, `/v1/admin/roles[...]`, `/v1/admin/permissions` (reemplazan a `/v1/backoffice/users`).
>
> Implementado en F02 (`API_IMPLEMENTED`, Supabase simulado en pruebas; sin verificar contra Supabase real): `POST /v1/admin/staff/{id}/mfa-reset` (`resetAdminStaffMfa`, 204; reinicio de MFA por un administrador global; `docs/security/mfa.md`). La UI en Usuarios del backoffice está pendiente.
>
> Definido en F08 (`CONTRACT_DEFINED`, ya en `openapi.yaml`; API pendiente): `GET /v1/branches/{id}/hours`, `GET /v1/branches/{id}/availability`, `GET|PUT /v1/admin/branches/{id}/hours`, `GET|POST /v1/admin/branches/{id}/closures`, `PATCH|DELETE /v1/admin/branches/{id}/closures/{closureId}`. Los esquemas draft `BranchHours`/`BranchAvailability` pasaron a `DraftBranchHours`/`DraftBranchAvailability`.
> Implementado en F04 (`API_IMPLEMENTED`): `PATCH /v1/me` y `GET /v1/me/storefront` (`operationId` `updateMe` y `getCustomerStorefront`). `GET /v1/me` sigue siendo de F01. El correo es solo lectura.
>
> Implementado en F05 (`API_IMPLEMENTED`, migración 0008, ADR-0014; la web lo consume por el adaptador http): `GET|POST /v1/me/addresses`, `GET|PATCH|DELETE /v1/me/addresses/{id}`, `PATCH /v1/me/addresses/{id}/default` (`listMyAddresses`, `createMyAddress`, `getMyAddress`, `updateMyAddress`, `deleteMyAddress`, `setDefaultMyAddress`). Sustituyen al simulado `PUT /v1/demo/me/default-address` (retirado).
>
> Definido en F09 (`CONTRACT_DEFINED`, ya en `openapi.yaml`; API pendiente): `GET /v1/locations/departments`, `GET /v1/locations/municipalities?departmentId`, `GET|POST /v1/admin/delivery-zones`, `GET|PATCH /v1/admin/delivery-zones/{id}`, `PATCH /v1/admin/delivery-zones/{id}/status`, `GET|PATCH /v1/admin/branches/{id}/delivery-settings`, `POST /v1/delivery-coverage/check`. La cobertura por proveedor de `POST /v1/delivery-coverage/check` reemplaza la parte de cobertura de `GET /v1/delivery/quote`; la cotización/ETA de ese endpoint se redefine en F19 (PedidosYa real: F29, `BLOCKED_EXTERNAL`). Los esquemas draft `Department`/`Municipality` pasaron a `DraftDepartment`/`DraftMunicipality`.
>
> Implementado en F06 (`API_IMPLEMENTED`, en `openapi.yaml`; catálogo real aportado por F11: `ProductsCatalogAdapter`; ver nota de F11): `GET /v1/me/favorites` (`listMyFavorites`), `PUT|DELETE /v1/me/favorites/{productId}` (`addMyFavorite`, `removeMyFavorite`). `GET` devuelve `items` paginados + `favoriteProductIds` completo (≤ 200) para los corazones; `PUT`/`DELETE` responden 204 y son idempotentes. Con F11 el puerto se enlaza al catálogo real (solo productos visibles): un producto inexistente, inactivo o con categoría oculta responde `404 PRODUCT_NOT_FOUND` en `PUT`; `503 CATALOG_UNAVAILABLE` (y `UNKNOWN` en `GET`) queda solo para un catálogo caído o con timeout. Ya no devuelve `string[]`.
>
> Implementado en F07 (`API_IMPLEMENTED`, ya en `openapi.yaml`): `GET /v1/branches[/{id}]` y `/v1/admin/branches[/{id}[/status]]`; se retiraron de esta tabla.
>
> Implementado en F10 (`API_IMPLEMENTED`, ya en `openapi.yaml`): `GET /v1/store/categories` (sustituye a `/v1/catalog/categories`) y `GET/POST /v1/admin/categories`, `PATCH /v1/admin/categories/{id}`, `PUT /v1/admin/categories/reorder` (sustituyen a `/v1/backoffice/categories`); se retiraron de esta tabla. Migración `0011_categories` pendiente de aplicar por el usuario.
>
> Implementado en F11 (`API_IMPLEMENTED` en la API; BD: migración `0012_products` pendiente de aplicar por el usuario; ya en `openapi.yaml`, ADR-0017): `GET /v1/store/products` (`listStoreProducts`), `GET /v1/store/products/{slug}` (`getStoreProduct`), `GET|POST /v1/admin/products` (`listAdminProducts`, `createAdminProduct`), `GET|PATCH /v1/admin/products/{id}` (`getAdminProduct`, `updateAdminProduct`). Sustituyen a `GET /v1/catalog/products` (sin precio ni disponibilidad por sucursal, que son de F13) y a `GET/POST|PATCH /v1/backoffice/products`; esas filas se conservan abajo solo como referencia de la parte aún simulada (disponibilidad por sucursal F13, modificadores F12, promociones F15). Precio como cadena decimal (`"85.00"`); sin DELETE (se desactiva); la web aún usa mocks hasta integrar su slice. Códigos de error con `code`: `PRODUCT_NOT_FOUND`, `PRODUCT_SLUG_TAKEN`, `PRODUCT_SKU_TAKEN`, `PRODUCT_CATEGORY_INVALID`, `PRODUCT_MEDIA_INVALID`, `PRODUCTS_BUSY`.
> Implementado en F12 (`API_IMPLEMENTED` en la API; BD: migración `0013_product_modifiers` pendiente de aplicar por el usuario; ya en `openapi.yaml`, ADR-0018): `GET|POST /v1/admin/modifier-groups` (`listAdminModifierGroups`, `createAdminModifierGroup`), `GET|PATCH /v1/admin/modifier-groups/{id}` (`getAdminModifierGroup`, `updateAdminModifierGroup`), `POST /v1/admin/modifier-groups/{id}/modifiers` (`createAdminModifier`), `PUT /v1/admin/modifier-groups/{id}/modifiers/reorder` (`reorderAdminModifiers`), `PATCH /v1/admin/modifiers/{id}` (`updateAdminModifier`), `GET /v1/admin/products/{id}/modifiers` (`getAdminProductModifiers`), `PUT /v1/admin/products/{id}/modifier-groups` (`replaceAdminProductModifierGroups`); `GET /v1/store/products/{slug}` añade `modifierGroups` (solo grupos ofrecibles y opciones activas; la lista pública no cambia). Sin DELETE (se desactiva); precio extra como cadena decimal (`"0.00"`-`"9999.99"`). `ModifierSelectionService.validate` (validador de selecciones, 422 `MODIFIER_SELECTION_INVALID`) existe como servicio SIN endpoint: lo consumirán F19/F20. Códigos con `code`: `MODIFIER_GROUP_NOT_FOUND`, `MODIFIER_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `MODIFIER_GROUP_NAME_TAKEN`, `MODIFIER_NAME_TAKEN`, `MODIFIER_LIMITS_INVALID`, `MODIFIER_GROUP_UNSATISFIABLE`, `MODIFIER_LIMIT_REACHED`, `MODIFIER_REORDER_MISMATCH`, `MODIFIER_GROUP_INVALID`, `MODIFIERS_BUSY` (503). La web sigue con extras simulados hasta integrar su slice.

| Método           | Ruta                                                       | Esquema de respuesta                    | Uso                                                                 | Auth prevista               |
| ---------------- | ---------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- | --------------------------- |
| GET              | `/v1/store/config`                                         | `StoreConfig`                           | moneda, horarios, reglas de programación, contacto                  | pública                     |
| GET              | `/v1/delivery/quote?branchId&department&municipality&zone` | `DeliveryQuote`                         | tarifa y ETA por zona                                               | pública                     |
| GET              | `/v1/catalog/products?branchId&categoryId`                 | `Product[]`                             | menú (disponibilidad por sucursal)                                  | pública                     |
| GET              | `/v1/promotions`                                           | `Promotion[]`                           | promociones vigentes y Happy Hour                                   | pública                     |
| POST             | `/v1/orders`                                               | `Order`                                 | crear pedido (body `CreateOrderRequest`)                            | pública/cliente             |
| GET              | `/v1/orders/{id}`                                          | `Order`                                 | seguimiento (cliente dueño)                                         | cliente                     |
| POST             | `/v1/orders/lookup`                                        | `Order`                                 | consulta invitado (body `{ orderNumber, phone }`)                   | pública, rate-limit         |
| POST             | `/v1/payments/card`                                        | `PaymentResult`                         | pago con tarjeta (NeoNet ⏳; mock: tarjetas de prueba)              | pública                     |
| POST             | `/v1/incidents`                                            | `Incident`                              | reclamo de un pedido                                                | cliente/invitado verificado |
| POST             | `/v1/job-applications`                                     | `JobApplication`                        | postulación                                                         | pública                     |
| GET              | `/v1/auth/context`                                         | `AuthContextResponse`                   | identidad + autorización + MFA (✅ API F01/F02)                     | autenticado                 |
| GET/PATCH        | `/v1/me`                                                   | `MeResponse`                            | perfil del cliente (✅ GET F01 · PATCH F04: solo nombre y teléfono) | cliente                     |
| GET              | `/v1/me/storefront`                                        | `CustomerStorefrontContext`             | contexto agregado de Mi cuenta (✅ F04; sin contadores de F06/F23)  | cliente                     |
| GET/POST         | `/v1/me/addresses`                                         | `CustomerAddress[]` / `CustomerAddress` | direcciones guardadas (✅ F05; máx. 10 por cliente)                 | cliente                     |
| GET/PATCH/DELETE | `/v1/me/addresses/{id}`                                    | `CustomerAddress`                       | detalle, edición y borrado (✅ F05; ajena = 404)                    | cliente                     |
| PATCH            | `/v1/me/addresses/{id}/default`                            | `CustomerAddress`                       | predeterminada, transaccional (✅ F05)                              | cliente                     |
| GET/POST         | `/v1/me/addresses` · PATCH/DELETE `/v1/me/addresses/{id}`  | `Address`                               | direcciones                                                         | cliente                     |
| GET/PUT/DELETE   | `/v1/me/favorites[/{productId}]`                           | `CustomerFavorites` · 204               | favoritos (✅ contrato F06; API pendiente, catálogo F11)            | cliente                     |
| GET              | `/v1/me/orders`                                            | `Order[]`                               | historial del cliente                                               | cliente                     |
| GET              | `/v1/backoffice/me`                                        | `StaffUser`                             | sesión del personal y permisos                                      | personal                    |
| GET              | `/v1/backoffice/dashboard?branchId`                        | `DashboardSummary`                      | KPIs del panel                                                      | personal                    |
| GET              | `/v1/backoffice/orders?branchId&status&date`               | `Order[]`                               | lista de pedidos                                                    | personal                    |
| PATCH            | `/v1/backoffice/orders/{id}/status`                        | `Order`                                 | transición (body `{ status, reason? }`)                             | personal por rol            |
| POST             | `/v1/backoffice/orders/{id}/dispatch`                      | `Order`                                 | despacho (body `{ provider, riderId? }`)                            | encargado/admin             |
| POST             | `/v1/backoffice/deliveries/quote`                          | `CourierQuote`                          | cotización PedidosYa ⏳ (mock)                                      | encargado/admin             |
| PATCH            | `/v1/backoffice/deliveries/{orderId}/advance`              | `Order`                                 | avanzar estado logístico (solo simulación)                          | encargado/admin             |
| GET              | `/v1/backoffice/deliveries?from&to&branchId&provider`      | `Order[]`                               | envíos del periodo                                                  | encargado/admin             |
| GET              | `/v1/backoffice/riders`                                    | `Rider[]`                               | repartidores propios                                                | encargado/admin             |
| GET/POST · PATCH | `/v1/backoffice/products[/{id}]`                           | `Product`                               | catálogo (editar: admin; disponibilidad: encargado)                 | personal                    |
| GET/POST · PATCH | `/v1/backoffice/promotions[/{id}]`                         | `Promotion`                             | promociones                                                         | admin                       |
| GET              | `/v1/backoffice/reports/summary?from&to&branchId`          | `ReportSummary`                         | reportes                                                            | admin/encargado             |
| GET              | `/v1/backoffice/reports/history?from&to&branchId`          | `Order[]`                               | historial                                                           | admin/encargado             |

Errores: cuerpo `ErrorResponse` (`statusCode`, `error`, `message`) — el cliente lo normaliza a `ApiError`.

## 🎭 Rutas solo de simulación (nunca en la API real)

Existen únicamente en el adaptador mock (`sushimon-web/src/mocks/handlers/orders.ts`); la UI solo las ofrece si
`client.kind === 'mock'` y las rotula "Simulación". Con `DATA_SOURCE=http` responderían 404.

| Método | Ruta                           | Respuesta | Uso                                                                    |
| ------ | ------------------------------ | --------- | ---------------------------------------------------------------------- |
| POST   | `/v1/demo/orders/{id}/advance` | `Order`   | botón "Ver siguiente estado (simulación)" del seguimiento de la tienda |
| POST   | `/v1/demo/orders/simulate`     | `Order`   | pedido entrante simulado del backoffice (body opcional `{ branchId }`) |

## Notas de los esquemas draft

- `DeliveryStatus` incluye `failed` (PedidosYa no encontró repartidor; escenario `rider-unavailable`): el pedido
  sigue `ready` y se puede volver a despachar.
- `StaffRole` = `admin | manager | kitchen` (encargado = `manager`, cocina = `kitchen`); permisos en `StaffPermission`.
- Cuerpos auxiliares draft: `OrderLookupRequest`, `CardPaymentRequest`, `OrderStatusChangeRequest`, `DispatchRequest`,
  `CreateIncidentRequest`, `JobApplicationRequest`, `AddressInput`, `PromotionInput`, `StaffUserInput`.
- `GET /v1/backoffice/orders?status=` admite una lista separada por comas.
- `CardPaymentRequest` es solo para la simulación: la integración real con NeoNet tokenizará en el navegador y el
  servidor no recibirá PAN/CVV (⏳ documentación del proveedor).
