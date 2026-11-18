# F20 — Creación de pedidos, invitados e idempotencia

**Rama**: `feature/F20-order-creation` (desde `develop` 65382d1, que incluye F19) · **Dueño**: A · **Prioridad**: P0 · **Tipo**: API + WEB (confirmación de pedido)
**Dependencias**: F19 (cotizador y token), F01/F04 (cliente autenticado opcional), F05 (dirección guardada), F08/F09/F12/F13/F15 (vía el cotizador) · **Decisiones**: `docs/adr/0026-creacion-pedidos-idempotencia.md` · **Pendientes**: P48–P60 en `docs/business-rules/decisiones-pendientes.md`
**Estado global**: `CONTRACT_DEFINED` (operaciones `createOrder` y `getOrder` y esquemas `Order*` en `openapi.yaml`; sin migración, API ni web). `pnpm contracts:check` queda rojo solo por esas dos operaciones sin implementar (esperado). PedidosYa real: `BLOCKED_EXTERNAL` (F29); pagos: F24/F25.

## 1. Alcance y fuera de alcance

Dentro: `POST /v1/orders` (invitado o autenticado, `Idempotency-Key` obligatoria, recotización con el cotizador de F19) y `GET /v1/orders/{id}` (dueño por JWT o token de invitado); migración 0018 (pedidos, snapshots, historial, tokens de acceso, claves de idempotencia); número de pedido por secuencia; confirmación web real («pedido recibido») sobre el checkout de F19; limpieza del carrito solo tras éxito confirmado; auditoría `order.created`.
Fuera: cobro, registro de pagos y conciliación (F24/F25/F26); seguimiento ampliado, línea de tiempo y `POST /v1/orders/lookup` (F21); tablero y transiciones (F22); historial/reordenar/recibo (F23); entregas OWN (F28); PedidosYa (F29); WhatsApp u otras notificaciones (F31); reserva de inventario; pedidos programados (P42); notas por línea (P35: `CartQuoteInput` no las transporta); vincular pedidos de invitado a una cuenta posterior.

Estado de implementación inicial: contrato `CONTRACT_DEFINED`; migración 0018 propuesta (database-engineer); módulo API `orders` pendiente; web real pendiente (hoy `MOCK_ONLY`: el paso final del checkout en `http` está deshabilitado); PedidosYa `BLOCKED_EXTERNAL`; tarjeta (Neonet) `BLOCKED_EXTERNAL`.

## 2. Contrato (fuente: `openapi.yaml`)

### 2.1 `POST /v1/orders` · `createOrder` · tag `orders`

`security: [{}, {bearer: []}]` (`@OptionalAuth()` de F19). Cabecera obligatoria `Idempotency-Key` (`^[A-Za-z0-9_-]{22,128}$`; un UUID v4 cumple). Cuerpo `OrderCreateRequest` (`additionalProperties:false`, ≤ 64 KB):

| Campo                                         | Obligatorio                         | Notas                                                                                                                                                                                                    |
| --------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cart`                                        | sí                                  | `CartQuoteInput` de F18, IGUAL al cotizado                                                                                                                                                               |
| `fulfillment`                                 | sí                                  | `CheckoutFulfillmentInput` de F19, IGUAL al cotizado (PICKUP, o DELIVERY con `customerAddressId` XOR `municipalityId`+`zone`)                                                                            |
| `couponCode`                                  | no                                  | IGUAL al cotizado                                                                                                                                                                                        |
| `quoteToken`                                  | sí                                  | `quote.token` aceptado por el cliente                                                                                                                                                                    |
| `contact{fullName,phone,email?}`              | invitado: sí (`fullName` y `phone`) | Autenticado: opcional, se completa desde `customers` (falta teléfono en ambos: 422 `CONTACT_INCOMPLETE`). Teléfono GT 8 dígitos, `+502` opcional, se guarda `+502XXXXXXXX`. Sin sobreescribir el perfil. |
| `deliveryAddress{addressLine,referenceNote?}` | DELIVERY con `municipalityId`       | Prohibido con `customerAddressId` (se copia la guardada) y con PICKUP (400). No afecta precio ni huella: la cobertura es municipio+zona.                                                                 |
| `notes`                                       | no                                  | ≤ 280, texto plano (sin control/bidi); no entra en logs                                                                                                                                                  |
| `paymentMethodPreference`                     | no                                  | `cash` \| `bank_transfer`. Solo preferencia (columna `payment_method_preference`); `card` => 422 `PAYMENT_METHOD_UNAVAILABLE` (F25 `BLOCKED_EXTERNAL`)                                                   |

Ningún importe, estado de pago, cobertura ni `customerId` se acepta (400). Respuestas: `201 OrderCreated`; `200 OrderCreated` en repetición idempotente (`Idempotent-Replayed: true`); errores en 2.3. `Cache-Control: private, no-store`, `Location: /v1/orders/{id}`.

`OrderCreated { order: OrderDetail, access: OrderGuestAccess | null }`. `access = { guestToken, expiresAt }` solo si el pedido es de invitado.

### 2.2 `GET /v1/orders/{id}` · `getOrder`

`{id}` = UUID del pedido (no el número visible). Autorización (solo servidor): (a) JWT del cliente dueño (`orders.customer_id` = cliente de la sesión), o (b) cabecera `X-Order-Token` (`smo_` + 43 caracteres base64url): se busca `sha256(token)` en `order_access_tokens` con `order_id = {id}`, no vencido ni revocado. Cualquier otro caso (inexistente, ajeno, sin token, token inválido, vencido o revocado) => el MISMO 404 sin `code`. Un cliente autenticado NO ve con su JWT un pedido de invitado (sin vincular). `OrderDetail`: importes en cadenas, líneas con snapshot, promociones, dirección sin coordenadas, contacto con teléfono enmascarado y sin correo, `payment{methodPreference, status:'NOT_STARTED'}`, `status`. Respuesta `private, no-store` + `Vary: Authorization, X-Order-Token`.
Por qué cabecera y no query: la query queda en logs de acceso, historial, `Referer` y proxies; la cabecera no (F21 podrá añadir un enlace compartible con token en fragmento `#`, nunca en query).

### 2.3 Errores (códigos en el catálogo de `ErrorResponse.code`)

