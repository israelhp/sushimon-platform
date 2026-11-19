# F23 — Historial, reordenamiento y documentos de pedido

**Rama**: `feature/F23-order-history` (desde `develop` 2c0f6dd, que incluye F20, F21 y F22) · **Dueño**: A · **Prioridad**: P1 · **Tipo**: API + WEB (Mis pedidos, recibo y «Volver a pedir»)
**Dependencias**: F20 (pedidos y snapshots), F21 (seguimiento y mapeo de estados públicos), F01/F04 (identidad del cliente) · **Integración**: F18 (carrito local) y F19 (cotización definitiva), F11–F13 (catálogo, extras y precio/disponibilidad por sucursal) · **Integración posterior**: F24 (pago real en el recibo), F31 (avisos) · **Decisiones**: `docs/adr/0029-historial-reorden-recibos.md` · **Pendientes**: P75–P81 en `docs/business-rules/decisiones-pendientes.md`
**Estado de integración inicial: `CONTRACT_DEFINED`** (operaciones `listMyOrders`, `getOrderReceipt`, `previewOrderReorder` y esquemas `MyOrder*`, `OrderReceipt*`, `OrderReorder*` en `openapi.yaml`, tags `me`/`orders`; sin migración, API ni web). `pnpm contracts:generate` ejecutado; `pnpm contracts:check` queda rojo SOLO por esas 3 operaciones sin implementar. Estado de la feature en el backlog: no se edita aquí. PedidosYa real: `BLOCKED_EXTERNAL`.

## 1. Alcance y fuera de alcance

Dentro: historial paginado del cliente autenticado (`GET /v1/me/orders`); detalle histórico reutilizando `GET /v1/orders/{id}` (F20) y el seguimiento de F21; recibo NO fiscal construido desde snapshots (`GET /v1/orders/{id}/receipt`) con vista HTML imprimible; vista previa de «Volver a pedir» contra el catálogo vigente (`POST /v1/orders/{id}/reorder-preview`) que no crea ni guarda nada; web: Mis pedidos real, detalle con «Ver recibo» y «Volver a pedir», recibo imprimible, flujo con el carrito F18 existente.

Fuera: crear pedidos (F20; «Volver a pedir» solo llena el carrito y la cotización/pedido siguen siendo F19/F20), cobros o estado de pago (F24), factura fiscal FEL/SAT/NIT (no hay feature; P78), PDF y CSV (P81), lista de pedidos de invitados por teléfono o correo y vinculación automática (P59/P62/P77), editar o cancelar desde el cliente (no existe), notificaciones (F31), cambios en el comportamiento de F20/F21/F22, tablas nuevas de historial o de recibos, WebSockets, SSE, Redis, colas, librería PDF o servicios de terceros.

Reutiliza SIN cambiar su comportamiento: `OrdersModule` (gate `ORDERS_DB_GATE` con `rejectIfWaiting`, errores `ORDERS_BUSY`, `authorizedRead` de dueño por JWT o `X-Order-Token`), `OrderDetail*` y `toOrderDetail` de F20, `toPublicStatus`/`isTerminalStatus` de F21 (el MISMO mapeo; no se crea otro), `BranchOffersService.inspect` (F13, en lote), `ModifierSelectionService`/`evaluateSelections` (F12, reglas puras), `BRANCH_AVAILABILITY_PORT` (F08), el contrato `CartQuoteLineInput` (F18) y el filtro global de errores. El códec de cursor de F22 se extrae a un helper común SIN cambiar su comportamiento (las pruebas de F22 siguen verdes).

## 2. Modelo de datos reutilizado y migración

Solo lectura sobre: `orders`, `order_items`, `order_item_modifiers`, `order_promotions`, `order_addresses` (snapshots inmutables de 0018), `customers` (`auth_user_id` único), `branches` (nombre, dirección, teléfono públicos), y, para «Volver a pedir», las tablas vivas de catálogo de F11–F13. NO hay tabla nueva de historial ni de recibos: los pedidos son la fuente de verdad. No se lee `order_status_history`, `order_status_history.reason`, `order_access_tokens`, ni `customer_email`/coordenadas.

### 2.1 Migración: NO hace falta (0019 NO se crea)

