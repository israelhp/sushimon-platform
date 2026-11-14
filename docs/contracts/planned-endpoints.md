# Endpoints previstos (📐 planificados · 🎭 simulados en la web)

Fuente única de las rutas que consume `sushimon-web` (`src/lib/data-access/paths.ts`). Hoy **solo existen en el
adaptador mock**; se añaden a `openapi.yaml` (sección `paths`) en la Etapa 2/3, slice a slice, cuando la API los
implemente (`contracts:check` exige que contrato y API coincidan). Los esquemas ya están en
`components/schemas` con `x-status: draft`.

> Implementado en F03 (`API_IMPLEMENTED`): `/v1/admin/staff[...]`, `/v1/admin/roles[...]`, `/v1/admin/permissions` (reemplazan a `/v1/backoffice/users`).
>
> Implementado en F07 (`API_IMPLEMENTED`, ya en `openapi.yaml`): `GET /v1/branches[/{id}]` y `/v1/admin/branches[/{id}[/status]]`; se retiraron de esta tabla.

| Método           | Ruta                                                       | Esquema de respuesta  | Uso                                                    | Auth prevista               |
| ---------------- | ---------------------------------------------------------- | --------------------- | ------------------------------------------------------ | --------------------------- |
| GET              | `/v1/store/config`                                         | `StoreConfig`         | moneda, horarios, reglas de programación, contacto     | pública                     |
| GET              | `/v1/delivery/quote?branchId&department&municipality&zone` | `DeliveryQuote`       | tarifa y ETA por zona                                  | pública                     |
| GET              | `/v1/catalog/categories`                                   | `Category[]`          | categorías visibles                                    | pública                     |
| GET              | `/v1/catalog/products?branchId&categoryId`                 | `Product[]`           | menú (disponibilidad por sucursal)                     | pública                     |
| GET              | `/v1/promotions`                                           | `Promotion[]`         | promociones vigentes y Happy Hour                      | pública                     |
| POST             | `/v1/orders`                                               | `Order`               | crear pedido (body `CreateOrderRequest`)               | pública/cliente             |
| GET              | `/v1/orders/{id}`                                          | `Order`               | seguimiento (cliente dueño)                            | cliente                     |
| POST             | `/v1/orders/lookup`                                        | `Order`               | consulta invitado (body `{ orderNumber, phone }`)      | pública, rate-limit         |
| POST             | `/v1/payments/card`                                        | `PaymentResult`       | pago con tarjeta (NeoNet ⏳; mock: tarjetas de prueba) | pública                     |
| POST             | `/v1/incidents`                                            | `Incident`            | reclamo de un pedido                                   | cliente/invitado verificado |
| POST             | `/v1/job-applications`                                     | `JobApplication`      | postulación                                            | pública                     |
| GET              | `/v1/auth/context`                                         | `AuthContextResponse` | identidad + autorización + MFA (✅ API F01/F02)        | autenticado                 |
| GET/PATCH        | `/v1/me`                                                   | `Customer`            | perfil del cliente                                     | cliente                     |
| GET/POST         | `/v1/me/addresses` · PATCH/DELETE `/v1/me/addresses/{id}`  | `Address`             | direcciones                                            | cliente                     |
| GET/PUT/DELETE   | `/v1/me/favorites[/{productId}]`                           | `string[]`            | favoritos                                              | cliente                     |
| GET              | `/v1/me/orders`                                            | `Order[]`             | historial del cliente                                  | cliente                     |
| GET              | `/v1/backoffice/me`                                        | `StaffUser`           | sesión del personal y permisos                         | personal                    |
| GET              | `/v1/backoffice/dashboard?branchId`                        | `DashboardSummary`    | KPIs del panel                                         | personal                    |
| GET              | `/v1/backoffice/orders?branchId&status&date`               | `Order[]`             | lista de pedidos                                       | personal                    |
| PATCH            | `/v1/backoffice/orders/{id}/status`                        | `Order`               | transición (body `{ status, reason? }`)                | personal por rol            |
| POST             | `/v1/backoffice/orders/{id}/dispatch`                      | `Order`               | despacho (body `{ provider, riderId? }`)               | encargado/admin             |
| POST             | `/v1/backoffice/deliveries/quote`                          | `CourierQuote`        | cotización PedidosYa ⏳ (mock)                         | encargado/admin             |
| PATCH            | `/v1/backoffice/deliveries/{orderId}/advance`              | `Order`               | avanzar estado logístico (solo simulación)             | encargado/admin             |
| GET              | `/v1/backoffice/deliveries?from&to&branchId&provider`      | `Order[]`             | envíos del periodo                                     | encargado/admin             |
| GET              | `/v1/backoffice/riders`                                    | `Rider[]`             | repartidores propios                                   | encargado/admin             |
| GET/POST · PATCH | `/v1/backoffice/products[/{id}]`                           | `Product`             | catálogo (editar: admin; disponibilidad: encargado)    | personal                    |
| GET/POST · PATCH | `/v1/backoffice/categories[/{id}]`                         | `Category`            | orden/visibilidad                                      | admin                       |
| GET/POST · PATCH | `/v1/backoffice/promotions[/{id}]`                         | `Promotion`           | promociones                                            | admin                       |
| GET              | `/v1/backoffice/reports/summary?from&to&branchId`          | `ReportSummary`       | reportes                                               | admin/encargado             |
| GET              | `/v1/backoffice/reports/history?from&to&branchId`          | `Order[]`             | historial                                              | admin/encargado             |

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