| HTTP | `code`                                                                                                  | Cuándo                                                                                                                 | Cuerpo extra                            |
| ---- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 400  | `IDEMPOTENCY_KEY_INVALID`                                                                               | Cabecera ausente o con formato inválido                                                                                | —                                       |
| 400  | (validación)                                                                                            | Forma, importes en la entrada, contacto/teléfono/correo, notas, `deliveryAddress` incoherente, `QUOTE_LIMITS_EXCEEDED` | `violations`                            |
| 401  | —                                                                                                       | JWT presente e inválido, o `customerAddressId` sin sesión                                                              | —                                       |
| 404  | —                                                                                                       | Dirección guardada ajena o inexistente (igual)                                                                         | —                                       |
| 409  | `QUOTE_CHANGED`                                                                                         | La recotización difiere del token (proveedor, subtotal, descuento, tarifa, total o líneas)                             | `OrderQuoteConflict{changes, quote}`    |
| 409  | `QUOTE_EXPIRED`                                                                                         | Token vencido (>10 min). Recotizar y reintentar                                                                        | `OrderQuoteConflict{changes:[], quote}` |
| 409  | `IDEMPOTENCY_KEY_REUSED`                                                                                | Misma clave y cuerpo distinto                                                                                          | —                                       |
| 409  | `IDEMPOTENCY_IN_PROGRESS`                                                                               | Esperar a una solicitud concurrente superó `lock_timeout` (3 s). `Retry-After: 1`. Reintentar con la MISMA clave       | —                                       |
| 422  | `QUOTE_INVALID`                                                                                         | Firma inválida, sujeto (`sub`) distinto, huella de entrada distinta del cuerpo, formato malformado                     | —                                       |
| 422  | `CHECKOUT_BLOCKED`                                                                                      | La recotización trae `canProceed=false`                                                                                | `OrderBlocked{blockers}`                |
| 422  | `DELIVERY_PROVIDER_NOT_SELECTABLE`                                                                      | Proveedor PEDIDOSYA (o cualquiera no `OWN`) elegido o resultante. Invariante propia de F20 (cinturón y tirantes)       | —                                       |
| 422  | `CONTACT_INCOMPLETE` · `PAYMENT_METHOD_UNAVAILABLE` · `BRANCH_NOT_AVAILABLE` · `MUNICIPALITY_NOT_FOUND` | Ver contrato                                                                                                           | —                                       |
| 429  | `RATE_LIMITED` · `PENDING_ORDERS_LIMIT`                                                                 | Tasa por IP/actor; tope de pedidos `pending` (P51)                                                                     | `Retry-After` (solo tasa)               |
| 503  | `ORDERS_BUSY`                                                                                           | Semáforo `ORDERS_DB_GATE` saturado o sin conexión. Reintentable con la MISMA clave                                     | —                                       |
| 503  | `ORDERS_UNAVAILABLE`                                                                                    | `CHECKOUT_QUOTE_SECRET` ausente o < 32 caracteres: fail-closed, nunca se crea un pedido sin verificar la cotización    | —                                       |

`ORDERS_BUSY` y `ORDERS_UNAVAILABLE` se añaden a `PUBLIC_5XX_CODES` (`http-exception.filter.ts`), con mensaje fijo y justificación en esta spec (contrato público; reintentable / configuración).

Decisión token ausente/inválido/vencido: el campo `quoteToken` es obligatorio en el esquema (ausente => 400). **Vencido => 409 `QUOTE_EXPIRED`** (estado recuperable: el cliente recotiza y reconfirma; trae la cotización nueva). **Inválido => 422 `QUOTE_INVALID`** (error del cliente o manipulación: no se ofrece recuperación en el cuerpo; la web recotiza igualmente).

### 2.4 Esquema real frente al mock `Order` (divergencias y migración del mock)

El borrador `Order`/`CreateOrderRequest`/`OrderStatus` (x-status draft, usados por `sushimon-web/src/lib/data-access/models.ts:205-226`) NO se modifica en esta spec para no romper el typecheck de la web; los esquemas reales son nuevos y coexisten:

| Aspecto                            | Borrador (mock)                                                                                                               | Real (F20)                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Nombre                             | `Order`, `CreateOrderRequest`, `OrderStatus`                                                                                  | `OrderDetail`, `OrderCreateRequest`, `OrderLifecycleStatus`, `OrderCreated`                                                   |
| Id                                 | `id` = `MON-490217` (número visible, usado como clave)                                                                        | `id` UUID + `orderNumber` int64 + `displayNumber` `MON-001042`                                                                |
| Entrada                            | `lines[{productId,quantity,note}]`, `branchId?`, `schedule`, `customer`, `address{department,…}`, `paymentMethod: cash\|card` | `cart` (F18), `fulfillment` (F19), `quoteToken`, `contact`, `deliveryAddress`, `paymentMethodPreference: cash\|bank_transfer` |
| Importes                           | `number`                                                                                                                      | `CheckoutMoney` (cadena de 2 decimales)                                                                                       |
| Estado inicial                     | `received`                                                                                                                    | `pending` (`received` => `pending`; `delivered` se divide en `delivered`/`picked_up`)                                         |
| Pago/entrega/historial/incidencias | embebidos en `Order`                                                                                                          | solo `payment{methodPreference,status:'NOT_STARTED'}`; resto es F21/F24/F28                                                   |
| Programado                         | `schedule`                                                                                                                    | fuera (P42)                                                                                                                   |
| PII                                | completa                                                                                                                      | teléfono enmascarado, sin correo ni coordenadas                                                                               |

Plan de migración del mock (web-engineer): renombrar los borradores a `DraftOrder*` en `models.ts` (alias locales) para que `/pedidos/[id]`, backoffice y los handlers `mocks/handlers/orders.ts` y `backoffice*.ts` sigan intactos en `mock`; añadir tipos nuevos desde `components['schemas']['Order*']`; el handler mock `POST /v1/orders` produce la forma real (`OrderCreated`, `access.guestToken` ficticio rotulado) y se verifica con `parity.test.ts`; el seguimiento mock sigue con el borrador hasta F21. Al terminar F21/F22 se retira el borrador.

## 3. Reglas de servidor

1. `Idempotency-Key` válida, o 400.
2. Secreto: sin `CHECKOUT_QUOTE_SECRET` (≥ 32) => 503 `ORDERS_UNAVAILABLE`.
3. DTO validado (reutiliza los pipes y topes de F19: 30 líneas, 99 por línea, 200 unidades, 300 selecciones; 64 KB: `checkoutBodyLimitMiddleware` extendido a `POST /v1/orders`). Contacto normalizado (teléfono, correo) y notas saneadas.
4. Actor: `principal` => `IdentityService.ensureCustomer(principal)` (crea la fila `customers` si no existe, patrón F04; NUNCA crea usuarios Supabase) y `customer_id` sale de ahí. Invitado => `customer_id` NULL.
5. **Repetición** (consulta de la clave, §4) ANTES de validar el token: un reintento tras `QUOTE_EXPIRED` natural devuelve el pedido original.
6. Tope de pedidos `pending` por actor/teléfono (provisional 3, P51): 429 `PENDING_ORDERS_LIMIT`.
7. Verificación del token (`verifyQuoteToken`): `MALFORMED`/`BAD_SIGNATURE`/`NOT_YET_VALID` => 422 `QUOTE_INVALID`; `EXPIRED` => 409 `QUOTE_EXPIRED` (con cotización nueva); `sub` != sujeto del actor => 422 `QUOTE_INVALID` (un token de invitado no sirve con sesión ni a la inversa; la web recotiza al cambiar de cuenta).
8. **Recotización**: `CheckoutQuoteService.quoteWithEvidence(principal, {cart, fulfillment, couponCode})` (sin `clientView`), una sola vez, con el mismo cotizador y su `CHECKOUT_DB_GATE`. `canProceed=false` => 422 `CHECKOUT_BLOCKED{blockers}` (primero el invariante PEDIDOSYA). Comparación (política P52: rechazar CUALQUIER diferencia, también mejoras): `inputHash` distinto => 422 `QUOTE_INVALID`; `provider`/`subtotal`/`discountTotal`/`deliveryFee`/`total`/`linesHash` distintos => 409 `QUOTE_CHANGED{changes, quote}` con la cotización nueva (su token nuevo permite una nueva confirmación; la web exige re-aceptación y una `Idempotency-Key` nueva).
9. Lecturas de snapshot (una oleada, 3 consultas por lote, sin N+1): nombres de productos, de modificadores y de promociones aplicadas (`findMany ... in`). El lugar (municipio, zona, dirección guardada) lo devuelve `quoteWithEvidence` (`resolved.place`), sin releer.
10. Transacción corta (§4), sin red externa.
11. Después del commit: `OrderEventsPublisher.orderCreated` (puerto no-op; F31 lo implementa). Un fallo aquí NUNCA falla la creación.
12. `Cache-Control: private, no-store` en todas las respuestas, errores incluidos. Logs: `requestId`, `orderId`, códigos, conteos; nunca contacto, dirección, notas, tokens, claves ni cupón.