La migración 0018 ya creó `orders_customer_placed_idx ON orders (customer_id, placed_at DESC) WHERE customer_id IS NOT NULL` (0018, línea 164) y `order_items_order_idx (order_id)`. La consulta del historial es de igualdad por cliente + orden por `placed_at DESC, id DESC`: el índice existente la sirve en orden, y el desempate por `id` lo resuelve el planificador con ordenación incremental sobre las pocas filas con el mismo `placed_at` (el valor es el `now()` de la transacción creadora, con microsegundos: solo coincide dentro de una misma transacción). Un cliente tiene del orden de decenas o cientos de pedidos; los filtros por estado, sucursal y fecha se evalúan sobre esas filas. Un índice nuevo encarecería cada inserción de pedido sin ganancia medible. Se verifica con `EXPLAIN` en la int-spec (#67). Endurecimiento OPCIONAL, NO adoptado (SQL de referencia para el database-engineer; aditivo, no destructivo, sin datos que migrar):

```sql
-- 0019 (OPCIONAL, NO incluida): índice de keyset exacto del historial del cliente
CREATE INDEX IF NOT EXISTS "orders_customer_placed_id_idx"
    ON "app"."orders" ("customer_id", "placed_at" DESC, "id" DESC) WHERE "customer_id" IS NOT NULL;
-- Reversión: DROP INDEX IF EXISTS "app"."orders_customer_placed_id_idx";
```

Se adopta solo si el `EXPLAIN` con volumen real muestra una ordenación completa sobre más de ~1 000 filas por cliente (no esperado) y con numeración posterior a la última migración de `develop` en ese momento. `schema.prisma` sin cambios.

## 3. Rutas finales y reconciliación con el backlog (sin duplicar)

| Operación                 | Ruta                                     | Acceso                      | `operationId`         | Tag      |
| ------------------------- | ---------------------------------------- | --------------------------- | --------------------- | -------- |
| Historial                 | `GET /v1/me/orders`                      | JWT del cliente             | `listMyOrders`        | `me`     |
| Detalle histórico         | `GET /v1/orders/{id}` (F20, sin cambios) | JWT dueño o `X-Order-Token` | `getOrder`            | `orders` |
| Seguimiento               | `GET /v1/orders/{id}/tracking` (F21)     | JWT dueño o `X-Order-Token` | `getOrderTracking`    | `orders` |
| Recibo (datos)            | `GET /v1/orders/{id}/receipt`            | JWT dueño o `X-Order-Token` | `getOrderReceipt`     | `orders` |
| Vista previa de reordenar | `POST /v1/orders/{id}/reorder-preview`   | JWT dueño o `X-Order-Token` | `previewOrderReorder` | `orders` |

Reconciliación con las rutas propuestas (`docs/BACKLOG.md` F23 y el encargo):

- `GET /v1/me/orders/:id` NO se crea: `GET /v1/orders/{id}` ya devuelve el pedido con líneas, extras, promociones, dirección y totales con la MISMA autorización (dueño por JWT o invitado con token) y el MISMO 404 uniforme. Una segunda ruta duplicaría DTO, autorización y pruebas, y excluiría al invitado, que sí puede ver su pedido.
- `GET /v1/me/orders/:id/receipt` NO se crea: un único `GET /v1/orders/{id}/receipt` (como dice el backlog) sirve al dueño y al invitado con token. Un `/me/` implicaría sesión de cliente y dejaría al invitado sin recibo.
- `POST /v1/me/orders/:id/reorder-preview` pasa a `POST /v1/orders/{id}/reorder-preview` (misma razón: un invitado con token puede volver a pedir; ver §8.1). El borrador `GET /v1/me/orders` (`Order[]`) de `planned-endpoints.md` queda sustituido por `MyOrderPage`.
- `/v1/me/orders` es la única ruta bajo `me`: es una LISTA del cliente (no existe lista de invitados). Las rutas por pedido cuelgan de `/v1/orders/{id}` junto a `tracking`.
- Ningún comando de escritura nuevo: las tres operaciones son de solo lectura (el preview es un POST sin efectos).

## 4. Contrato (fuente: `openapi.yaml`)

### 4.1 `GET /v1/me/orders` (`listMyOrders`)

Parámetros: `status` (lista separada por comas del catálogo `OrderLifecycleStatus`, ≤ 9, fuera de catálogo => 400), `branchId` (uuid), `from`/`to` (instantes de `placed_at` con zona; con ambos, rango máximo 366 días), `cursor`, `limit` (1..50, defecto 20). Sin `from`/`to` se pagina todo el historial (P75). Orden FIJO `placed_at DESC, id DESC`.

`MyOrderSummary`: `id, orderNumber, displayNumber, status, publicStatus, terminal, branchId, branchName, fulfillmentType, deliveryProvider, itemCount, total, currency, paymentMethodPreference, placedAt, updatedAt`. Sin líneas, modificadores, promociones, dirección, teléfono, correo ni notas. `itemCount` = unidades (suma de cantidades) agregadas en SQL. `publicStatus` y `terminal` salen del mapeo de F21 (no se reimplementa en la web). `MyOrderPage`: `items[], nextCursor|null, generatedAt`.

Cursor: opaco = base64url de `(placed_at, id)` (mismo códec que F22), validado por formato; alterado => 400 `ORDER_CURSOR_INVALID`. Como el cliente se aplica SIEMPRE en la consulta (join a `customers.auth_user_id`), un cursor manipulado o de otra consulta no revela nada. Keyset en lugar de `OFFSET`: estable si llegan pedidos nuevos mientras se pagina y de coste constante. Sin conteo total (costoso y sin uso: la web no muestra «N pedidos»; P75).

Un usuario autenticado sin fila en `customers` recibe `200 { items: [], nextCursor: null }` (la lectura no crea el perfil; no es 404). Un pedido de invitado (`customer_id` NULL) nunca coincide. Los pedidos de OTRO cliente nunca se listan: no existe parámetro `customerId`.

### 4.2 `GET /v1/orders/{id}/receipt` (`getOrderReceipt`)

`OrderReceipt` (campos exactos): `fiscalStatus` (`NOT_FISCAL`, constante), `displayNumber`, `status`, `publicStatus`, `placedAt`, `generatedAt`, `timeZone` (`America/Guatemala`, constante), `currency` (`GTQ`), `branch{name, address, phone|null}`, `fulfillment{type, provider|null}`, `address|null` (snapshot DELIVERY: municipio, zona, línea, referencia; sin coordenadas), `contact{fullName, phoneMasked}`, `lines[]` (= `OrderDetailLine`: producto, cantidad, precio unitario, extras con su precio, extras por unidad, subtotal, descuento, total de línea, nota de la línea), `promotions[]` (nombre y monto del snapshot), `notes`, `subtotal`, `extrasTotal`, `discountTotal`, `deliveryFee`, `total`, `payment{methodPreference, status}`.

Qué NO aparece (garantizado y probado): `id` del pedido/líneas/cliente/sucursal, tokens (`X-Order-Token`, `smo_…`, hashes), `customer_email`, teléfono completo, coordenadas, motivo de rechazo o cancelación (P64) y cualquier `order_status_history` (actor, `changed_by`, `reason`), notas administrativas, estados de entrega externos inventados, `Idempotency-Key`/claves. Los importes salen de `numeric(12,2)` serializados como cadena decimal con `toFixed(2)` (misma función que F20) y NUNCA se recalculan desde el catálogo ni cambian si hoy cambia el precio; `total = subtotal − discountTotal + deliveryFee` (el mismo invariante de F20, verificado en prueba).

Pago honesto: `payment.status` es `NOT_STARTED` (F24 no existe): la web escribe «Sin pago registrado» y la preferencia como «Método elegido: efectivo/transferencia», NUNCA «pagado». Pedidos `PEDIDOSYA` históricos: se muestra `provider: PEDIDOSYA` tal cual, sin estados externos. Disponible en TODOS los estados incluidos `rejected`/`cancelled` (P76): el recibo trae `status` y la web imprime la leyenda del estado sin afirmar pago ni motivo.

No hay número de recibo propio ni fecha de emisión fiscal: el identificador es `displayNumber` y `generatedAt` es solo el instante en que el servidor armó los datos. NO es factura: sin FEL, SAT, NIT ni numeración tributaria (P78).

### 4.3 `POST /v1/orders/{id}/reorder-preview` (`previewOrderReorder`)

Cuerpo opcional `OrderReorderRequest {branchId?}` (`additionalProperties: false`: precios, líneas, cantidades o `customerId` => 400). Respuesta 200 `OrderReorderPreview` (§8). No crea pedidos, no escribe en la BD, no guarda borradores, no exige `Idempotency-Key`.

### 4.4 Errores

| HTTP | `code`                 | Cuándo                                                                                                                                                                                                                                                       |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400  | (validación estándar)  | UUID o `X-Order-Token` con formato inválido, `status` fuera del catálogo, fechas sin zona, rango > 366 días, cuerpo con campos desconocidos o `__proto__`, `branchId` que no es UUID                                                                         |
| 400  | `ORDER_CURSOR_INVALID` | cursor alterado o con formato inválido (código ya público de F22)                                                                                                                                                                                            |
| 401  | —                      | JWT presente e inválido o expirado (nunca se degrada a invitado); en `listMyOrders` también la AUSENCIA de JWT                                                                                                                                               |
| 404  | — (sin `code`)         | pedido inexistente, ajeno, de invitado consultado con JWT, o token ausente/inválido/vencido/revocado: MISMO cuerpo y cabeceras que `getOrder` (anti-IDOR)                                                                                                    |
| 404  | `BRANCH_NOT_FOUND`     | `previewOrderReorder` con `branchId` inexistente O INACTIVA distinta a la del pedido (misma respuesta: no se revela el estado de otras sucursales; la sucursal es dato público; se evalúa DESPUÉS de autorizar el pedido, así no sirve para sondear pedidos) |
| 429  | `RATE_LIMITED`         | throttle propio de cada ruta (con `Retry-After`)                                                                                                                                                                                                             |
| 503  | `ORDERS_BUSY`          | gate saturado, timeout o fallo reintentable (código ya público de F20; **sin códigos 5xx nuevos**)                                                                                                                                                           |

F23 NO añade códigos de error HTTP nuevos. Los diagnósticos de «Volver a pedir» (sucursal inactiva, producto agotado, opción retirada…) NO son errores: viajan en un 200 con el estado por línea, porque el preview es una consulta de estado, no una orden que pueda fallar.

## 5. Autorización, anti-IDOR e invitados

1. `listMyOrders`: autenticación obligatoria (denegar por defecto; sin `@OptionalAuth`). El propietario sale SOLO del `sub` verificado del JWT y se aplica EN SQL (`JOIN customers c ON c.id = o.customer_id AND c.auth_user_id = $sub`); no existe `customerId` en ruta, consulta ni cuerpo. Un token de personal sin cuenta de cliente obtiene lista vacía (no hay lectura de pedidos ajenos).
2. `getOrder` (detalle), `getOrderReceipt` y `previewOrderReorder`: `@OptionalAuth` y la MISMA `authorizedRead` de F20/F21: primero el token de invitado (`X-Order-Token`, formato `smo_` + 43, sha256, vigente 14 días, no revocado), luego el dueño por JWT con join a `customers.auth_user_id` (en la misma consulta, sin leer antes la fila del cliente). Cualquier otro caso => el mismo 404. El token NUNCA va en la URL.
3. Pedidos de invitado NUNCA son visibles con JWT (P59) ni aparecen en `listMyOrders`. Un invitado que inicia sesión NO vincula sus pedidos anteriores (P77, recomendación por defecto: no vincular; un reclamo futuro exigiría verificación del titular, p. ej. código al teléfono, y su propia feature). Mientras tanto conserva el acceso por pedido con el token guardado en `sessionStorage` (F20/F21) y la web lo explica en el listado vacío.
4. El invitado puede usar recibo y vista previa: ambos solo exponen lo que su token ya autoriza (`getOrder` devuelve las mismas líneas y extras; el catálogo vigente es público). No se crea ninguna capacidad de escritura con el token.
5. 404 uniforme: pedido inexistente y ajeno comparten cuerpo, cabeceras y número de sentencias (prueba). `BRANCH_NOT_FOUND` de `previewOrderReorder` se emite solo tras autorizar.
6. PII: lista con nombre de sucursal y total, sin contacto. Recibo y detalle: teléfono ENMASCARADO, sin correo ni coordenadas. Sin PII en logs: solo `requestId`, `orderId`, estado y código (el nivel `debug` de F21 se imita: `order.history count=N`, `order.receipt orderId=… status=…`, `order.reorder lines=N available=M`). Sin auditoría de lecturas (volumen; riesgo aceptado: mismo criterio que F21/P70).
7. Cabeceras en TODA respuesta, errores incluidos: `Cache-Control: private, no-store`, `Vary: Authorization` (lista) o `Vary: Authorization, X-Order-Token` (por pedido), sin `ETag` (no hay 304). Ni proxies ni CDN guardan estas respuestas.
8. Throttles propios (contadores independientes de F20/F21; por instancia, riesgo conocido de F21): `listMyOrders` 120/min por IP y 60/min por actor; `getOrderReceipt` 60/min por IP y 30/min por actor (igual que `getOrder`); `previewOrderReorder` 30/min por IP y 15/min por actor (cuesta ~7 sentencias). 429 con `Retry-After`. Los intentos con token inválido cuentan.
9. Ninguna ruta llama a PedidosYa o Neonet, ni escribe tablas de pagos, entregas o pedidos.

## 6. Listado: SQL, filtros y rendimiento

Una sola sentencia (parámetros enlazados; nada del cliente se interpola; `status` y `branchId` llegan validados):

```sql
SELECT o.id, o.order_number, o.status, o.branch_id, b.name AS branch_name, o.fulfillment_type, o.delivery_provider,
       o.total, o.payment_method_preference, o.placed_at, o.updated_at,
       COALESCE((SELECT sum(i.quantity) FROM app.order_items i WHERE i.order_id = o.id), 0)::int AS item_count
  FROM app.orders o
  JOIN app.customers c ON c.id = o.customer_id AND c.auth_user_id = :authUserId
  JOIN app.branches b ON b.id = o.branch_id
 WHERE (:statuses::text[] IS NULL OR o.status = ANY(:statuses))
   AND (:branchId::uuid IS NULL OR o.branch_id = :branchId)
   AND (:from::timestamptz IS NULL OR o.placed_at >= :from)
   AND (:to::timestamptz IS NULL OR o.placed_at < :to)
   AND (:curAt::timestamptz IS NULL OR o.placed_at < :curAt OR (o.placed_at = :curAt AND o.id < :curId::uuid))
 ORDER BY o.placed_at DESC, o.id DESC
 LIMIT :limitPlusOne;
```

Se leen `limit + 1` filas para saber si hay siguiente página (sin conteo). El subselect de unidades usa `order_items_order_idx`; las columnas `numeric` se serializan con `toFixed(2)`. `publicStatus`/`terminal` se derivan en memoria con el mapeo de F21. Lecturas bajo `ORDERS_DB_GATE` con `rejectIfWaiting: 2` (503 `ORDERS_BUSY`; las plazas restantes siguen reservadas a escrituras). Tope de `limit` 50; defecto 20.

Presupuesto de sentencias SQL del dominio (la verificación del JWT no cuenta): **listado ≤ 2** (esperado 1), **detalle `getOrder` sin cambios** (F20), **recibo ≤ 5** (pedido+sucursal, líneas+extras, promociones, dirección; mismo coste que `getOrder`), **vista previa ≤ 9** (típico 7; §8.4). Se MIDE contra PostgreSQL real en la int-spec (#66–#67); no se afirma antes. Ninguna operación hace una consulta por pedido, por línea ni por producto.

## 7. Detalle, seguimiento y recibo en la web

El detalle histórico es la pantalla existente `/pedidos/[id]` (F20/F21: sirve al dueño y al invitado con token) y el seguimiento sigue en `/pedidos/[id]/seguimiento`. F23 le añade «Ver recibo» (`/pedidos/[id]/recibo`) y «Volver a pedir». No se crea `/cuenta/pedidos/[id]`: dos pantallas de detalle duplicarían la lógica de acceso del invitado. En un pedido en curso, «Seguimiento» es la acción principal; en uno terminal, «Volver a pedir».

## 8. «Volver a pedir»: vista previa contra el catálogo vigente

### 8.1 Quién puede usarla

Dueño (JWT) e invitado con `X-Order-Token`. Justificación: la respuesta contiene (a) las líneas y extras del pedido original, que el titular del token ya puede ver, y (b) catálogo, precios y disponibilidad vigentes, que son públicos. No expone más datos que `getOrder`. El carrito F18 es local y anónimo, así que no hay diferencia de efecto entre un cliente y un invitado.

### 8.2 Forma de salida (`OrderReorderPreview`)

`generatedAt`, `source{displayNumber, status, fulfillmentType, deliveryProvider, placedAt}`, `branch{originalBranchId, requestedBranchId, sameBranch, name, active, acceptingOrders, reason, nextOpensAt}`, `lines[]` y `summary`. Cada línea (`OrderReorderLine`, mismo orden que `lineNo`): `status` (`AVAILABLE` | `NEEDS_CONFIGURATION` | `UNAVAILABLE`), `original` (snapshot), `current{unitPrice, extrasPerUnit}|null` (precios vigentes de la sucursal, solo para mostrar), `issues[]` y `candidate|null`. `candidate = {line: CartQuoteLineInput, slug, note, display{name, imageUrl, unitPrice, options[]}}`: `line` es EXACTAMENTE la forma del contrato de carrito F18/F19 (`productId`, `quantity`, `selections` ordenadas por `groupId`/`optionId`) y `slug`/`note`/`display` permiten construir la línea del carrito local sin otra petición. `summary`: `lines, available, needsConfiguration, unavailable, priceChanged, units, estimatedSubtotal, canAddAny`.

Lo que NO se copia (se vuelve a elegir o se recalcula en F19/F20): precios, extras históricos, promociones, cupón, tarifa de entrega, modalidad (`PICKUP`/`DELIVERY`), proveedor, dirección, método de pago y notas generales del pedido. `source.fulfillmentType` es solo informativo para decirle al cliente «tu pedido original era a domicilio».

### 8.3 Diagnósticos (`OrderReorderIssueCode`)

| Código                       | Severidad | Efecto en la línea    | Cuándo                                                                                                                    |
| ---------------------------- | --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `BRANCH_UNAVAILABLE`         | blocking  | `UNAVAILABLE`         | la sucursal ORIGINAL del pedido está inactiva (todas las líneas; no se evalúa el resto)                                   |
| `PRODUCT_REMOVED`            | blocking  | `UNAVAILABLE`         | el producto no existe (o el snapshot no conserva `product_id`)                                                            |
| `PRODUCT_INACTIVE`           | blocking  | `UNAVAILABLE`         | producto inactivo o categoría no visible                                                                                  |
| `PRODUCT_OUT_OF_STOCK`       | blocking  | `UNAVAILABLE`         | agotado en la sucursal (F13)                                                                                              |
| `OPTION_REMOVED`             | warning   | `NEEDS_CONFIGURATION` | la opción ya no pertenece a ningún grupo del producto                                                                     |
| `OPTION_INACTIVE`            | warning   | `NEEDS_CONFIGURATION` | la opción o su grupo están inactivos                                                                                      |
| `GROUP_RULE_CHANGED`         | warning   | `NEEDS_CONFIGURATION` | la selección retenida excede el máximo vigente del grupo                                                                  |
| `REQUIRED_SELECTION_MISSING` | warning   | `NEEDS_CONFIGURATION` | hay un grupo obligatorio vigente sin la selección mínima (grupo nuevo o por opciones omitidas)                            |
| `PRICE_CHANGED`              | info      | (no cambia)           | precio por unidad vigente ≠ histórico, ambos con los mismos extras retenidos; trae `previousUnitPrice`/`currentUnitPrice` |
| `QUANTITY_ADJUSTED`          | info      | (no cambia)           | la cantidad histórica excede el tope vigente (99); `from`/`to`                                                            |
| `NOTE_DROPPED`               | info      | (no cambia)           | la nota no cumple el formato vigente (> 140 o caracteres no permitidos) y se omite                                        |

Estados de la sucursal (no son diagnósticos de línea): `branch.acceptingOrders=false` con `reason` (`OUTSIDE_BUSINESS_HOURS`, `EXCEPTIONAL_CLOSURE`, `SCHEDULE_NOT_CONFIGURED`) avisa pero NO impide añadir al carrito: F19 decide al cotizar. `branch.active=false` bloquea todas las líneas SOLO cuando es la sucursal ORIGINAL del pedido; si se pide OTRA sucursal que está inactiva, la respuesta es 404 `BRANCH_NOT_FOUND`, igual que una inexistente (sin nombre ni `INACTIVE`). Una opción retirada o inactiva se OMITE de `selections` y se informa; jamás se sustituye por otra. Una línea con selección obligatoria nueva o regla cambiada es `NEEDS_CONFIGURATION`: el cliente vuelve a configurarla.

### 8.4 Algoritmo agrupado (sin una petición por producto)

```
1  autorizar y leer el pedido (UNA sentencia: cabecera + líneas + extras agregados con json_agg), gate ORDERS con rejectIfWaiting 2
   404 uniforme si no hay acceso
2  branchId = body.branchId ?? pedido.branch_id
3  pasos dentro de 1 adquisición del gate (como mucho 3 conexiones simultáneas):
     a  (en paralelo) BRANCH_AVAILABILITY_PORT.canAcceptOrderNow(branchId) + nombre de la sucursal SOLO si es distinta a la del pedido
                                                                    -- inexistente => 404 BRANCH_NOT_FOUND; DISTINTA e INACTIVE => 404 BRANCH_NOT_FOUND (idéntico);
                                                                       ORIGINAL e INACTIVE => bloquea todo SIN pasos b-d
     b  (en paralelo, solo sucursal activa) BranchOffersService.inspect(branchId, productIds únicos)  -- 2 sentencias: categorías visibles + resolveMany
                                            ofertas de modificadores de TODOS los productos          -- 1 sentencia (findOffers: lector de solo lectura de findOffersMany)
     c  presentación (slug, nombre, imagen principal) por ids OK     -- 2 sentencias (productos activos + media principal)
4  por línea (en memoria, función pura y determinista):
     producto: UNKNOWN => PRODUCT_REMOVED; HIDDEN => PRODUCT_INACTIVE; SOLD_OUT => PRODUCT_OUT_OF_STOCK
     extras: cada modifier_id se busca en los grupos VIGENTES del producto (índice modifierId -> grupo, opción)
             no está => OPTION_REMOVED(optionName del snapshot); opción o grupo inactivos => OPTION_INACTIVE; si no, se RETIENE
     reglas: evaluateSelections(grupos vigentes, retenidas): MODIFIER_TOO_MANY => GROUP_RULE_CHANGED; MODIFIER_REQUIRED => REQUIRED_SELECTION_MISSING
     cantidad: min(cantidad, 99) (QUANTITY_ADJUSTED si cambia); nota: normalizada a ≤ 140 o NOTE_DROPPED
     precio: current.unitPrice = precio efectivo F13; extrasPerUnit = suma de extras retenidos a precio vigente;
             PRICE_CHANGED si (unitPrice vigente + extras retenidos) ≠ (unit_price histórico + extras retenidos a su precio histórico)
     estado: UNAVAILABLE | NEEDS_CONFIGURATION (algún warning) | AVAILABLE
5  resumen: contadores y estimatedSubtotal = Σ (current.unitPrice + current.extrasPerUnit) × cantidad de las AVAILABLE, en centavos enteros
```

Presupuesto: ≤ 9 sentencias independientes del número de líneas. Típico 7 (1 pedido + 1 disponibilidad + 2 inspect + 1 ofertas + 2 presentación); sucursal distinta 8 (+ nombre); PEOR CASO 9 (token que falla + dueño + sucursal distinta). Pasos con como mucho 3 conexiones simultáneas por plaza del gate: (1) disponibilidad y, si la sucursal es distinta, su nombre; (2) solo con la sucursal activa, `inspect` y ofertas; (3) presentación, verificado con un pedido de 30 líneas (#43). El orden de los diagnósticos es determinista (por línea, luego por orden de aparición de la opción). Los importes se manejan en centavos enteros; nunca coma flotante.

### 8.5 Relación con F18/F19/F20

El preview NO es una cotización: no devuelve token de cotización ni totales finales. El cliente añade las líneas `AVAILABLE` al carrito (F18) y el checkout llama a `POST /v1/checkout/quote` (F19) con SUS propios datos (modalidad, dirección, cupón); el pedido lo crea `POST /v1/orders` (F20) con recotización del servidor. Reordenar un pedido `DELIVERY`: la modalidad y la dirección se vuelven a elegir en el checkout y la tarifa de entrega se recalcula; PedidosYa sigue `BLOCKED_EXTERNAL` (`DELIVERY_PROVIDER_NOT_SELECTABLE` de F20 aplica). El precio histórico solo aparece como dato informativo en `PRICE_CHANGED`.

## 9. Web

### 9.1 Rutas (sin romper las actuales)

| Ruta                        | Pantalla                                                   | Notas                                                                                                                              |
| --------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/cuenta/pedidos`           | Mis pedidos (existente; se reescribe sobre `listMyOrders`) | Ruta CANÓNICA: ya forma parte de «Mi cuenta» (`/cuenta/*`, `AccountHub`). Pestañas «En curso» / «Historial», filtros, «Cargar más» |
| `/mis-pedidos`              | alias existente (redirect a `/cuenta/pedidos`)             | se conserva tal cual (enlaces del prototipo y marcadores)                                                                          |
| `/pedidos/[id]`             | detalle histórico (existente)                              | + «Ver recibo» y «Volver a pedir»; sirve al dueño y al invitado con token                                                          |
| `/pedidos/[id]/seguimiento` | seguimiento F21 (existente)                                | enlace desde el detalle y desde cada fila en curso                                                                                 |
| `/pedidos/[id]/recibo`      | recibo imprimible (NUEVA)                                  | `noindex`; sirve al dueño y al invitado con token                                                                                  |

`/mi-cuenta/pedidos` (nombre citado en el encargo) NO se crea: la app usa `/cuenta` para toda la cuenta y una segunda raíz duplicaría navegación, redirects y enlaces del hub. Si negocio la quiere, es un `redirect` de una línea (sin lógica) y no un cambio de este slice.

### 9.2 Mis pedidos

`useMyOrders` pasa a `useInfiniteQuery` sobre `listMyOrders` (clave `['customer', scope, 'orders', 'history', filtros]`; `gcTime` 60 s; sin `keepPreviousData` entre filtros ni cuentas). Pestaña «En curso» = `status=pending,accepted,preparing,ready,on_the_way`; «Historial» = `delivered,picked_up,rejected,cancelled`; filtros opcionales de sucursal y rango de fechas, enviados al servidor (nunca ordena ni filtra el cliente lo que el servidor ya hace). Cada fila: número, estado (`publicStatus` con ícono y texto, no solo color), fecha en `America/Guatemala`, sucursal, unidades, total y acciones («Seguimiento» si no es terminal, «Ver detalle», «Volver a pedir»). Se retiran del modo `http` el resumen «pedidos / gastado» (requiere conteo total y una regla de qué cuenta como gasto; P75) y cualquier número calculado en el cliente. Estados: carga (esqueleto), vacío («Aún no tienes pedidos» con enlace al menú; para un invitado o un cliente sin pedidos, nota «Si pediste como invitado, abre tu pedido con el enlace de confirmación de este navegador o desde Consultar pedido»), error (`ErrorNotice` con «Reintentar»; 429/503 con espera de `Retry-After`), sin sesión (invitación a iniciar sesión; nunca llama a la API), fin de lista. Sin sondeo: el listado se refresca al montar, al volver el foco y tras crear un pedido (`invalidateOrders`).

### 9.3 Recibo imprimible

Vista HTML con datos de `getOrderReceipt` (no se arma desde el listado ni el carrito). Sin librería PDF ni servicio de terceros: «Imprimir / guardar como PDF» = `window.print()`. Contenido: marca y sucursal (nombre, dirección, teléfono), `displayNumber`, estado, fecha y hora en `America/Guatemala` (`formatDateTime`), modalidad y dirección (DELIVERY), cliente (teléfono enmascarado), líneas con extras y notas, promociones, subtotal, extras, descuento, entrega, total en GTQ (`Q 165.00`), pago honesto y la leyenda fija «Este documento es un recibo informativo del pedido. No es una factura ni un documento fiscal.» (es/en). `rejected`/`cancelled`: banner con el estado, sin motivo y sin afirmar pago. CSS `@media print`: se oculta cabecera, navegación, carrito, barra móvil y botones (`data-print-hide`), fondo blanco, tipografía 11–12 pt, `break-inside: avoid` en filas, `@page { size: A4; margin: 14mm }`; la leyenda se imprime siempre. `document.title = Recibo MON-001042`. Sin `localStorage`, sin `Blob`, sin descarga de archivos, sin service worker. Clave de caché `['orders', 'receipt', scope|'guest', id]` (`gcTime` 60 s, `retry: false`).

### 9.4 Flujo «Volver a pedir» (carrito F18 existente)

1. El botón llama a `previewOrderReorder` con `useMutation` (el resultado vive solo en el diálogo; no queda en caché). Si el pedido sigue en curso, antes pide confirmar: «Este pedido sigue en curso. ¿Pedir otro igual?».
2. `ReorderDialog` (existente, reescrito) muestra por línea el estado con texto (`Disponible`, `Necesita que la configures`, `No disponible`), motivos por código (i18n `reorder.issue.<CODE>`), «Antes Q X → ahora Q Y» (`PRICE_CHANGED`), la sucursal y, si `branch.active=false` o el cliente lo desea, un selector de sucursal (de `useBranches`) que repite el preview. Si `acceptingOrders=false`, avisa pero permite añadir.
3. Carrito vacío: «Añadir al carrito». Carrito con líneas de la MISMA sucursal: opción por defecto «Añadir a mi carrito» (suma con la unificación de F18) y alternativa «Reemplazar mi carrito» que exige confirmación explícita («Se quitarán N productos de tu carrito»). Carrito de OTRA sucursal: se explica y solo se ofrece «Reemplazar mi carrito por este pedido (sucursal X)» con confirmación, o cancelar; nunca se mezclan sucursales ni se vacía solo.
4. Se añaden solo las líneas `AVAILABLE`, todas o ninguna (`addToCart` de F18; un tope excedido se rechaza con los mensajes `REJECTION_KEY` existentes, sin recortar). Las `NEEDS_CONFIGURATION` NO se añaden: botón «Configurar» que abre la ficha del producto (`slug`) con la cantidad y las opciones retenidas como punto de partida si la ficha lo admite; nada entra al carrito hasta que el cliente confirma en la ficha. Las `UNAVAILABLE` se listan sin acción.
5. Tras añadir: aviso accesible («Añadimos N productos. Los precios, promociones y la entrega se calcularán al pagar») y apertura del cajón del carrito. NO se crea pedido ni se llama a la cotización desde aquí.
6. Mock y http comparten UN camino: `ReorderDialog` consume `OrderReorderPreview`; `planReorder` (pedidos sin extras) deja de usarse en el flujo y se retira cuando no queden consumidores.

### 9.5 Cierre de sesión y cachés privadas

Las claves privadas de F23 caen bajo los prefijos ya limpiados por `useCustomerCacheGuard`/`isOtherIdentity`: el historial (`['customer', scope, 'orders', …]`) por el prefijo `customer`; el recibo (`['orders', 'receipt', scope|'guest', id]`) se añade explícitamente a `isOtherIdentity` junto a `tracking` y `placed`. Al cerrar sesión o cambiar de cuenta se descartan y no reaparecen datos de la cuenta anterior. El carrito (anónimo, local) NO se borra al cerrar sesión (comportamiento de F18). Ningún dato de pedidos, recibos ni previews se persiste en `localStorage`/`sessionStorage`; el token de invitado sigue solo en `sessionStorage` (F20/F21).

### 9.6 Modo `mock` y accesibilidad

`mocks/handlers/orders.ts` y `account.ts` responden `GET /v1/me/orders`, `GET /v1/orders/{id}/receipt` y `POST /v1/orders/{id}/reorder-preview` con la forma REAL (derivando de los borradores del demo y de los productos/extras del mock; mismas reglas de diagnóstico, misma tabla de casos que la API; 400/401/404/429/503 del contrato), rotulados «Simulación». Accesibilidad: diálogo con foco devuelto, estados con texto e ícono, objetivos ≥ 44 px, `aria-live="polite"` para el resultado, tema claro/oscuro, móvil 390 px sin desbordamiento, es/en (`orders.history.*`, `receipt.*`, `reorder.*`).

## 10. Decisiones de negocio abiertas (P75–P81; valores seguros adoptados)

| #   | Tema                                         | Valor adoptado por defecto                                                                                                                                                  |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P75 | Ventana del historial y resumen de la cuenta | Todo el historial paginado, sin purga ni límite de antigüedad; sin conteo total ni «gastado» en la web real                                                                 |
| P76 | Cancelados/rechazados en historial y recibo  | Se muestran con su estado; recibo disponible con la leyenda del estado, sin motivo y sin afirmar pago                                                                       |
| P77 | Invitado que inicia sesión                   | NO se vinculan sus pedidos anteriores; acceso por pedido con token (14 días); un reclamo con verificación es una feature futura                                             |
| P78 | Recibo y alcance fiscal                      | HTML imprimible NO fiscal, teléfono enmascarado, sin NIT/razón social/FEL; si contabilidad exige factura FEL es otra feature con proveedor certificado                      |
| P79 | Qué se copia al reordenar                    | Producto, cantidad, extras vigentes y nota por línea; NO precios, promociones, cupón, entrega, dirección, modalidad ni pago; sucursal original por defecto, otra a elección |
| P80 | Reordenar pedidos antiguos o no completados  | Cualquier pedido propio (también rechazado/cancelado/en curso con confirmación) sin límite de antigüedad; el preview diagnostica lo que ya no existe                        |
| P81 | PDF, CSV y exportaciones                     | NO: imprimir o «guardar como PDF» del navegador. Solo se revisa si negocio/contabilidad lo exige (requeriría justificar librería, tamaño de bundle y retención)             |

## 11. Matriz de pruebas (U unitaria · S servicio con dobles · E e2e supertest · I int-spec contra PostgreSQL real · W Vitest web · P Playwright)

| #   | Caso                                                                                                                                                                                                                                                                       | Nivel   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | `listMyOrders` sin JWT => 401; JWT inválido/expirado => 401 (no se degrada a invitado)                                                                                                                                                                                     | E       |
| 2   | Solo pedidos del cliente del JWT: cliente A no ve los de B; token de personal sin cliente => `items: []`; usuario sin fila `customers` => 200 vacío y NO se crea la fila                                                                                                   | S, I    |
| 3   | Pedidos de invitado (`customer_id` NULL) nunca aparecen en la lista ni son accesibles con JWT en detalle, recibo ni preview (404 uniforme)                                                                                                                                 | S, I, E |
| 4   | No existe `customerId` en ninguna ruta/consulta/cuerpo; un `customerId` enviado => 400 (lista blanca)                                                                                                                                                                      | E       |
| 5   | Filtros: `status` csv (válidos; los repetidos se DEDUPLICAN, no son error; uno fuera de catálogo => 400), `branchId`, `from`/`to` (sin zona => 400, `to ≤ from` => 400, rango > 366 días => 400)                                                                           | U, E, I |
| 6   | Orden `placed_at DESC, id DESC` estable con `placed_at` idénticos; `limit` 1..50 (0/51/no numérico => 400), defecto 20                                                                                                                                                     | U, I    |
| 7   | Keyset sin duplicados ni saltos al insertar pedidos nuevos entre páginas; `nextCursor` null en la última; recorrido completo = suma exacta                                                                                                                                 | I       |
| 8   | Cursor alterado, truncado, con fecha o UUID inválidos => 400 `ORDER_CURSOR_INVALID`; cursor de otra consulta o de otro cliente no filtra datos ajenos                                                                                                                      | U, E, I |
| 9   | El códec de cursor de F22 extraído mantiene su comportamiento (las pruebas de F22 siguen verdes)                                                                                                                                                                           | U       |
| 10  | Filas mínimas: ninguna línea, extra, promoción, dirección, teléfono, correo ni nota; `itemCount` = suma de cantidades; `branchName` correcto                                                                                                                               | S, I    |
| 11  | `publicStatus`/`terminal` iguales al mapeo de F21 para los 9 estados (tabla-conducida contra `toPublicStatus`)                                                                                                                                                             | U       |
| 12  | Importes como cadena de 2 decimales (`'165.00'`), nunca `number`; `currency` GTQ                                                                                                                                                                                           | U, I    |
| 13  | Rechazados y cancelados se listan con su estado y SIN motivo (`reason` de `order_status_history` ausente del cuerpo, comprobado con motivo sembrado)                                                                                                                       | I, E    |
| 14  | PEDIDOSYA histórico: se lista con `deliveryProvider: 'PEDIDOSYA'` y sin estados externos inventados                                                                                                                                                                        | S, I    |
| 15  | Cabeceras de lista, recibo y preview (200 y errores): `Cache-Control: private, no-store`, `Vary` correcto, sin `ETag`                                                                                                                                                      | E       |
| 16  | Gate: saturación => 503 `ORDERS_BUSY` con `Retry-After` en las tres rutas; lecturas con `rejectIfWaiting: 2`; libera el cupo                                                                                                                                               | S       |
| 17  | Throttle propio de lista (120/60), recibo (60/30) y preview (30/15): 429 `RATE_LIMITED` con `Retry-After`; contadores independientes de F20/F21/F22                                                                                                                        | E       |
| 18  | Recibo, dueño: 200 con los campos exactos de §4.2 y `fiscalStatus = NOT_FISCAL`, `timeZone = America/Guatemala`                                                                                                                                                            | S, E, I |
| 19  | Recibo, invitado con token vigente => 200; sin token ni JWT => 404; token vencido/revocado/malformado => 404 / 400 (formato) idéntico a `getOrder`                                                                                                                         | S, E, I |
| 20  | Recibo: pedido inexistente, ajeno y de invitado consultado con JWT => MISMO 404 (cuerpo, cabeceras y número de sentencias)                                                                                                                                                 | E, I    |
| 21  | Recibo NO contiene: `id`, `branchId`, tokens, hashes, correo, teléfono completo, coordenadas, `reason`, `changedBy`, actor ni historial (barrido de claves sobre el JSON con datos sembrados que los contienen)                                                            | S, I    |
| 22  | Recibo coincide con los snapshots: cambiar nombre/precio del producto o del extra DESPUÉS de crear el pedido no altera el recibo (sin recomputar desde el catálogo)                                                                                                        | I       |
| 23  | Recibo: invariante `total = subtotal − discountTotal + deliveryFee` y sumas de líneas coherentes con `OrderDetail` del mismo pedido (mismas cifras que `getOrder`)                                                                                                         | U, I    |
| 24  | Recibo disponible en `pending`, `accepted`, `ready`, `picked_up`, `delivered`, `rejected`, `cancelled`; `rejected`/`cancelled` sin motivo y con `payment.status = NOT_STARTED`                                                                                             | S, I    |
| 25  | Recibo de pedido PICKUP (`address: null`, `provider: null`) y DELIVERY (`address` snapshot sin coordenadas)                                                                                                                                                                | S, I    |
| 26  | Recibo con 30 líneas y extras: sin N+1 (≤ 5 sentencias)                                                                                                                                                                                                                    | I       |
| 27  | Reorder-preview, dueño y invitado con token => 200; ajeno/inexistente/token inválido => mismo 404 sin `code`; `branchId` inexistente => 404 `BRANCH_NOT_FOUND` SOLO tras autorizar                                                                                         | S, E, I |
| 28  | Preview NO escribe: sin filas nuevas en `orders`, `order_items`, `order_idempotency_keys`, `audit_events` ni secuencias consumidas (conteos antes/después); sin `Idempotency-Key` requerida                                                                                | I       |
| 29  | Preview NO copia precios, promociones, cupón, tarifa, modalidad, dirección ni pago del pedido original (la respuesta no los trae como valores reutilizables; solo `previousUnitPrice` informativo)                                                                         | S, E    |
| 30  | Línea íntegra y vigente => `AVAILABLE`; `candidate.line` valida contra `CartQuoteLineInput` (solo ids, `selections` ordenadas, `quantity` 1)                                                                                                                               | U, S    |
| 31  | Producto inexistente (o `product_id` nulo) => `UNAVAILABLE` + `PRODUCT_REMOVED`, `candidate` null, `current` null                                                                                                                                                          | U, S, I |
| 32  | Producto inactivo o categoría oculta => `PRODUCT_INACTIVE`; agotado en la sucursal => `PRODUCT_OUT_OF_STOCK` (con `current.unitPrice`)                                                                                                                                     | U, S, I |
| 33  | Opción retirada del producto => `OPTION_REMOVED` + línea `NEEDS_CONFIGURATION`, la opción NO está en `selections`, nunca se sustituye por otra                                                                                                                             | U, S, I |
| 34  | Opción o grupo inactivos => `OPTION_INACTIVE` + `NEEDS_CONFIGURATION`                                                                                                                                                                                                      | U, S, I |
| 35  | Grupo obligatorio NUEVO sin selección => `REQUIRED_SELECTION_MISSING`; opción omitida que deja un grupo bajo el mínimo => ambos códigos                                                                                                                                    | U, S, I |
| 36  | Máximo del grupo reducido (selección retenida excede) => `GROUP_RULE_CHANGED`; la línea no es agregable                                                                                                                                                                    | U, S, I |
| 37  | Cambio de precio base o de extra => `PRICE_CHANGED` con `previousUnitPrice`/`currentUnitPrice` (con extras retenidos), línea sigue `AVAILABLE`; precio igual => sin aviso                                                                                                  | U, S, I |
| 38  | Cantidad histórica > 99 => `QUANTITY_ADJUSTED` (`from`/`to`) y cantidad 99; nota > 140 o inválida => `NOTE_DROPPED`                                                                                                                                                        | U       |
| 39  | Sucursal ORIGINAL inactiva => todas `UNAVAILABLE` + `BRANCH_UNAVAILABLE`, sin `inspect` ni ofertas; sucursal DISTINTA inactiva o inexistente => 404 `BRANCH_NOT_FOUND` idéntico; sucursal cerrada por horario => `acceptingOrders=false` y líneas evaluadas con normalidad | S, I    |
| 40  | Otra sucursal (`sameBranch=false`): precios y disponibilidad de ESA sucursal; sin `branchId` => la del pedido; `branchId` mal formado => 400                                                                                                                               | S, I    |
| 41  | `summary`: contadores coherentes con las líneas, `units` y `estimatedSubtotal` en centavos enteros solo de `AVAILABLE`, `canAddAny`; pedido sin líneas agregables => `canAddAny=false`                                                                                     | U       |
| 42  | PEDIDOSYA/DELIVERY originales: `source` informativo; no se calcula tarifa ni proveedor; no se llama a ningún cliente externo                                                                                                                                               | S       |
| 43  | Presupuesto del preview ≤ 9 sentencias (típico 7) con un pedido de 30 líneas y 30 productos distintos (contador); sin consultas por línea ni por producto                                                                                                                  | S, I    |
| 44  | Preview con producto con selecciones en varios grupos y duplicados históricos: diagnóstico determinista y estable entre ejecuciones                                                                                                                                        | U       |
| 45  | Cuerpo del preview: `{}` y ausente válidos; campo desconocido, `lines`, `prices`, `customerId` o `__proto__` => 400                                                                                                                                                        | E       |
| 46  | Concurrencia: mientras se evalúa, un cambio de catálogo no produce estados mixtos (la lectura por lote es consistente por ejecución; sin escrituras)                                                                                                                       | I       |
| 47  | Sin fuga: la respuesta del preview no incluye ids de pedido/líneas ni datos del cliente (solo `displayNumber` y datos del catálogo público)                                                                                                                                | S, E    |
| 48  | Web: `listMyOrders` en `http` usa `/v1/me/orders` (nunca `/v1/demo/*`), con cursor, filtros y pestañas; las pestañas envían los `status` esperados                                                                                                                         | W       |
| 49  | Web: estados de Mis pedidos (carga, vacío cliente, vacío con nota de invitado, error con «Reintentar», 429/503 con espera, sin sesión sin llamadas, fin de lista, «Cargar más»)                                                                                            | W       |
| 50  | Web: fila con estado por texto+ícono, fecha en `America/Guatemala`, `Q` con 2 decimales, enlaces a seguimiento (en curso), detalle y recibo; el motivo interno nunca se pinta                                                                                              | W       |
| 51  | Web: el resumen «pedidos/gastado» ya no aparece en `http`; ningún total se calcula en el cliente                                                                                                                                                                           | W       |
| 52  | Web: detalle `/pedidos/[id]` añade «Ver recibo» y «Volver a pedir»; invitado con token los ve; sin sesión ni token => «se perdió el acceso» (F21)                                                                                                                          | W       |
| 53  | Web: recibo renderiza todos los campos, leyenda fija es/en, «Sin pago registrado» + método elegido (nunca «pagado»), estados `rejected`/`cancelled` con banner sin motivo ni pago                                                                                          | W       |
| 54  | Web: recibo sin tokens, ids, correo ni teléfono completo en el DOM; `document.title` correcto; sin escrituras en `localStorage`/`sessionStorage` ni descargas                                                                                                              | W       |
| 55  | Web: hoja `@media print` (se ocultan navegación, carrito y botones; leyenda visible); `window.print()` solo desde el botón                                                                                                                                                 | W, P    |
| 56  | Web: clave del recibo `['orders','receipt',scope\|'guest',id]`; `isOtherIdentity` la descarta al cambiar de identidad                                                                                                                                                      | W       |
| 57  | Web: al cerrar sesión se descartan historial, recibos y previews de la cuenta anterior; la nueva cuenta no ve datos de la anterior; el carrito anónimo se conserva                                                                                                         | W, P    |
| 58  | Web: «Volver a pedir» con carrito VACÍO añade las `AVAILABLE` (todas o ninguna) y abre el cajón; no llama a `createOrder` ni a la cotización                                                                                                                               | W       |
| 59  | Web: carrito con líneas de la MISMA sucursal => «Añadir» suma (unificación F18); «Reemplazar» exige confirmación explícita con el conteo; nunca sobrescribe en silencio                                                                                                    | W       |
| 60  | Web: carrito de OTRA sucursal => solo «Reemplazar con confirmación» o cancelar; jamás mezcla sucursales ni usa `planBranchSwitch` automáticamente                                                                                                                          | W       |
| 61  | Web: líneas `NEEDS_CONFIGURATION` no se añaden solas; «Configurar» abre la ficha del producto; `UNAVAILABLE` se listan sin acción; `PRICE_CHANGED` muestra «antes → ahora»                                                                                                 | W       |
| 62  | Web: pedido en curso pide confirmar «¿Pedir otro igual?»; tope excedido (30 líneas/99/200 unidades) se rechaza con el mensaje de F18, sin recortar                                                                                                                         | W       |
| 63  | Web: sucursal inactiva ofrece elegir otra y repite el preview; `acceptingOrders=false` avisa pero permite añadir                                                                                                                                                           | W       |
| 64  | Paridad mock/API: `parity.test.ts` valida las formas `MyOrderPage`, `OrderReceipt` y `OrderReorderPreview` del mock contra el contrato y ejecuta la MISMA tabla de casos de diagnóstico que la API                                                                         | W       |
| 65  | Sin sondeo: el listado no hace polling; se refresca al montar, al volver el foco y tras crear un pedido                                                                                                                                                                    | W       |
| 66  | Rendimiento: listado ≤ 2 sentencias con 50 pedidos de 30 líneas (sin N+1); recibo ≤ 5; preview ≤ 9 (típico 7)                                                                                                                                                              | I       |
| 67  | `EXPLAIN` del listado con volumen sembrado (decenas de miles de pedidos, un cliente con cientos): usa `orders_customer_placed_idx`, sin ordenación completa; documenta si hace falta el índice opcional de §2.1                                                            | I       |
| 68  | Autorización por ruta: ninguna ruta de F23 acepta JWT de personal para ver pedidos ajenos; ninguna cabecera/parámetro permite elegir al cliente                                                                                                                            | E       |
| 69  | Logs: ninguna línea de log, auditoría ni error contiene nombre, teléfono, dirección, token ni el cuerpo del preview                                                                                                                                                        | S, E    |
| 70  | E2E real (Playwright contra API real con datos sembrados): lista paginada, detalle, recibo e impresión, «Volver a pedir» con un producto cambiado de precio y una opción retirada, llegando al checkout F19                                                                | P       |
| 71  | `pnpm contracts:check` verde con la API implementada; `operationId` únicos; los tres esquemas validan los ejemplos del contrato                                                                                                                                            | U       |
| 72  | Detalle propio (`getOrder` reutilizado, sin cambios): el dueño con JWT obtiene líneas, extras, promociones, dirección y totales; pedido ajeno o inexistente => mismo 404 (cubre U#7, U#8, U#9)                                                                             | S, E, I |
| 73  | Invitado: `getOrder`, `getOrderTracking`, recibo y preview con token vigente => 200; sin token => 404; token EXPIRADO (14 días, reloj simulado), revocado o de otro pedido => mismo 404 sin `code` (cubre U#10, U#11, U#12)                                                | S, E, I |
| 74  | Snapshots históricos en el detalle: tras cambiar nombre, precio, extra, promoción o dirección guardada en el catálogo/cuenta, `getOrder` devuelve precios, modificadores, descuentos y dirección ORIGINALES del pedido (cubre U#13–U#17)                                   | I       |
| 75  | Estado real: `status` y `publicStatus` del listado/detalle coinciden con `orders.status` tras transiciones de F22 sembradas; enlace «Seguimiento» a `/pedidos/[id]/seguimiento` en pedidos en curso (cubre U#18, U#19)                                                     | I, W, P |
| 76  | Líneas históricas idénticas (mismo producto, extras y nota) no se fusionan en el preview (una por `lineNo`); el carrito F18 las unifica sin pasar de 99 por configuración ni de 200 unidades (cubre U#32)                                                                  | U, W    |
| 77  | Disponibilidad parcial: pedido con líneas mezcladas (`AVAILABLE`, `NEEDS_CONFIGURATION`, `UNAVAILABLE`): contadores del `summary` correctos y se añaden solo las `AVAILABLE`, informando el resto (cubre U#29)                                                             | U, W    |
| 78  | No hay PDF: ninguna ruta `/pdf`, `Content-Disposition` ni dependencia PDF en API ni web; el recibo solo se imprime/guarda como PDF desde el navegador (decisión P81; cubre U#42)                                                                                           | U, W    |
| 79  | Responsive: Mis pedidos, detalle, recibo y diálogo de reorden sin desbordamiento a 390 px; objetivos ≥ 44 px (cubre U#49)                                                                                                                                                  | P       |
| 80  | Tema claro/oscuro en lista, recibo y diálogo; el recibo impreso fuerza fondo blanco (cubre U#50)                                                                                                                                                                           | W, P    |
| 81  | es/en: todas las cadenas de `orders.history.*`, `receipt.*` y `reorder.*` existen en ambos idiomas, incluida la leyenda no fiscal y los 11 códigos de diagnóstico (cubre U#51)                                                                                             | W       |
| 82  | Accesibilidad: roles y foco del diálogo, estados por texto+ícono, `aria-live`, pestañas navegables por teclado, axe sin violaciones en lista, recibo y diálogo (cubre U#52)                                                                                                | W, P    |

Cobertura mínima de la int-spec contra PostgreSQL real (datos `zz-` sembrados y borrados): #2, #3, #7, #8, #13, #22, #24, #28, #31–#40, #43, #46, #66, #67.

### Trazabilidad usuario→matriz

| Usuario | Cubierto por      | Usuario | Cubierto por        | Usuario | Cubierto por                     |
| ------- | ----------------- | ------- | ------------------- | ------- | -------------------------------- |
| 1       | #1, #2            | 20      | #30                 | 39      | #18, #24 (`NOT_FISCAL`)          |
| 2       | #2, #49           | 21      | #32                 | 40      | #20, #27                         |
| 3       | #7                | 22      | #31                 | 41      | #55                              |
| 4       | #6                | 23      | #32                 | 42      | #78 (NO; P81)                    |
| 5       | #5                | 24      | #33                 | 43      | #21, #47, #54, #69               |
| 6       | #5                | 25      | #34                 | 44      | #15, #56                         |
| 7       | #72               | 26      | #35                 | 45      | #57                              |
| 8       | #72, #2           | 27      | #37                 | 46      | #48, #70                         |
| 9       | #4, #20, #68, #72 | 28      | #40                 | 47      | #49                              |
| 10      | #73               | 29      | #41, #77            | 48      | #16, #17, #49                    |
| 11      | #73               | 30      | #59, #60            | 49      | #79                              |
| 12      | #73               | 31      | #38, #62            | 50      | #80                              |
| 13      | #22, #74          | 32      | #76                 | 51      | #81                              |
| 14      | #22, #74          | 33      | #33, #36            | 52      | #82                              |
| 15      | #22, #74          | 34      | #28, #58            | 53      | `pnpm check` (lint)              |
| 16      | #22, #74          | 35      | #18, #24            | 54      | `pnpm check` (typecheck)         |
| 17      | #25, #74          | 36      | #22, #23            | 55      | `pnpm check` (test) + #1–#47 U/S |
| 18      | #75               | 37      | #24 (`NOT_STARTED`) | 56      | int-spec (cobertura mínima)      |
| 19      | #75               | 38      | #24, #53            | 57      | `pnpm check` (build)             |

## 12. Riesgos aceptados y pendientes

1. Los datos de presentación del preview (nombres vigentes e imagen) pueden diferir un instante del menú que ve el cliente; el carrito vuelve a validarse en F19 al cotizar (el preview no es verdad de precio).
2. Una opción cuyo grupo cambió de producto se informa como `OPTION_REMOVED` (el snapshot solo guarda `modifier_id`); no se intenta reubicarla en otro grupo. El cliente reconfigura.
3. El throttle es por instancia (riesgo conocido de F21 M4); el preview es la ruta más cara (~7 sentencias) y tiene el límite más bajo (30/min IP, 15/min actor).
4. Los pedidos de invitado no aparecen en Mis pedidos aunque el cliente luego inicie sesión (P77): puede sorprender; la web lo explica. Sin vinculación hasta que negocio defina un reclamo verificado.
5. Sin conteo total ni «gastado»: la cuenta pierde ese resumen en modo real (P75).
6. El recibo no es fiscal; si se imprime sin leer la leyenda podría confundirse con factura. Mitigación: la leyenda se imprime siempre y el `fiscalStatus` viaja en el dato.
7. `getOrder` devuelve el teléfono enmascarado: la web no puede mostrar el teléfono completo en el recibo (decisión de privacidad de F20, no se cambia).
8. Verificación pendiente de la implementación: exposición de `ModifiersRepository.findOffersMany` y de los lectores de presentación de productos como servicios de solo lectura de sus módulos (sin cambiar su comportamiento) y confirmar que `imageUrl` se resuelve con el mismo helper de medios de F11/F14.
9. **Conexiones del pool**: una plaza del gate usa como mucho 3 conexiones simultáneas (preview), así que el cupo de pedidos exige `DB_POOL_MAX >= 9` en producción (ver `splitGateBudget`; con el defecto el cupo de pedidos es 1). Presupuesto real del preview: típico 7 sentencias, sucursal distinta 8, peor caso 9 (token que falla + dueño + sucursal distinta).
10. **Sondeo de sucursales**: pedir otra sucursal inactiva responde 404 `BRANCH_NOT_FOUND` igual que una inexistente. Un dueño autenticado sí puede distinguir «existe y está activa» de «no existe o inactiva», dato público de todos modos.
11. **`PRODUCT_REMOVED` vs `PRODUCT_INACTIVE`** revela al titular de un pedido propio si un producto de ese pedido fue borrado o solo ocultado (info de catálogo, no de terceros). Aceptado.
12. **`ProductsRepository.findSlugsAndNamesByIds`** filtra `active: true` pero NO la visibilidad de la categoría: solo debe recibir ids que `BranchOffersService.inspect` ya dio por ordenables (contrato documentado y probado). No usarlo para exponer productos al público.
13. **Cuerpo del preview**: tope propio de 2 KB (413) antes de guards y BD, además del límite global del parser JSON (100 KB, 413).
14. **`status` repetido** en `listMyOrders` se deduplica (no es error).

## 13. Reparto de trabajo (agentes) y orden

1. **api-engineer**: `MyOrdersController`/servicio de historial, `getOrderReceipt` y `previewOrderReorder` en `src/orders/` (subcarpetas `history/`, `receipt/`, `reorder/`), mapper de recibo, función pura de diagnóstico, extracción del códec de cursor, tres throttles, DTOs y `@ApiResponse` alineados al contrato. Sin migración. Orden: contrato (hecho) → mapper/diagnóstico puros con pruebas → repositorio → servicio → controlador → `contracts:check`.
2. **database-engineer**: confirmar que NO hace falta migración (`EXPLAIN`, #67), validar el SQL del listado y del origen del preview, y decidir sobre el índice opcional de §2.1.
3. **web-engineer**: servicios (`services/orders.ts`: `listMyOrders`, `getOrderReceipt`, `previewOrderReorder`), `paths`, hooks, reescritura de `OrdersPage`/`ReorderDialog`, ruta `/pedidos/[id]/recibo`, CSS de impresión, claves de caché e `isOtherIdentity`, handlers del mock y paridad, textos es/en; consumidores de `/v1/me/orders` a migrar: `home/orders-section.tsx`, `AccountHub`, `account/hooks.ts`, `orders/last-order.ts`, `tracking/hooks.ts`, `tracking/lookup-form.tsx`, `mocks/handlers/account.ts`.
4. **security-reviewer** (solo lectura) tras la API: 404 uniforme, propiedad por join, invitado y JWT, PII del recibo, cabeceras, throttles, cursor. **performance-reviewer**: presupuesto, gate, plan del listado. **qa-engineer**: matriz §11. **ui-ux-reviewer**: lista, recibo imprimible, diálogo de reorden y accesibilidad.

## 14. Estado (implementado · simulado · pendiente de proveedor · bloqueado)

| Pieza                                                               | Estado                                                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Contrato (`listMyOrders`, `getOrderReceipt`, `previewOrderReorder`) | `API_IMPLEMENTED` (contrato y `pnpm contracts:check` en verde)                               |
| API, int-spec y presupuesto de sentencias                           | Implementada; `test/order-history.int-spec.ts` 9/9 contra PostgreSQL real (ver §15)          |
| Migración                                                           | No hay (0019 no se crea); índice opcional descrito en §2.1, NO adoptado                      |
| Web (Mis pedidos, recibo, «Volver a pedir»)                         | Integrada (mock/http); verificada con Playwright en modo mock, no contra la API real         |
| Pago en el recibo                                                   | «Sin pago registrado» (F24); nunca «pagado»                                                  |
| Factura fiscal, PDF, CSV                                            | No implementado por decisión (P78, P81)                                                      |
| PedidosYa                                                           | `BLOCKED_EXTERNAL`: histórico mostrado tal cual; reordenar DELIVERY no usa proveedor externo |
| Vinculación de pedidos de invitado a la cuenta                      | No implementado (P77)                                                                        |

## 15. Verificación real (F23)

- **int-spec contra PostgreSQL real** (`test/order-history.int-spec.ts`, BD de pruebas, 20 000 pedidos de ruido): 9/9 verdes. Cubre SQL del
  listado, filtros, orden con `placed_at` idénticos, keyset, `OrderSourceRepository`, recibo, vista previa de «Volver a pedir»,
  token de invitado vencido/revocado/ajeno (mismo 404 y mismo número de sentencias), presupuesto de sentencias y `EXPLAIN` del
  índice parcial `orders_customer_placed_idx`. Todo lo sembrado se borró; conteos finales = línea base (pedidos 0, sucursales 1,
  personal 1, asignaciones 1, `auth.users` 3, clientes 3, `audit_events` 159).
- **Hallazgo real corregido**: `from`/`to` se pasan ahora como ISO con `::timestamptz` (igual que el cursor). Los instantes de
  entrada se truncan al segundo (`parseInstant`): la ventana de la prueba usa segundos enteros.
- **API HTTP real** (API compilada en un puerto propio contra la BD de pruebas; JWT HS256 de prueba firmados con un secreto temporal en
  memoria; datos `zzv23` sembrados: 2 clientes, 2 sucursales, catálogo con extras, 7 pedidos de clientes y 1 de invitado con token): lista
  (orden, `publicStatus`, `itemCount`, keyset 2+2 sin duplicados, filtros de estado/sucursal/fechas, 401 sin JWT, 400 por cursor
  basura y `limit=0`, cliente B solo ve lo suyo, jamás pedidos ajenos ni de invitado), recibo (dueño 200; ajeno, inexistente, de invitado
  con JWT, token de otro pedido, sin credenciales => 404; JWT inválido 401; invitado con token 200; sin motivo, sin id interno ni
  correo; teléfono enmascarado; `NOT_FISCAL`), vista previa (AVAILABLE con `PRICE_CHANGED`; `PRODUCT_INACTIVE` y `PRODUCT_OUT_OF_STOCK`;
  `OPTION_INACTIVE` + `REQUIRED_SELECTION_MISSING`; otra sucursal; sucursal inexistente 404; campo extra 400; cuerpo > 2 KB 413;
  invitado con token 200; el número de pedidos del cliente no cambió) y compatibilidad con el seguimiento de F21. Todas las
  respuestas con `Cache-Control: private, no-store` y `Vary: Authorization`.
- **Navegador contra la API real** (web en modo `http` con sesión de demostración y cabecera `Authorization` inyectada): pestañas «En
  curso»/«Historial», sin fugas de motivo, correo ni teléfono en el DOM, detalle, recibo (también en `@media print`) y recibo de
  invitado con token en `sessionStorage`; pedido ajeno sin token => «No pudimos mostrar este recibo»; «Volver a pedir» para
  pedido en curso («¿Pedir otro igual?»), entregado (con cambio de precio), rechazado (sin productos añadibles, botón deshabilitado),
  cancelado («Configurar»), carrito con contenido (Añadir/Reemplazar), otra sucursal (solo Reemplazar con confirmación). axe sin
  violaciones (recibo de invitado, lista, diálogo y recibo en móvil con tema oscuro) y sin desbordamiento horizontal a 390 px.
- **Sembrado y borrado**: todo lo sembrado (incluidos clientes, `auth.users` de prueba, catálogo y pedidos) se eliminó; conteos finales
  = línea base y sin filas `zzv23`.
- **No ejecutado**: login real (Google/Supabase + TOTP; se usó la sesión de demostración y tokens firmados de prueba); la sucursal sembrada
  no tiene horario, por lo que «no recibe pedidos ahora» se vio solo como aviso; «Configurar» abre la hoja del producto sin precargar
  las opciones (limitación conocida).
