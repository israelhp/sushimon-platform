# F19 — Cotización de checkout y reglas monetarias

**Rama**: `feature/F19-checkout-quote` (desde `develop` 88555bb) · **Dueño**: A · **Prioridad**: P0 · **Tipo**: API + WEB
**Dependencias**: F08 (horarios), F09 (cobertura), F12 (extras), F13 (precio por sucursal), F15 (promociones), F18 (carrito); F05 (direcciones) para dirección guardada; F01 (JWT opcional) · **Decisiones**: `docs/adr/0025-cotizacion-checkout.md` · **Pendientes**: P39–P47 en `docs/business-rules/decisiones-pendientes.md`
**Estado global**: `CONTRACT_DEFINED` (operación `quoteCheckout` y esquemas `Checkout*` en `openapi.yaml`; API y web sin implementar). `contracts:check` falla hasta que la API implemente la operación (esperado). Sin migración. PedidosYa real: `BLOCKED_EXTERNAL` (F29).

> **Nota ADR-0036 (2026-11-26, pedidos solo a domicilio e inmediatos)**: reemplaza parcialmente lo que esta spec dice sobre PICKUP y pedidos programados en cotización: `fulfillment.type` es solo `DELIVERY` (PICKUP => 400) y no hay pedidos programados ni recogida; `deliveryFee` ya no es `0.00` por PICKUP; sin cobertura (`DELIVERY_UNAVAILABLE`) o con sucursal cerrada (`BRANCH_CLOSED`) la web solo informa. El texto original se conserva como historial; ver `docs/adr/0036-pedidos-solo-a-domicilio-e-inmediatos.md`.

## Alcance y fuera de alcance

Dentro: `POST /v1/checkout/quote` (cálculo de servidor sin efectos), cotizador reutilizable por F20, acceso opcional por JWT, tarifa propia (OWN) y estado PedidosYa `UNKNOWN`, firma sin estado de vigencia, flujo de checkout web que consume la cotización (modo http) con paridad mock rotulada como simulación.
Fuera: crear pedidos, pagos, entregas, repartidores (F20/F24/F25/F28/F29); reserva de inventario; pedidos programados (sin contrato aprobado, P42); cargos extra (servicio, propina, mínimo, impuestos desglosados: P44/P45); reasignar sucursal por cobertura (P41); tarifa PedidosYa al cliente (P40); endpoint de validación de cupón suelto (F15 lo prohíbe); `GET /v1/store/checkout-context` (descartado, ADR-0025 D1); tabla de cotizaciones; caché del backend.

## Estado de implementación (al cerrar el diseño)

| Pieza                                                   | Estado                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| Contrato `quoteCheckout` + esquemas `Checkout*`         | `CONTRACT_DEFINED`                                         |
| `CheckoutModule` API (cotizador, guard opcional, firma) | pendiente (api-engineer)                                   |
| Web checkout real sobre la cotización                   | pendiente (web-engineer); hoy checkout `MOCK_ONLY`         |
| Migración                                               | no se necesita                                             |
| PedidosYa (cobertura/tarifa real)                       | `BLOCKED_EXTERNAL`: siempre `UNKNOWN`, nunca seleccionable |

## 1. Servicios existentes que se reutilizan (no se duplica ninguna regla)