## 4. Idempotencia (PostgreSQL, tabla `app.order_idempotency_keys`)

Alcance (`scope`): `customer:<customers.id>` o `guest`. Clave: `key_hash = sha256(Idempotency-Key)` (no se guarda la clave en claro: una fuga de la tabla no permite repetir ni rotar tokens de invitado). `request_hash = HMAC-SHA256(CHECKOUT_QUOTE_SECRET, 'order-body\0' + JSON canónico)` del cuerpo normalizado: líneas ordenadas, selecciones ordenadas, cupón normalizado, `fulfillment`, `deliveryAddress`, `contact` normalizado, `notes`, `paymentMethodPreference`; SIN `quoteToken` (para que un reintento con token renovado siga siendo «el mismo intento»). `UNIQUE (scope, key_hash)`. TTL 24 h (`expires_at`, P48). La clave de un actor nunca recupera un pedido de otro (el scope forma parte de la unicidad).

Protocolo:

1. **Fast path** (1 consulta, fuera de transacción): `SELECT request_hash, order_id FROM order_idempotency_keys WHERE scope=$1 AND key_hash=$2 AND expires_at > now()`. Existe y `request_hash` igual => cargar el pedido y responder **200** + `Idempotent-Replayed: true` (invitado: revoca los tokens activos del pedido y emite uno nuevo; autenticado: `access=null`). Existe y distinto => 409 `IDEMPOTENCY_KEY_REUSED`.
2. No existe => flujo normal (§3.6–3.9). Fila vencida con la misma clave: se borra de forma perezosa justo antes de la transacción (`DELETE ... WHERE scope=$1 AND key_hash=$2 AND expires_at <= now()`); además, con probabilidad 1/50 por creación, `DELETE ... WHERE id IN (SELECT id ... WHERE expires_at < now() LIMIT 100)`. Sin cron.
3. **Transacción** (`READ COMMITTED`, una conexión; el primer paso es `SET LOCAL lock_timeout = '3s'`):
   a. `INSERT INTO order_idempotency_keys (id, scope, key_hash, request_hash, order_id, expires_at) VALUES (...) ON CONFLICT (scope, key_hash) DO NOTHING RETURNING id`. El `order_id` es un UUID generado en la aplicación y la FK `order_id -> orders` es `DEFERRABLE INITIALLY DEFERRED` (se comprueba al `COMMIT`): así la clave se reclama ANTES de gastar un número de secuencia.
   b. Si NO devuelve fila (otra transacción ya la tiene): `SELECT request_hash, order_id ...`; igual => se descarta la transacción (`ROLLBACK`) y se responde como repetición (200); distinto => 409 `IDEMPOTENCY_KEY_REUSED`.
   c. Si devuelve fila (somos dueños): `INSERT orders` (devuelve `order_number`), `createMany` de `order_addresses`, `order_items`, `order_item_modifiers`, `order_promotions`, `order_status_history` (una fila `NULL -> pending`), `order_access_tokens` (invitado), y `AuditService.record(tx, {action:'order.created', ...})` (mismo cliente transaccional). ~9 sentencias, por lote.
   d. `COMMIT`.
4. **Por qué no hay estado «en progreso» persistente**: la fila de clave y el pedido nacen en la MISMA transacción; «en progreso» es el bloqueo de la fila no confirmada: una segunda transacción con la misma clave se BLOQUEA en el `INSERT ... ON CONFLICT` (PostgreSQL espera al ganador) y, al confirmarse este, recibe el conflicto y devuelve el MISMO pedido. Si el ganador revierte (error, caída del proceso, corte de conexión) la clave desaparece y el segundo la toma: no existen claves huérfanas ni pedidos sin clave. `lock_timeout` acota la espera (el pool no se agota): al vencer => 409 `IDEMPOTENCY_IN_PROGRESS` con `Retry-After: 1` (el reintento con la misma clave caerá en el fast path). `lock_timeout` sí funciona con el transaction pooler porque es `SET LOCAL` dentro de la transacción (a diferencia de `statement_timeout`, ver F19 §9).
5. Errores transitorios (503/red) => no se confirma nada; el cliente reintenta con la misma clave sin riesgo.

### Los 7 escenarios

| #   | Escenario                                 | Resultado                                                                                                                                                                 |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Doble clic                                | La web envía una sola vez (`busy` + ref síncrona). Si dos peticiones llegan: igual que 5.                                                                                 |
| 2   | Reenvío manual tras error                 | Misma clave si no cambió la huella de entrada: la repetición devuelve el pedido (200) o crea uno solo.                                                                    |
| 3   | La red cae después del commit             | El cliente no vio la respuesta: reintenta con la misma clave => 200 con el mismo pedido y, si es invitado, un `guestToken` nuevo (el anterior se revoca). No se recotiza. |
| 4   | Reintento con la misma clave              | Fast path: mismo pedido, sin recotizar ni validar vigencia del token, `Idempotent-Replayed: true`.                                                                        |
| 5   | Dos solicitudes concurrentes, misma clave | Una gana el `INSERT`; la otra espera y recibe el mismo pedido (200) o 409 `IDEMPOTENCY_IN_PROGRESS` si superó 3 s. Nunca dos pedidos (UNIQUE).                            |
| 6   | Misma clave con otros productos           | `request_hash` distinto => 409 `IDEMPOTENCY_KEY_REUSED`; no se crea ni se devuelve nada. La web genera una clave nueva al cambiar la huella.                              |
| 7   | Reinicio del servidor                     | Todo vive en PostgreSQL: el estado sobrevive; una transacción cortada por el reinicio revierte entera (clave incluida).                                                   |

## 5. Número de pedido, estados y pagos

- `orders.order_number bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001)` UNIQUE (secuencia/identity de PostgreSQL; nunca `MAX+1`). Creciente y único, NO contiguo (una transacción revertida consume número; la reclamación previa de la clave minimiza los huecos por concurrencia). `displayNumber = 'MON-' + lpad(order_number, 6, '0')` en presentación (la sucursal no es parte del número, evita rehacer formato si se abre otra; el prefijo por sucursal queda como opción de presentación, P53). Nunca es credencial: el acceso exige UUID + JWT o token (`/v1/orders/lookup` por número+teléfono es F21).
- Catálogo OFICIAL de estados (CHECK en `orders.status` y `order_status_history`): `pending, accepted, preparing, ready, on_the_way, delivered, picked_up, rejected, cancelled`. F20 SOLO escribe `pending`. Transiciones y motivos: F22. Equivalencias con el mock actual: `received`=`pending`; `delivered` (mock, para ambas modalidades) = `delivered` (DELIVERY) o `picked_up` (PICKUP). Los clientes toleran valores futuros.
- Pedido ≠ pagado ≠ aceptado ≠ entregado (invariante del dominio). `pending` significa «recibido, sin procesar por la sucursal». «Pendiente de pago» NO es un estado del pedido: lo derivará F24 de la ausencia de un `payments` confirmado. F20 no crea tablas ni filas de pago: deja `payment_method_preference` en `orders` y `orders.id`/`total` para que F24 inserte `app.payments(order_id, method_id, amount=total, status='pending', idempotency_key)` según el DBML. La API expone `payment.status='NOT_STARTED'` (honesto: nada se cobró ni se intentó).
- El pedido NO crea `deliveries` (F28/F29 lo harán mediante `OrderFulfillmentPort`, F22).