| Necesidad                                 | Reutiliza                                                                                                                                                        | Hueco que F19 cubre                                                                                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Precio efectivo, agotado, producto activo | `BranchOffersService` (`resolveMany` vía repo; `assertOrderable` lanza agregado)                                                                                 | Falta una variante que NO lance: `inspect(branchId, ids) -> Map<id, {state: OK/UNKNOWN/HIDDEN/SOLD_OUT, price}>` con la misma consulta y `getVisibleIds` de categorías |
| Extras: validación y precio               | `ModifierSelectionService.validate` (1 consulta POR producto)                                                                                                    | Variante por lote `validateMany` (una consulta `ANY(uuid[])`, mismas `validateSelections`) y adaptador `{groupId, optionId}` -> `{groupId, modifierIds[]}`             |
| Descuentos                                | `PromotionCandidatesService.load` + `PromotionEvaluator.evaluate` (centavos, una promoción por línea, cupón colapsado)                                           | Ninguno. Los extras no se descuentan (F15 D15.6)                                                                                                                       |
| Aritmética                                | `promotion-money.ts` (`decimalToCents`, `centsToDecimal`, `percentOf`)                                                                                           | Moverlo a `src/common/money/` con reexportación desde F15 (sin cambiar F15)                                                                                            |
| Horario                                   | `BranchAvailabilityPort.canAcceptOrderNow` (America/Guatemala, reloj del servidor)                                                                               | Ninguno                                                                                                                                                                |
| Cobertura y tarifa OWN, estado PedidosYa  | `DeliveryCoverageService.check` (puerto `DELIVERY_COVERAGE_PORT`): valida sucursal activa, municipio, flag OWN, zona específica > general, PedidosYa con timeout | Ninguno; no se usa proximidad (F09 no la modela) ni zonas OWN para PedidosYa                                                                                           |
| Dirección guardada                        | `CustomerAddressesService.get(principal, id)` (filtra por `customerId`, 404 igual para ajena/inexistente)                                                        | Ninguno                                                                                                                                                                |
| Concurrencia / 503                        | `StoreDbGate` (generalizar la fábrica de error; hoy fija `STORE_BUSY`)                                                                                           | `CHECKOUT_BUSY` en `PUBLIC_5XX_CODES`                                                                                                                                  |
| Auth                                      | `JwtAuthGuard` global (deniega por defecto)                                                                                                                      | Metadato `@OptionalAuth()` leído por ESE guard (ADR-0025 D2)                                                                                                           |

## 2. Contrato (resumen; fuente: `openapi.yaml`)

`POST /v1/checkout/quote` · `quoteCheckout` · tag `checkout` · `security: [{}, {bearer: []}]` · `200` siempre que la entrada sea válida (un `canProceed=false` NO es error HTTP) · `Cache-Control: private, no-store`.
Entrada `CheckoutQuoteRequest { cart: CartQuoteInput, fulfillment, couponCode?, clientView? }` (`additionalProperties:false`: `price|fee|total|discount` => 400). `fulfillment`: `PICKUP` solo; `DELIVERY` con exactamente `customerAddressId` o `municipalityId` (+`zone?`), y `deliveryProvider?` como preferencia.
Salida `CheckoutQuote { quote{generatedAt,expiresAt,token}, currency:'GTQ', branch{isAcceptingOrders,reason,nextOpensAt}, fulfillment{type,delivery{selectedProvider,options[]}}, lines[], subtotal, extrasTotal, discountTotal, deliveryFee, total, coupon, canProceed, blockers[], notices[] }`.

Fórmulas (centavos enteros): `lineSubtotal = (unitPrice + extrasPerUnit) × quantity`; `discount` = descuento del evaluador sobre `unitPrice × quantity`; `lineTotal = lineSubtotal − discount`; `subtotal = Σ lineSubtotal`; `extrasTotal = Σ extrasPerUnit × quantity`; `discountTotal = Σ discount`; `total = subtotal − discountTotal + deliveryFee`. Invariante probada: `total` = suma exacta de las líneas visibles. Líneas no comprables quedan con importes `null` y no suman.

`total = null` si: alguna línea no comprable; `DELIVERY` sin tarifa verificable (sin proveedor seleccionable) o `ADDRESS_INCOMPLETE`. `BRANCH_CLOSED` NO anula el total (se puede mostrar), pero bloquea.

### Línea: estados y precedencia (alineados con F18 `LineStatus`)

`NOT_FOUND` (id inexistente) > `INACTIVE` (producto inactivo o categoría oculta) > `UNAVAILABLE` (agotado en la sucursal) > `OPTION_UNAVAILABLE` (violación `MODIFIER_INACTIVE`/`MODIFIER_NOT_IN_GROUP`) > `MODIFIER_INVALID` (resto de violaciones: `MODIFIER_REQUIRED`, `MODIFIER_TOO_MANY`, `MODIFIER_GROUP_NOT_ON_PRODUCT`, duplicados, más de 10 grupos) > `PRICE_CHANGED` (aviso, comprable) > `OK`. `PRICE_CHANGED` solo si el cliente envió `clientView.lines[i].unitPrice` y difiere del precio efectivo vigente; el servidor cobra siempre el suyo. `BRANCH_MISMATCH` es solo del cliente.

### Entrega