## 6. Migración 0018 propuesta (database-engineer implementa; aquí solo el DDL de referencia)

Incremental, aditiva, sin DROP/TRUNCATE ni cambios en migraciones previas. Evoluciona el DBML (documentar en `docs/database/` las columnas añadidas: `delivery_provider`, `extras_total`, `payment_method_preference`, `promotion_name`, `line_no`, `extras_per_unit`, tablas `order_access_tokens` y `order_idempotency_keys`). Reversión: eliminar las 8 tablas, los triggers y funciones (sin datos que conservar mientras no haya pedidos reales).

```sql
CREATE TABLE app.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001) NOT NULL,
  customer_id uuid REFERENCES app.customers(id) ON DELETE SET NULL,       -- invitado = NULL; SET NULL permite borrar al cliente conservando el pedido
  branch_id uuid NOT NULL REFERENCES app.branches(id) ON DELETE RESTRICT,
  customer_name text NOT NULL, customer_phone text NOT NULL, customer_email text,
  fulfillment_type text NOT NULL,
  delivery_provider text,
  scheduled_for timestamptz,                                              -- DBML; F20 siempre NULL (P42)
  notes text,
  status text NOT NULL DEFAULT 'pending',
  subtotal numeric(12,2) NOT NULL, extras_total numeric(12,2) NOT NULL DEFAULT 0,
  discount_total numeric(12,2) NOT NULL DEFAULT 0, delivery_fee numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL, currency char(3) NOT NULL DEFAULT 'GTQ',
  payment_method_preference text,
  placed_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_order_number_key UNIQUE (order_number),
  CONSTRAINT orders_fulfillment_chk CHECK (fulfillment_type IN ('PICKUP','DELIVERY')),
  CONSTRAINT orders_provider_chk CHECK (delivery_provider IS NULL OR delivery_provider IN ('OWN','PEDIDOSYA')),
  CONSTRAINT orders_provider_coherent_chk CHECK (
    (fulfillment_type = 'PICKUP' AND delivery_provider IS NULL AND delivery_fee = 0) OR
    (fulfillment_type = 'DELIVERY' AND delivery_provider IS NOT NULL)),
  CONSTRAINT orders_status_chk CHECK (status IN ('pending','accepted','preparing','ready','on_the_way','delivered','picked_up','rejected','cancelled')),
  CONSTRAINT orders_money_chk CHECK (subtotal >= 0 AND extras_total >= 0 AND extras_total <= subtotal
    AND discount_total >= 0 AND discount_total <= subtotal AND delivery_fee >= 0 AND total >= 0),
  CONSTRAINT orders_total_chk CHECK (total = subtotal - discount_total + delivery_fee),
  CONSTRAINT orders_currency_chk CHECK (currency = 'GTQ'),
  CONSTRAINT orders_payment_pref_chk CHECK (payment_method_preference IS NULL OR payment_method_preference IN ('cash','bank_transfer')),
  CONSTRAINT orders_contact_chk CHECK (btrim(customer_name) <> '' AND char_length(customer_name) <= 120
    AND customer_phone ~ '^\+502[0-9]{8}$' AND (customer_email IS NULL OR char_length(customer_email) <= 254)),
  CONSTRAINT orders_notes_chk CHECK (notes IS NULL OR char_length(notes) <= 280)
);
CREATE INDEX orders_branch_status_placed_idx ON app.orders (branch_id, status, placed_at DESC);        -- F22
CREATE INDEX orders_customer_placed_idx ON app.orders (customer_id, placed_at DESC) WHERE customer_id IS NOT NULL;  -- F23
CREATE INDEX orders_phone_pending_idx ON app.orders (customer_phone, placed_at DESC) WHERE status = 'pending';      -- tope P51

CREATE TABLE app.order_addresses (
  order_id uuid PRIMARY KEY REFERENCES app.orders(id) ON DELETE RESTRICT,
  municipality_name text NOT NULL, zone text, address_line text NOT NULL, reference_note text,
  latitude numeric(10,7), longitude numeric(10,7),
  CONSTRAINT order_addresses_line_chk CHECK (btrim(address_line) <> '' AND char_length(address_line) <= 200));

CREATE TABLE app.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  line_no smallint NOT NULL,
  product_id uuid REFERENCES app.products(id) ON DELETE RESTRICT,        -- referencia informativa; el snapshot es la fuente
  product_name text NOT NULL, quantity integer NOT NULL,
  unit_price numeric(12,2) NOT NULL, extras_per_unit numeric(12,2) NOT NULL DEFAULT 0,
  line_discount numeric(12,2) NOT NULL DEFAULT 0, notes text,
  CONSTRAINT order_items_order_line_key UNIQUE (order_id, line_no),
  CONSTRAINT order_items_chk CHECK (quantity BETWEEN 1 AND 99 AND unit_price >= 0 AND extras_per_unit >= 0
    AND line_discount >= 0 AND line_discount <= unit_price * quantity));
CREATE INDEX order_items_order_idx ON app.order_items (order_id);

CREATE TABLE app.order_item_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL REFERENCES app.order_items(id) ON DELETE RESTRICT,
  modifier_id uuid REFERENCES app.modifiers(id) ON DELETE RESTRICT,
  modifier_name text NOT NULL, quantity integer NOT NULL DEFAULT 1, unit_extra_price numeric(12,2) NOT NULL,
  CONSTRAINT order_item_modifiers_chk CHECK (quantity >= 1 AND unit_extra_price >= 0));
CREATE INDEX order_item_modifiers_item_idx ON app.order_item_modifiers (order_item_id);

CREATE TABLE app.order_promotions (
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  promotion_id uuid NOT NULL REFERENCES app.promotions(id) ON DELETE RESTRICT,
  promotion_name text NOT NULL, amount numeric(12,2) NOT NULL,
  PRIMARY KEY (order_id, promotion_id), CONSTRAINT order_promotions_amount_chk CHECK (amount > 0));

CREATE TABLE app.order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  old_status text, new_status text NOT NULL,
  changed_by uuid,                                                       -- staff_users.id, SIN FK (mismo criterio que audit_events); NULL = sistema/cliente
  reason text, changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_status_history_chk CHECK (new_status IN (...mismo catálogo...) AND (old_status IS NULL OR old_status IN (...)) AND (reason IS NULL OR char_length(reason) <= 500)));
CREATE INDEX order_status_history_order_idx ON app.order_status_history (order_id, changed_at);

CREATE TABLE app.order_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  CONSTRAINT order_access_tokens_hash_key UNIQUE (token_hash),
  CONSTRAINT order_access_tokens_chk CHECK (octet_length(token_hash) = 32 AND expires_at > created_at));
CREATE INDEX order_access_tokens_order_idx ON app.order_access_tokens (order_id) WHERE revoked_at IS NULL;

CREATE TABLE app.order_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL, key_hash bytea NOT NULL, request_hash bytea NOT NULL,
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  CONSTRAINT order_idempotency_keys_scope_key UNIQUE (scope, key_hash),
  CONSTRAINT order_idempotency_keys_chk CHECK ((scope = 'guest' OR scope ~ '^customer:[0-9a-f-]{36}$')
    AND octet_length(key_hash) = 32 AND octet_length(request_hash) = 32 AND expires_at > created_at));
CREATE INDEX order_idempotency_keys_expires_idx ON app.order_idempotency_keys (expires_at);
```

Triggers (patrón de 0004 `audit_events_append_only`): (1) `order_status_history`: BEFORE UPDATE OR DELETE => excepción (append-only; TRUNCATE por privilegios). (2) `order_items`, `order_item_modifiers`, `order_promotions`, `order_addresses`: BEFORE UPDATE OR DELETE => excepción (snapshots inmutables). (3) `orders`: BEFORE UPDATE que rechaza el cambio de `id, order_number, branch_id, fulfillment_type, delivery_provider, subtotal, extras_total, discount_total, delivery_fee, total, currency, placed_at` (los campos de contacto y `customer_id` quedan fuera: `ON DELETE SET NULL` y el borrado de PII por derecho del cliente los actualizan; `status`, `notes`, `updated_at` los usa F22). (4) Constraint triggers `DEFERRABLE INITIALLY DEFERRED`: `order_addresses` solo si `orders.fulfillment_type='DELIVERY'`, y un pedido DELIVERY exige su fila de dirección al confirmar. La coherencia entre líneas y totales (`subtotal = Σ (unit_price + extras_per_unit) × quantity`, `discount_total = Σ line_discount` y Σ `order_promotions.amount`) se verifica en la aplicación y en la int-spec (un CHECK entre tablas exigiría un trigger costoso).
RLS: `ENABLE ROW LEVEL SECURITY` sin políticas y `REVOKE ALL` a `PUBLIC`, `anon` y `authenticated` (bloque guardado por existencia de rol, igual que 0016). Acceso solo vía API. Sin permisos RBAC nuevos en F20.

Snapshots: nombres, precios, cantidades, extras, descuento por línea, promociones con monto y nombre, y dirección (`municipality_name`, `zone`, `address_line`, `reference_note`, coordenadas de la guardada) se COPIAN. Las FKs a catálogo (`product_id`, `modifier_id`, `promotion_id`) son `ON DELETE RESTRICT`: el repositorio no borra productos, opciones ni promociones (se desactivan: no hay `DELETE` en `products`/`modifiers`/`promotions`), así un borrado accidental con pedidos falla en vez de romper la historia; el snapshot es la fuente de lectura. Moneda GTQ por CHECK. PII: nombre, teléfono, correo y dirección viven solo en el pedido (necesarios para entregar); la respuesta pública enmascara el teléfono y omite el correo; no van a `audit_events` ni a logs (P56 retención).

`schema.prisma` y la int-spec de migración (CHECKs, triggers, secuencia, FK diferida, UNIQUE de claves) son de database-engineer.

## 7. Transacción, concurrencia, auditoría y eventos

- Recotización y lecturas de snapshot ANTES de la transacción; la transacción solo escribe (9 sentencias, 1 conexión). Comprobación final dentro: NO se hace (ni `SELECT … FOR SHARE`). Justificación: F19 no reserva inventario ni congela precios (D5); la ventana entre la recotización y el `COMMIT` es de milisegundos; lo guardado es exactamente lo que el cliente aceptó (los importes coinciden con el token por la comparación); un `FOR SHARE` sobre `branch_products`/`products` añadiría bloqueos y viajes sin cerrar la ventana de verdad (el administrador puede cambiar el precio un instante después del `COMMIT` igualmente).
- Promociones con límites de uso: el modelo de F15 NO tiene canjes ni cupos (P15: «un cupón vigente puede usarse sin límite»); por tanto F20 no consume ni decrementa nada. Registra en `order_promotions` lo aplicado para que un futuro modelo de canjes (P15) pueda construirse sobre historia veraz.
- Semáforo `ORDERS_DB_GATE` propio (`DbGate`, cola 8, espera 1,5 s, `ordersBusy` => 503 `ORDERS_BUSY`); `splitGateBudget` pasa a repartir `DB_POOL_MAX − 1` en tres cupos (checkout, store, orders; mínimo 1 cada uno; con pool 3 el mínimo suma ≤ pool). El gate envuelve el fast path de idempotencia, las lecturas de snapshot y la transacción (la recotización usa el gate de F19; no se anidan). `getOrder` usa el mismo gate (lectura corta).
- Auditoría: SÍ, `order.created` con `AuditService.record(tx, ...)` en la misma transacción (`actorId: null`: `actor_id` es `staff_users.id` y el cliente/invitado no es personal; `entityType:'order'`, `entityId`, `branchId`, `newValues:{status:'pending', fulfillmentType, deliveryProvider, total, itemCount, actor:'guest'|'customer'}`, sin PII). Es el rastro de «quién/cuándo» junto a `order_status_history`; consume una fila por pedido (~100/día).
- Eventos (F31): NO existe patrón outbox en el repositorio. F20 define el puerto `OrderEventsPublisher` (`orderCreated({orderId, branchId})`) con `NoopOrderEventsPublisher`, llamado después del commit y sin afectar la respuesta si falla. No se envía nada real. Un outbox persistente (tabla `order_events` en la misma transacción) es una decisión de F31 con su ADR (P58).
- `OrderFulfillmentPort` (F22/F28) NO se crea en F20.

## 8. Autenticación, abuso y datos

- `@OptionalAuth()` en `createOrder` y `getOrder` (ya existe, ADR-0025 D2). `customer_id` siempre de la sesión; ningún `customerId` en el cuerpo. `customerAddressId` exige sesión y propiedad (404 idéntico; reutiliza `CustomerAddressesService.get`).
- Throttle: `CREATE_ORDER_THROTTLE` = 10/min por IP (`default`) y 10/min por actor; `GET` 60/min por IP y 30/min por actor (los intentos con token inválido cuentan). 429 `RATE_LIMITED` con `Retry-After`. `TRUST_PROXY_HOPS` sigue siendo requisito de despliegue (F19 §9, M4).
- Tope de pedidos `pending` por `customer_id` o por `customer_phone` normalizado (provisional 3; consulta por el índice parcial `orders_phone_pending_idx` / `orders_customer_placed_idx`): 429 `PENDING_ORDERS_LIMIT`. No es atómico (puede excederse por 1 bajo concurrencia); aceptado (P51).
- Token de invitado: 32 bytes de `crypto.randomBytes` (256 bits), formato `smo_` + base64url, guardado como `sha256` (alta entropía: no necesita sal ni HMAC) en `order_access_tokens`; vigencia 14 días desde la creación (P49), revocable (`revoked_at`); se muestra una vez (y se rota en una repetición idempotente). Tabla propia (no columna) para poder rotar, tener varios y revocar sin tocar `orders` (F21 podrá añadir enlaces compartibles). Comparación por igualdad del hash indexado.
- Teléfono (GT): `^(\+?502)?[\s-]?[2-7][0-9]{3}[\s-]?[0-9]{4}$` => `+502XXXXXXXX`; correo `format: email` ≤ 254; nombre 2–120 sin caracteres de control; notas ≤ 280. Datos mínimos del invitado: nombre y teléfono (P50).
- Sin PII en logs, ni en `audit_events`, ni en la clave de idempotencia (`key_hash`/`request_hash` irreversibles sin el secreto).