| Caso                                       | OWN                                                           | PEDIDOSYA                                                                                | Resultado                                             |
| ------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `PICKUP`                                   | no se evalúa                                                  | no se evalúa                                                                             | `deliveryFee="0.00"`, `delivery=null`                 |
| Flag OWN apagado (defecto)                 | `enabled=false`, `UNAVAILABLE`, `PROVIDER_DISABLED`           | `UNKNOWN`                                                                                | `DELIVERY_UNVERIFIED`                                 |
| OWN con zona activa                        | `AVAILABLE`, `customerFee = baseFee` de la zona, `selectable` | `UNKNOWN`, `selectable=false`                                                            | `selectedProvider=OWN`, `deliveryFee=baseFee`         |
| OWN sin zona                               | `UNAVAILABLE`, `NO_ZONE_COVERAGE`                             | `UNKNOWN`                                                                                | `DELIVERY_UNVERIFIED` (hay un proveedor `UNKNOWN`)    |
| PedidosYa mock `AVAILABLE` (solo dev/test) | —                                                             | `AVAILABLE`, `simulated=true`, `selectable=false` (`SIMULATED`/`CUSTOMER_FEE_UNDEFINED`) | nunca selecciona ni da tarifa                         |
| `deliveryProvider=PEDIDOSYA` pedido        | —                                                             | no seleccionable                                                                         | `DELIVERY_PROVIDER_NOT_SELECTABLE`, sin cambiar a OWN |
| `pedidosyaEnabled=false` y OWN sin zona    | `UNAVAILABLE`                                                 | `enabled=false`                                                                          | `DELIVERY_UNAVAILABLE`                                |

`DELIVERY_UNAVAILABLE` = todos los habilitados dijeron `UNAVAILABLE`; `DELIVERY_UNVERIFIED` = ninguno seleccionable y al menos uno `UNKNOWN`. El costo del proveedor no existe en ningún campo. El mock nunca se instancia en producción (F09: `validateEnv` + `selectCourierAdapter`); F19 no añade configuración nueva para él y trata `integrationStatus != LIVE` como no verificable.

### Vigencia

`quote.expiresAt = generatedAt + 600 s`. `quote.token` = `v1.<payload b64url>.<HMAC-SHA256 b64url>` con secreto `CHECKOUT_QUOTE_SECRET` (opcional, >= 32 caracteres; sin él `token=null`). Payload: `v, iat, exp, branchId, type, provider, subtotal, discountTotal, deliveryFee, total (cadenas), inputHash (SHA-256 de la entrada canónica: líneas ordenadas, selecciones, cupón normalizado, municipio+zona o id de dirección), sub (HMAC del authUserId o "guest")`. Solo se emite con `canProceed=true`. Sin PII (el cupón y la dirección van solo como hash). Rotar el secreto invalida cotizaciones abiertas (<= 10 min): aceptable. F20: verifica firma, vigencia y `sub`; recalcula con el MISMO cotizador; si el resultado difiere responde conflicto (`QUOTE_CHANGED`) y NO crea el pedido.

## 3. Decisiones de diseño (ver ADR-0025)

D1 ruta `POST /v1/checkout/quote` (sin `checkout-context`) · D2 JWT opcional en el guard global · D3 respuesta única con blockers/notices · D4 PedidosYa solo `UNKNOWN` · D5 firma HMAC sin tabla · D6 aritmética compartida · D7 lectura por lote con semáforo · D8 flujo web.

## 4. Seguridad, rendimiento y límites