## 9. Web

Archivos y cambios (web-engineer; sin tocar `/pedidos/[id]` mock):

- `src/lib/data-access/types.ts` + clientes mock/http: `RequestOptions.headers?: Record<string,string>` (para `Idempotency-Key` y `X-Order-Token`; el cliente http los envía, nunca los registra); lectura de la cabecera `Idempotent-Replayed` no es necesaria (el 200 trae el mismo cuerpo).
- `src/lib/data-access/paths.ts`: `orders()`/`order(id)` ya existen; `models.ts`: alias de los esquemas reales y borradores renombrados `DraftOrder*` (§2.4).
- `src/services/orders.ts`: `createOrder(client, body, idempotencyKey, signal?)` y `getOrder(client, id, guestToken?)` tipados con el contrato real; el borrador se conserva para el mock del seguimiento.
- `src/features/orders/hooks.ts`: `useCreateOrder` real en `http`; en `mock` devuelve la forma real rotulada.
- `src/features/checkout/` nuevos: `order-attempt.ts` (clave + huella de entrada + sessionStorage), `use-place-order.ts` (máquina de estados), `confirmation-store.ts` (snapshot + token de invitado), `components/OrderReceived.tsx` (pantalla real). Cambios en `CheckoutFlow.tsx` (paso final: en `http` envía `OrderCreateRequest` con el `quoteToken` de la cotización vigente; retirar la rama «deshabilitado en http»), `Confirmation.tsx` (la versión actual sigue SOLO para mock rotulada «Simulación»), `PaymentStep.tsx` (en `http` solo `cash` y `bank_transfer` como preferencia con el texto «El pago se coordina con el restaurante»; tarjeta/Neonet deshabilitada y rotulada «no disponible», `BLOCKED_EXTERNAL`).
- `src/features/cart/cart-context.tsx`: reintroducir `clearAfterOrder(orderId: ConfirmedOrderId)`; `ConfirmedOrderId` es un tipo marcado (branded) que solo construye `confirmedOrderId(created: OrderCreated)` a partir de una respuesta 200/201 del servidor (política de F18/ADR-0024). Actualizar `cart-boundaries.test.ts` (ahora exige que `clearAfterOrder` solo se invoque con un id confirmado, desde `use-place-order.ts`, y nunca desde el flujo mock).
- `src/app/(public)/pedidos/[id]/page.tsx` y `features/tracking/components/order-detail.tsx`: en `mock` siguen igual (seguimiento simulado). En `http` muestran SOLO la confirmación mínima (`OrderReceived` con `getOrder`: número, estado `pending`, resumen, texto honesto, sin línea de tiempo ni «ver siguiente estado»); F21 lo completa.
- i18n es/en: `checkout.order.*` (enviando, reintentando, éxito, `QUOTE_CHANGED`, `QUOTE_EXPIRED`, bloqueos, clave reutilizada, 429, 503, `ORDERS_UNAVAILABLE`), `orders.received.*`. Texto fijo es: «Recibimos tu pedido. Te mostraremos su estado cuando el restaurante lo procese.»; NO dice aceptado ni pagado.
- `docs/ui/mock-data-strategy.md`: actualizar las filas «Pedido mock (`POST /v1/orders`)» y checkout (§ Documentos).

Comportamiento:

1. **Clave estable por intento lógico**: se genera (`crypto.randomUUID()`) al ENTRAR en la confirmación (paso final) y se guarda en `sessionStorage` (`monsushi-order-attempt`) con la huella de entrada (misma huella canónica de `useCheckoutQuote` + contacto, dirección, notas y preferencia). Se reutiliza ante cualquier reintento/error de red/503/`IDEMPOTENCY_IN_PROGRESS`; se DESCARTA tras éxito, al cambiar la huella, ante `QUOTE_CHANGED`/`QUOTE_EXPIRED`/`IDEMPOTENCY_KEY_REUSED` (el siguiente envío usa clave nueva) y al cerrar sesión/cambiar de cuenta.
2. **Un solo envío en vuelo**: ref síncrona + botón deshabilitado (`aria-busy`); un segundo clic no emite petición.
3. **Estados**: `enviando`; `ambiguo` (red caída/timeout/5xx sin respuesta: «Comprobando tu pedido…», reintento automático acotado con la MISMA clave, luego «Reintentar»); `éxito` solo tras 200/201 del servidor; `QUOTE_CHANGED` (muestra el nuevo total y los cambios, exige re-aceptación explícita y envía con el token nuevo y clave nueva); `QUOTE_EXPIRED` (recotiza automáticamente y vuelve a pedir confirmación); `CHECKOUT_BLOCKED` (reusa `QuoteAlerts`); `IDEMPOTENCY_KEY_REUSED` (clave nueva, vuelve a la confirmación); 429 (espera con `Retry-After`); 503/`ORDERS_BUSY` (reintento con la misma clave); `ORDERS_UNAVAILABLE` (mensaje «no podemos recibir pedidos ahora», sin reintento automático); 404/401 por dirección ajena (vuelve al paso de dirección).
4. **Éxito**: se guarda el snapshot y, si es invitado, el `guestToken` en `sessionStorage` (`monsushi-order-<id>`; por pestaña, no persiste al cerrarla; nunca en localStorage, URL ni logs); recién entonces `clearAfterOrder(confirmedId)` y se navega a la pantalla «pedido recibido». Recargar: `GET /v1/orders/{id}` con el `X-Order-Token` guardado o con la sesión; si no hay ni sesión ni token (otra pestaña/dispositivo) se muestra «Consulta tu pedido» (F21: lookup).
5. Insignias «Simulación»: solo en `mock` y en pasos aún simulados (tarjeta Neonet); el pedido en `http` ya no es simulación.

Autenticado: `contact` se omite o se precarga del perfil (F04) y es editable; la dirección guardada va por `customerAddressId`.

## 10. Cambios aditivos en F19 (api-engineer; sin cambiar el contrato público de `quoteCheckout`)