- Sin importes en la entrada; DTO lista blanca (`forbidNonWhitelisted`); `clientView` jamás entra en el cálculo.
- Topes: 30 líneas, 99 por línea, 200 unidades, 30 selecciones por línea y 300 en total, cuerpo 64 KB => 400 `QUOTE_LIMITS_EXCEEDED` (valores alineados con F18/P31; P43).
- Límites de tasa: 60/min por IP en la ruta (`default`) y 60/min por actor autenticado; con `couponCode`: contador propio `coupon` (10/min por IP y 20/min por actor), aplicado solo si el cuerpo trae cupón (`skipIf`). Respuesta 429 `RATE_LIMITED`. El cupón nunca se registra en logs; el resultado de cupón es `APPLIED|NOT_APPLIED` sin motivo y con el mismo tiempo de respuesta aproximado (sin consultas condicionales que filtren existencia: `PromotionCandidatesService.load` ya hace una sola consulta).
- Cupón `UNKNOWN` interno (inactivo, vencido, de otra sucursal, sin ahorro) se loguea sin código ni PII (solo contador).
- Presupuesto de consultas (en 2 oleadas paralelas, dentro de `CHECKOUT_DB_GATE`): disponibilidad de sucursal (1), productos+oferta (1) + categorías visibles (1, ya existente), extras por lote (1), candidatas de promoción (<= 3), cobertura (<= 2, solo DELIVERY), dirección guardada (<= 2, solo con `customerAddressId`). Máx ~10, sin N+1 por línea ni por producto.
- Semáforo `CHECKOUT_DB_GATE`: cupo `DB_POOL_MAX − 1`, cola 8, espera 1,5 s; saturado => 503 `CHECKOUT_BUSY` (añadir a `PUBLIC_5XX_CODES`, con justificación aquí). Por instancia (serverless).
- `Cache-Control: private, no-store` también en errores (filtro global). Sin escritura => sin auditoría. Logs solo con `requestId`, conteos y códigos.
- `PromotionCandidatesService.truncated` => aviso `PROMOTIONS_TRUNCATED` (no «cupón inválido»).
- IDOR: `customerAddressId` se resuelve SIEMPRE con el `customerId` del JWT; sin sesión 401; ajena = inexistente = 404.

## 5. Web

Flujo (pasos existentes del `CheckoutFlow`, sin rediseño): resumen del carrito F18 (`useCartView`) -> contacto -> modalidad/sucursal (`order-mode`) -> dirección (F05 guardada `useAddresses` o nueva con municipio/zona) -> cupón -> cotización visible en el resumen -> «Continuar» (hacia F20; en F19 el paso final sigue siendo la confirmación SIMULADA rotulada, que nunca crea pedidos reales ni invoca `clearAfterOrder`).

- Servicio `services/checkout.ts` (`quoteCheckout(client, body, signal)`) y path `paths.checkoutQuote()` (`POST /v1/checkout/quote`); tipos desde `components['schemas']['CheckoutQuote*']`. `toQuoteInput(cart, expectedBranchId)` va en `cart`; `clientView` se arma con `display.unitCents` (centavos -> cadena) y el total mostrado.
- Hook `useCheckoutQuote(input)`: `useQuery` con clave `queryKeys.checkout.quote(hash)` donde `hash` es la huella canónica (sucursal, líneas, selecciones, modalidad, dirección|municipio+zona, proveedor, cupón normalizado); NO incluye `clientView`. `queryFn` recibe el `signal` de TanStack (cancela la petición obsoleta), `placeholderData: keepPreviousData` solo para no parpadear (se rotula «actualizando»; «Continuar» deshabilitado mientras `isFetching` o los datos no correspondan a la clave actual), `staleTime` 0 y `gcTime` corto (60 s), `retry: false` en 4xx y 1 reintento en 503/red, `refetchOnWindowFocus: true` y refetch al expirar (`expiresAt`). Debounce de 400 ms solo sobre el campo de cupón y de zona escrita; selects/cantidades no usan debounce.
- Invalidación: cualquier entrada nueva cambia la clave (no se reutiliza respuesta de otra clave); al cambiar de cuenta la clave incluye `useCustomerScope()` para aislar la caché entre usuarios (la respuesta es privada). Respuestas fuera de orden se descartan por clave + `signal`.
- Estados: cargando (esqueleto `aria-busy`), error genérico con «Reintentar» (bloquea «Continuar»), `CHECKOUT_BUSY` (reintento automático acotado), expirada (aviso y recotización), bloqueos por modalidad independientes (tarjeta de proveedor con `selectable`/`unavailableReason`; un bloqueo de DELIVERY no oculta que PICKUP siga disponible: el usuario cambia de modalidad y se recotiza), `PRICE_CHANGED` con diferencia visible y «Entendido» (actualiza `display` y limpia), `BRANCH_CLOSED` con `nextOpensAt`.
- Botón «Continuar» solo con `canProceed=true`, datos coincidentes con la clave actual, sin `isFetching` y `quote.expiresAt` futuro. Con `http` NUNCA se muestra un total calculado en cliente como definitivo; el estimado de F18 solo se ve mientras llega la cotización y rotulado «estimado».
- Pedidos programados: el modo `scheduled` de `order-mode` queda deshabilitado en `http` (aviso «pronto») y sigue simulado en `mock`; la cotización siempre es «ahora».
- i18n es/en: claves `checkout.quote.*` (blockers, notices, estados de proveedor, expiración). Tema claro/oscuro con tokens existentes. a11y: `aria-live="polite"` para cambios de total/bloqueos, foco al primer bloqueo, botones >= 44 px, cupón con `aria-describedby` (mensaje único «cupón no válido»).
- Mock (paridad UI First): handler `POST /v1/checkout/quote` que reutiliza `cart-rules`/fixtures y devuelve la misma forma con `quote.token=null`, `quote.expiresAt` ficticio y un rótulo visible «Simulación» en el resumen (flag `simulated` solo de UI derivado de la fuente de datos, no del contrato). El mock nunca confirma pedidos reales. El modo `http` usa solo la API.

## 6. Pruebas (U = unitaria, S = servicio con dobles, E = e2e supertest, I = int-spec BD real, W = Vitest web, P = Playwright)

| #   | Caso                                                                                                                                                                             | Nivel |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | Carrito válido: totales exactos; vacío/exceso de líneas, unidades o selecciones => 400                                                                                           | U, E  |
| 2   | Producto inexistente/inactivo/agotado/categoría oculta => `NOT_FOUND`/`INACTIVE`/`UNAVAILABLE`, total `null`                                                                     | S, E  |
| 3   | Extras: válidos, obligatorios, máximo, opción inactiva (`OPTION_UNAVAILABLE`), grupo ajeno; `quantity` > 1 => 400                                                                | U, S  |
| 4   | Precio por sucursal (override vs base) y agotado por sucursal                                                                                                                    | S, I  |
| 5   | Sucursal inexistente/inactiva => 422 `BRANCH_NOT_AVAILABLE`; cerrada => blocker `BRANCH_CLOSED` con total                                                                        | S, E  |
| 6   | PICKUP sin tarifa, sin llamar a cobertura                                                                                                                                        | S     |
| 7   | Dirección guardada propia; ajena e inexistente => mismo 404; sin sesión => 401; token inválido => 401; invitado con municipio                                                    | E     |
| 8   | Dirección incompleta (Guatemala sin zona) => `ADDRESS_INCOMPLETE`; municipio inexistente => 422                                                                                  | S, E  |
| 9   | OWN: flag apagado, encendido sin zona, zona específica vs general, zona inactiva, tarifa exacta                                                                                  | S, I  |
| 10  | PedidosYa: `UNKNOWN` por defecto; escenarios mock (available/unavailable/timeout/error) jamás seleccionables; mock rechazado con `NODE_ENV=production` (reutiliza prueba de F09) | S, E  |
| 11  | Separación tarifa/costo: ninguna propiedad de costo en la respuesta (`JSON.stringify` sin `cost`)                                                                                | E     |
| 12  | Descuentos PERCENT (redondeo medio hacia arriba), FIXED, tope en la base, extras sin descuento                                                                                   | U     |
| 13  | Happy hour vigente/vencido/fuera de horario con reloj inyectado                                                                                                                  | S     |
| 14  | Cupón válido, inválido, vencido, de otra sucursal => misma respuesta `NOT_APPLIED`; sin motivo en el cuerpo ni en logs                                                           | E     |
| 15  | Promociones incompatibles: una por línea, mayor ahorro, no apila                                                                                                                 | U     |
| 16  | Precisión monetaria: sumas con centavos, 99 × 9999.99, propiedad `total = Σ líneas − desc + envío` aleatoria (fast-check si ya existe; si no, tabla)                             | U     |
| 17  | Manipulación: `price`, `fee`, `deliveryFee`, `total`, `discount` en cualquier nivel => 400; `clientView` alterado no cambia importes, solo avisos                                | E     |
| 18  | `Cache-Control: private, no-store` en 200 y en errores; sin ETag                                                                                                                 | E     |
| 19  | Rate limit 429 (IP, actor, cupón) y orden de guards (principal poblado antes del throttler de actor)                                                                             | E     |
| 20  | `CHECKOUT_BUSY` 503 con código público; semáforo libera el cupo                                                                                                                  | U, E  |
| 21  | Token: firma válida, vigencia, manipulación de campo, secreto ausente => `null`, sujeto distinto                                                                                 | U     |
| 22  | Sin N+1: contador de consultas <= presupuesto con 30 líneas                                                                                                                      | S, I  |
| 23  | Contrato: `contracts:check`; el cuerpo de `toQuoteInput` valida contra `CheckoutQuoteRequest.cart`                                                                               | U     |
| 24  | Web: huella de clave, debounce, cancelación y respuesta obsoleta descartada, «Continuar» deshabilitado en cada bloqueo y durante carga/expiración                                | W     |
| 25  | Web: bloqueos por proveedor independientes, `PRICE_CHANGED` con «Entendido», es/en                                                                                               | W     |
| 26  | Playwright: flujo pickup y delivery contra mock rotulado; delivery OWN con tarifa; PedidosYa `UNKNOWN`; a11y (axe), claro/oscuro, móvil/escritorio                               | P     |
| 27  | Playwright/http: carrera al cambiar dirección rápido (la última manda)                                                                                                           | P     |
| 28  | BD real (`store`-style int-spec, ejecutar localmente cuando haya PostgreSQL): `inspect`, extras por lote, zonas, direcciones                                                     | I     |