1. `CheckoutQuoteService.quoteWithEvidence(principal, body)`: devuelve `{ quote: CheckoutQuoteDto, evidence: QuoteEvidence | null, resolved: { place: { municipalityId, municipalityName, zone, savedAddress: {addressLine, referenceNote, latitude, longitude} | null } | null } }`; `quote()` pasa a delegar en él (sin cambiar su resultado). `QuoteEvidence` = el payload del token (`branchId, type, provider, subtotal, discountTotal, deliveryFee, total, inputHash, sub, linesHash`) construido siempre que `canProceed` (aunque no haya secreto).
2. `quote-token.ts`: campo OPCIONAL `linesHash` en `QuoteTokenPayload` (HMAC de las líneas efectivas: productId, precio, extras, descuento, promotionId, en orden de índice), con `isPayload` tolerante a su ausencia (tokens emitidos antes del despliegue, ≤ 10 min). Permite detectar cambios de línea que dejan igual el total. Exportar `canonicalInput` y la normalización para que `request_hash` de F20 y `inputHash` coincidan en canon.
3. `checkout-errors.ts`/`CheckoutModule`: exportar `CHECKOUT_QUOTE_SECRET_TOKEN` o un `QuoteTokenVerifier` (`verify(token, nowMs)`) para que `OrdersModule` verifique sin releer el entorno. `OrdersModule` importa `CheckoutModule` (no al revés: sin ciclos).
4. `PUBLIC_5XX_CODES`: `ORDERS_BUSY`, `ORDERS_UNAVAILABLE`. `splitGateBudget` en tres cupos. `checkoutBodyLimitMiddleware` también para `POST /v1/orders`.
5. Prueba de regresión: `quote()` y el contrato de F19 no cambian (suite de F19 verde).

## 11. Pruebas (U unitaria · S servicio con dobles · E e2e supertest · I int-spec con BD real · W Vitest web · P Playwright)

| #   | Caso                                                                                                                                                                              | Nivel   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | PICKUP válido: pedido `pending`, tarifa `0.00`, sin dirección                                                                                                                     | S, E, I |
| 2   | DELIVERY OWN con zona: tarifa de zona, snapshot de dirección                                                                                                                      | S, I    |
| 3   | OWN deshabilitado (flag apagado) o fuera de cobertura => 422 `CHECKOUT_BLOCKED` (`DELIVERY_UNVERIFIED`/`DELIVERY_UNAVAILABLE`), nada persistido                                   | S, E    |
| 4   | PedidosYa sin cobertura / elegido => 422 `DELIVERY_PROVIDER_NOT_SELECTABLE`; invariante aunque el cotizador mienta (doble que devuelve PEDIDOSYA)                                 | U, S, E |
| 5   | Cliente autenticado: `customer_id` de la sesión; `ensureCustomer` crea la fila; `customerId` en el cuerpo => 400                                                                  | S, E    |
| 6   | Invitado: `customer_id` NULL, contacto obligatorio, `guestToken` emitido; autenticado: `access=null`                                                                              | S, E    |
| 7   | Dirección guardada propia OK; ajena o inexistente => mismo 404; sin sesión => 401; `deliveryAddress` con `customerAddressId` => 400                                               | S, E    |
| 8   | Carrito vacío, líneas/unidades/selecciones sobre el tope => 400; producto inexistente/inactivo/agotado => `CHECKOUT_BLOCKED`                                                      | S, E    |
| 9   | Extras: válidos, obligatorios, máximo, opción inactiva; snapshot de nombres y precios de extras                                                                                   | S, I    |
| 10  | Cantidades 1..99; precios por sucursal (override vs base) quedan en el snapshot                                                                                                   | S, I    |
| 11  | Promociones/cupón: descuento por línea y `order_promotions` con monto y nombre; Σ `order_promotions` = `discount_total`                                                           | S, I    |
| 12  | Sucursal cerrada => `CHECKOUT_BLOCKED` (`BRANCH_CLOSED`); sucursal inactiva => 422 `BRANCH_NOT_AVAILABLE`                                                                         | S, E    |
| 13  | Token vencido => 409 `QUOTE_EXPIRED` con cotización nueva; reloj inyectado                                                                                                        | U, S    |
| 14  | Token ausente => 400; malformado, firma mala, `sub` distinto (guest vs sesión), entrada distinta => 422 `QUOTE_INVALID`                                                           | U, S, E |
| 15  | Cambio de precio/tarifa/descuento/línea entre cotización y pedido => 409 `QUOTE_CHANGED` con `changes` y `quote`; no persiste nada                                                | S, E    |
| 16  | Mejora de precio también rechazada (P52); mismo total con líneas distintas => `QUOTE_CHANGED` (`lines`)                                                                           | S       |
| 17  | Sin `CHECKOUT_QUOTE_SECRET` => 503 `ORDERS_UNAVAILABLE`, nada persistido                                                                                                          | S, E    |
| 18  | Precisión: `total = subtotal − descuento + tarifa` (tabla y propiedad con 99 × 9999.99); CHECKs de la BD rechazan totales incoherentes                                            | U, I    |
| 19  | Entrada con `price`, `total`, `deliveryFee`, `status`, `paid`, `coverage` => 400                                                                                                  | E       |
| 20  | Número de pedido: identity única, creciente; 20 creaciones concurrentes sin duplicados; huecos tolerados                                                                          | I       |
| 21  | Snapshots inmutables: cambiar nombre/precio del producto y del extra, o la dirección guardada, después del pedido no altera el pedido; UPDATE/DELETE de hijas fallan              | I       |
| 22  | Historial inicial: una fila `NULL -> pending`; append-only (UPDATE/DELETE fallan)                                                                                                 | I       |
| 23  | Rollback ante fallo parcial (falla `order_items`/auditoría): no quedan `orders`, hijas, token ni clave                                                                            | I       |
| 24  | Idempotencia: misma clave y cuerpo => mismo pedido, 200 + `Idempotent-Replayed`, sin recotizar, aun con token vencido                                                             | S, E, I |
| 25  | Idempotencia concurrente: N=10 `Promise.all` con la misma clave => 1 pedido, todas las respuestas con el mismo `id`                                                               | I       |
| 26  | Misma clave con cuerpo distinto => 409 `IDEMPOTENCY_KEY_REUSED`; claves de actores distintos no se cruzan (cliente A, cliente B, invitado)                                        | S, I    |
| 27  | Pérdida de respuesta (commit + corte): reintento devuelve el pedido; invitado recibe token nuevo y el anterior queda revocado (`GET` con el viejo => 404)                         | I       |
| 28  | `IDEMPOTENCY_IN_PROGRESS` por `lock_timeout` con transacción retenida; clave vencida se purga perezosamente y permite crear de nuevo                                              | I       |
| 29  | Reinicio: el estado de claves vive en la BD (nueva instancia del servicio ve la misma fila)                                                                                       | I       |
| 30  | `GET /v1/orders/{id}`: dueño por JWT OK; ajeno por JWT => 404; invitado con token OK; token de otro pedido, vencido, revocado, ausente => 404 idéntico                            | S, E, I |
| 31  | Cuerpo del 404 idéntico (mismo JSON) en todos los casos; `Cache-Control: private, no-store`; sin PII sensible en la respuesta (teléfono enmascarado, sin correo)                  | E       |
| 32  | Rate limit de creación y de lectura (IP, actor); tope de `pending` por teléfono/cliente => 429 `PENDING_ORDERS_LIMIT`                                                             | E, I    |
| 33  | No se marca nada pagado: `payment.status='NOT_STARTED'`; no se crean filas en `payments`/`deliveries`/`notifications`; `card` => 422                                              | S, I    |
| 34  | No hay llamadas externas ni notificaciones: `OrderEventsPublisher` no-op invocado tras el commit; su fallo no afecta la respuesta; sin red (adaptador PedidosYa sin invocar)      | S       |
| 35  | Auditoría `order.created` en la misma transacción, sin PII; `actor_id` NULL                                                                                                       | S, I    |
| 36  | Sin N+1: contador de consultas ≤ presupuesto con 30 líneas; `ORDERS_BUSY` 503 y libera cupo                                                                                       | S, I    |
| 37  | Contrato: `contracts:check` verde tras implementar; el cuerpo de `OrderCreateRequest` valida contra el esquema                                                                    | U       |
| 38  | Web: clave estable ante reintento; nueva al cambiar la huella; un solo envío con doble clic; sessionStorage limpio tras éxito                                                     | W       |
| 39  | Web: estados `ambiguo` → éxito con la misma clave; `QUOTE_CHANGED` con nuevo total y re-aceptación; `QUOTE_EXPIRED` recotiza; bloqueos; 409 clave; 429; 503; `ORDERS_UNAVAILABLE` | W       |
| 40  | Web: éxito solo con respuesta del servidor; `clearAfterOrder` solo con id confirmado y solo tras éxito; carrito conservado ante cualquier error                                   | W       |
| 41  | Web: confirmación muestra número, estado `pending`, resumen y texto honesto (sin aceptado/pagado); recarga reconstruye con `GET` + token o sesión                                 | W, P    |
| 42  | Web: sin insignia «Simulación» en el pedido `http`; sí en `mock` y en la tarjeta Neonet                                                                                           | W       |
| 43  | Playwright contra la API real: pickup invitado; delivery OWN; autenticado con dirección guardada (requiere sesión Supabase: no verificado hasta tenerla)                          | P       |
| 44  | Responsive (móvil/escritorio), tema claro/oscuro, es/en, a11y (axe, `aria-live`, foco, botones ≥ 44 px) en confirmación y estados de error                                        | P       |
| 45  | Seguimiento mock `/pedidos/[id]` sigue funcionando; `parity.test.ts` mock/contrato del `POST /v1/orders`                                                                          | W       |