## 7. Criterios de aceptación

1. La API recalcula todo: ninguna propiedad monetaria de entrada se acepta; el total coincide exactamente con `subtotal − descuentos + envío` y con la suma de las líneas.
2. PedidosYa jamás da tarifa ni total ni `AVAILABLE` seleccionable; OWN solo con flag y zona; PICKUP sin tarifa.
3. `customerAddressId` anti-IDOR (404 idéntico) y 401 sin sesión.
4. Cupón: respuesta única, throttling específico, sin enumeración.
5. `private, no-store`, sin escritura, sin auditoría, consultas dentro del presupuesto.
6. Web: «Continuar» solo con cotización vigente y coincidente con las entradas actuales; checkout `http` sin cálculo de cliente definitivo; simulación rotulada en `mock`.
7. `pnpm contracts:check` verde tras implementar API; `pnpm check` verde.

## 8. Riesgos

| Riesgo                                                             | Mitigación                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Optional auth en el guard global puede abrir rutas por error       | Solo con metadato explícito; token presente e inválido => 401; prueba de regresión «sin metadato = 401»; revisión `security-reviewer` |
| Enumeración de cupones por el cotizador                            | Throttle específico + respuesta única + sin motivos; P15/P17 abiertas                                                                 |
| Cotización firmada confundida con compromiso de precio             | Documentado: F20 recalcula y compara; sin reserva                                                                                     |
| Semáforo por instancia (serverless)                                | Aceptado (igual que F17); P9                                                                                                          |
| Mock de PedidosYa filtrado a producción                            | Reutiliza validación F09 + prueba; F19 trata `integrationStatus != LIVE` como no verificable                                          |
| Tarifa PedidosYa al cliente indefinida                             | P40; hasta entonces no seleccionable                                                                                                  |
| Divergencia mock/http de la UI                                     | `parity.test.ts` + tipos del contrato; mock rotulado                                                                                  |
| Propiedades de extras: `ModifierSelectionService` limita 10 grupos | Superarlo => `MODIFIER_INVALID` (no 5xx)                                                                                              |
| Cambio del precio entre cotización y pedido                        | F20 conflicto `QUOTE_CHANGED`, nunca sustitución silenciosa                                                                           |

## 9. Revisiones de seguridad y rendimiento (API) y riesgos aceptados

Revisión de `security-reviewer` y `performance-reviewer` sobre la parte API (solo lectura; sin mediciones reales: no hay BD de pruebas ejecutada). **Sin hallazgos Críticos ni Altos de seguridad.** Corregido en la implementación: `null` en opcionales ⇒ 400 (`OptionalNotNull`), errores del parser (413/JSON inválido) con `private, no-store` y sin ETag, separación de dominio en la firma del token (`token\0`), topes de líneas/selecciones antes de los pipes, cupo del semáforo `CHECKOUT_DB_GATE` = `max(1, floor((DB_POOL_MAX-1)/3))` repartido con el de F17 (la suma no supera `DB_POOL_MAX-1`; con pool de 1–2 el mínimo de 1 por gate suma 2), memoización en proceso de municipios, `DB_QUERY_TIMEOUT_MS` (`query_timeout` de pg; no se usa `statement_timeout` porque el transaction pooler lo rechaza), `warn` de promociones truncadas como máximo 1/min por sucursal.

**Riesgos aceptados / pendientes (no resueltos en F19):**

- **Cupón distribuido (M3):** el contador de cupón (10/min por IP, 20/min por actor) es por instancia y en memoria; la rotación de IP o varias instancias serverless lo debilitan. Mitigación real = almacén compartido (decisión de infraestructura, F39). `UNKNOWN`/`NOT_APPLIED` ya están colapsados, pero un cupón correcto sigue siendo un oráculo (`APPLIED` + descuento). Vigilar la tasa de `NOT_APPLIED`.
- **`TRUST_PROXY_HOPS` (M4):** con el valor por defecto 0 detrás de un proxy/CDN todos los invitados comparten IP o el límite se evade. Debe configurarse en el despliegue (runbook F39).
- **Llamada al proveedor dentro del semáforo (M2):** hoy PedidosYa no hace red (adaptador `unavailable`); al integrar F29, la llamada con timeout debe sacarse de la ranura de BD o tener su propio semáforo.
- **Enumeración de estado de producto (B1):** un invitado que conozca un UUID distingue `NOT_FOUND`/`INACTIVE`/`UNAVAILABLE`. Se mantiene porque el contrato y F18 distinguen esos estados; los UUID no son adivinables y no se expone precio.
- **`CHECKOUT_QUOTE_SECRET` (B3):** opcional (≥ 32 caracteres); sin él no hay token. No se hace obligatorio en producción hasta F20. Generar con ≥ 32 bytes aleatorios.
- **Lectura completa de categorías (`findAllNodes`)** por cotización y consultas de promociones candidatas con subconsultas por fila: baratas con el volumen actual; **sin medir**. Plan de medición pendiente: `EXPLAIN (ANALYZE, BUFFERS)`, p50/p95 de `quote()` con 1/2/4/8 concurrentes y `DB_POOL_MAX` 3 y 5, prueba mixta F17+F19.
- **`query_timeout`** corta del lado cliente pero no cancela la consulta en el servidor; un timeout sale como 500 genérico (no `CHECKOUT_BUSY`).
- **Cuerpo 64–100 KB:** responde 400 `QUOTE_LIMITS_EXCEEDED`; por encima de 100 KB responde 413 (parser global, no declarado en el contrato).
- **Para F20:** recotizar siempre con `CheckoutQuoteService` y no confiar en importes del token; comparar `sub` (el token de invitado lleva `sub = "guest"`); el token liga el id de dirección, no su contenido (la zona/municipio pueden cambiar); aplicar idempotencia (`Idempotency-Key`).
- **Verificado contra la BD de pruebas real (2026-11-18):** `checkout.int-spec.ts` 9/9 (SQL de `findOffersMany`, `findMunicipality`, `inspect`). Prueba manual con la API real y datos sembrados (luego borrados): retiro con extras (140 − 12 = 128), grupo obligatorio ausente ⇒ `MODIFIER_INVALID`, agotado ⇒ `UNAVAILABLE`, carrito vacío y campos de precio/tarifa ⇒ 400, cupón colapsado (`NOT_APPLIED`) y válido (`APPLIED`), reparto propio con tarifa Q15 (total 33), fuera de zona ⇒ `DELIVERY_UNVERIFIED`, PedidosYa `UNKNOWN`/`BLOCKED_EXTERNAL` no seleccionable y sin costo del proveedor, dirección guardada sin sesión ⇒ 401, sucursal inexistente ⇒ 422, `clientView` ⇒ solo `PRICE_CHANGED`, `private, no-store` siempre. Web en navegador contra la API real (invitado): totales idénticos a los del servidor, una cotización por cambio, paso final deshabilitado en `http` sin llamadas a `/v1/orders` ni `/v1/payments`.
- **Medido (BD de pruebas en Supabase desde el equipo local; incluye latencia de red):** cotización de 3 líneas con entrega, p50 ≈ 0,28 s (n=8, máx. 0,76 s). Con 6 concurrentes las respuestas salen escalonadas cada ≈ 0,29 s (el cupo del gate con `DB_POOL_MAX=3` es 1), sin 503. No medido: p95, carga sostenida ni prueba mixta F17+F19.
- **No verificado:** cliente autenticado con `customerAddressId` contra la API real (requiere sesión Supabase), lectores de pantalla, `EXPLAIN` de las consultas.