## 12. Criterios de aceptación

1. Un pedido válido se persiste en una transacción con snapshots, historial `pending`, auditoría y (invitado) token; la API nunca acepta ni propaga importes del cliente.
2. Reintentos (7 escenarios) no duplican: una clave produce un único pedido; la repetición devuelve el mismo.
3. Cualquier diferencia respecto a la cotización aceptada => 409 `QUOTE_CHANGED` sin crear nada; token vencido/inválido y bloqueos con sus códigos; PedidosYa jamás se crea.
4. Acceso: solo dueño por JWT o token vigente; 404 idéntico; sin enumeración por número.
5. Sin pagos, entregas, notificaciones ni llamadas externas; pedido ≠ pagado ≠ aceptado.
6. Web: éxito solo tras la respuesta del servidor; carrito limpio solo tras éxito; confirmación honesta y recuperable tras recarga.
7. `pnpm contracts:check` y `pnpm check` verdes; int-spec contra PostgreSQL real ejecutada (sin ella, el estado no pasa de `API_IMPLEMENTED`).

## 13. Riesgos

| Riesgo                                                                                     | Mitigación                                                                                                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `lock_timeout` y espera concurrente retienen conexiones del pool                           | `ORDERS_DB_GATE` propio, `lock_timeout` 3 s, cola acotada; prueba mixta F17+F19+F20 pendiente                             |
| FK diferida y reclamación previa de la clave dependen de semántica de PostgreSQL           | int-spec #25/#28 con BD real obligatoria; no se marca `VERIFIED` sin ella                                                 |
| Token de invitado en `sessionStorage` se pierde (otra pestaña/dispositivo)                 | Aceptado (P49); F21 aporta `lookup`; el 200 idempotente rota el token solo si hay misma clave                             |
| Un token de invitado robado da acceso al pedido (dirección, nombre)                        | 256 bits, solo hash en BD, vigencia 14 días, revocable, 404 uniforme, throttle; sin correo ni coordenadas en la respuesta |
| Rotación del token en repetición de invitado revoca el anterior (otra pestaña lo perdería) | Solo ocurre con la clave secreta del intento; documentado; la clave está en `sessionStorage` de la misma pestaña          |
| Spam de pedidos de invitado (sin cuenta)                                                   | Throttle IP/actor, tope de `pending` por teléfono (P51), validación de teléfono GT; sin captcha en v1 (P55)               |
| Cupón sin límites de uso (P15)                                                             | Se registra lo aplicado; el modelo de canjes es de F15/P15                                                                |
| Comparación de líneas solo por totales + `linesHash`                                       | `linesHash` aditivo en el token (§10.2); sin él, un cambio compensado de líneas con igual total pasaría                   |
| `PEDIDOSYA` aparece en el CHECK de `delivery_provider` pero F20 no lo crea                 | Invariante en servicio + prueba #4; F29 define cómo se crea                                                               |
| Número de pedido revela volumen (secuencia visible)                                        | `START WITH 1001` y P53 (prefijo/ofuscación); no es credencial                                                            |
| Tablas de F21/F22 asumen el catálogo de estados                                            | Catálogo en CHECK cerrado aquí; ampliarlo es una migración aditiva con ADR                                                |
| Concurrencia sobre el tope de `pending`                                                    | Aceptado (no atómico); cota práctica por throttle                                                                         |
| Datos personales sin política de retención                                                 | P56; no se copian a auditoría ni logs                                                                                     |
| Prueba de `createMany` por lote con adaptador `pg` y claves UUID generadas en la app       | int-spec #20/#23; la API genera UUID (`randomUUID`) para evitar `RETURNING` por hijo                                      |

## 14. Reparto

- **database-engineer**: migración `0018_orders` (DDL de §6, triggers, RLS/REVOKE, comentarios, reversión), `schema.prisma` (8 modelos; `order_number` `BigInt @unique @default(autoincrement())` o equivalente a identity; FK diferida documentada porque Prisma no la modela), `test/orders-migration.int-spec.ts` (CHECKs, triggers append-only/inmutables, secuencia, FK diferida, UNIQUE de claves, `ON DELETE`), ADR de la evolución del DBML en `docs/database/`.
- **api-engineer**: `src/orders/` (`orders.module.ts`, `orders.controller.ts`, `orders.service.ts` orquestación, `order-quote-guard.ts` verificación y comparación del token, `order-idempotency.ts`, `orders.repository.ts` transacción y lecturas, `order-snapshot.reader.ts`, `order-access-token.ts`, `order-mapper.ts`, `order-contact.policy.ts`, `order-number.ts`, `orders-errors.ts` (`ORDERS_DB_GATE`, `ordersBusy`, `ordersUnavailable`), `order-events.publisher.ts` (puerto + no-op), `dto/`), cambios aditivos F19 (§10), `AppThrottlerGuard` (`CREATE_ORDER_THROTTLE`, `ORDER_READ_THROTTLE`), `PUBLIC_5XX_CODES`, `splitGateBudget`, pruebas S/E/I.
- **web-engineer**: archivos de §9, mock con paridad, `parity.test.ts`, pruebas W/P, i18n, `docs/ui/mock-data-strategy.md`.
- **security-reviewer** (solo lectura) tras la API: idempotencia, token de invitado, IDOR/404 uniforme, PII, `OptionalAuth`, fail-closed. **qa-engineer** para la matriz. **performance-reviewer**: presupuesto de consultas y gate.
