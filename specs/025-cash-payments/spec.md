# F24 — Gestión de pagos en EFECTIVO

**Rama**: `feature/F24-cash-payments` (desde `develop` 64cf465, que incluye F20–F23) · **Dueño**: A · **Prioridad**: P0 · **Tipo**: API + WEB (pago del cliente visible + registro de cobro en backoffice)
**Dependencias**: F20 (pedidos y creación transaccional), F22 (tablero, alcance por sucursal, `OrderPaymentReadPort`), F03/F02 (RBAC granular, aal2) · **Integración**: F21 (seguimiento), F23 (recibo) · **Integración posterior**: F26 (reembolsos), F28 (cobro del motorista propio), F29 (PedidosYa, `BLOCKED_EXTERNAL`), F34 (reportes de caja) · **Decisiones**: `docs/adr/0030-pagos-en-efectivo.md` · **Pendientes**: P82–P91 en `docs/business-rules/decisiones-pendientes.md`
**Estado de integración inicial: `CONTRACT_DEFINED`** (operaciones `getAdminOrderPayment`, `registerAdminOrderCashPayment`, `listAdminOrderPaymentHistory` y esquemas `AdminOrderPayment*`, `AdminCashPayment*`, `PaymentReception`, `OrderPaymentStatus`, `PaymentMethodCode` en `openapi.yaml`, tag `admin-payments`; ampliación de `OrderDetailPayment`, `OrderTracking.payment`, `OrderReceiptPayment`, `AdminOrderSummary.paymentStatus` y `AdminOrderPaymentSummary`; sin migración aplicada, API ni web). `pnpm contracts:generate` ejecutado; `pnpm contracts:check` queda rojo SOLO por esas 3 operaciones sin implementar. Estado de la feature en el backlog: no se edita aquí (ver «Cambio propuesto al backlog maestro»). PedidosYa y Neonet: `BLOCKED_EXTERNAL`/fuera de alcance.

> **Cambio de requerimientos (prioridad sobre backlog, prototipos y mocks)**: F24 es SOLO EFECTIVO. Quedan PROHIBIDOS en esta feature: transferencia bancaria (opción, cuentas, comprobantes, referencias, conciliación), tarjetas/Neonet y reembolsos. `bank_transfer` se retira del contrato, el checkout, los mocks, los textos y el puerto provisional de F22 (`ProvisionalPaymentRule`, P74). La ficha F24 del backlog («Efectivo y transferencias bancarias») queda superada por esta spec.

## 1. Alcance y fuera de alcance

Dentro:

- **Cliente (lectura)**: el pedido nace con un pago `CASH` en `PENDING`; `getOrder` (F20), `getOrderTracking` (F21) y `getOrderReceipt` (F23) muestran método `CASH` y estado `PENDING|PAID` reales, y el recibo, con `PAID`, el importe aplicado, el efectivo entregado y el cambio. Nunca la identidad del empleado, el historial ni la auditoría.
- **Backoffice**: `GET /v1/admin/orders/{id}/payment`, `POST /v1/admin/orders/{id}/payment/cash` (registrar la recepción del efectivo) y `GET /v1/admin/orders/{id}/payment/history`; `AdminOrderSummary.paymentStatus` y `AdminOrderDetail.payment` (resumen); panel de pago en el detalle de F22 y modal «Registrar pago en efectivo».
- **Datos**: migración 0019 aditiva (`payment_methods`, `payments`, `payment_events`, triggers, seed solo `cash`, backfill de pedidos existentes cash/NULL).
- **Integración**: F20 inserta el pago pendiente en la MISMA transacción de creación; F22 sustituye `ProvisionalPaymentRule` por una lectura real (`payment_review` ⇔ pago `PAID` y pedido `rejected|cancelled`).
- **Preparación F28**: el modelo y el contrato dejan lugar (aditivo) al cobro del motorista propio sin implementarlo.

Fuera: transferencia bancaria y cualquier comprobante o conciliación; tarjetas, Neonet, PCI (F25); reembolsos, devoluciones y ajustes monetarios (F26: aquí solo el aviso derivado «posible devolución pendiente»); anulación o corrección de un pago registrado (`VOIDED`; P82); pagos parciales, divididos, propinas y vuelto en especie; rendición/cierre de caja y arqueo (F28/F26/F34); cobro del motorista (F28); cobro del proveedor PedidosYa (F29); facturación FEL/SAT (sin feature); notificaciones (F31); cambios en las transiciones de F22 más allá de `payment_review`; WebSockets, SSE, Redis, colas.

Reutiliza SIN cambiar su comportamiento: `OrdersModule` y el gate `ORDERS_DB_GATE` (`rejectIfWaiting` en lecturas, errores `ORDERS_BUSY`), `@RequireStaff` (aal2, permiso por operación, `grants` por sucursal), `AuditService.record(tx, …)`, el 404 uniforme `ORDER_NOT_FOUND`, `CheckoutMoney`, `Idempotency-Key` y su patrón de hash de F20, el filtro global de errores (`current` como cuerpo extra, igual que F22), y `toPublicStatus` de F21.

## 2. Modelo de datos y migración 0019

Reutiliza el DBML (`app.payment_methods`, `app.payments`; no se crea una segunda tabla de pagos) y lo amplía con lo mínimo. Ninguna de las dos existe aún en las migraciones (la última es `0018_orders`). `refunds` NO se crea (F26). Migración **aditiva**, sin DROP/TRUNCATE ni cambios de datos de `orders`. Numeración: la siguiente libre tras `git fetch` y revisar `origin/develop` (provisional `0019_cash_payments`).

### 2.1 Diseño (resumen)

- **UNA fila de pago por pedido** (`UNIQUE(order_id)`): pago completo único, sin parciales ni divididos (P87; ampliarlo = relajar el UNIQUE con migración + ADR).
- **`payments.amount` = `orders.total`** (inmutable por trigger de 0018; el trigger de `payments` lo verifica al insertar). El INGRESO aplicado es `amount` (deuda). El efectivo entregado y el cambio son datos de recepción; el cambio NO es ingreso.
- **`status` ∈ `pending|paid`** (CHECK). Nace `pending` (F20/backfill). `pending → paid` UNA vez; `paid` no se edita ni se borra (trigger). `voided` NO existe (P82).
- **Idempotencia persistente por pedido** en las columnas `confirm_key_hash` y `confirm_request_hash` de la misma fila (alcance = el pedido porque hay un solo pago): solo el hash sha256 de la clave y del cuerpo canónico; nunca la clave en claro. La columna del DBML `idempotency_key` queda RESERVADA (siempre `NULL` en F24; F25 podría usarla para una pasarela).
- **`branch_id` NOT NULL** (copia inmutable de `orders.branch_id` para alcance y reportes sin join). `received_by_staff_id` sin FK (criterio de `audit_events`/`order_status_history`: el historial sobrevive a un empleado).
- **`collector_type`** (`STAFF`; F28 añade `RIDER` con su propia columna de forma aditiva) y **`collection_context`** (`BRANCH|OWN_DELIVERY`, derivado por el servidor del pedido) dejan el modelo listo para F28 sin implementarlo.
- **`payment_events`** solo-añadir (`created`, `cash_received`) con `order_id` desnormalizado para leer el historial por pedido con alcance en una sentencia.

### 2.2 DDL propuesto (database-engineer implementa; aquí la referencia completa)

```sql
-- 0019 · F24 pagos en efectivo (specs/025-cash-payments §2, ADR-0030). CREA app.payment_methods, app.payments y
-- app.payment_events (el DBML define las dos primeras; la tercera es nueva). Aditiva: solo CREATE + seed + backfill.
-- No borra ni modifica filas de app.orders. Relanzable (IF NOT EXISTS, CREATE OR REPLACE, triggers guardados por catálogo).
-- Guarda inicial (como 0018): si alguna de las 3 tablas ya existe con otra definición (falta una columna o restricción
-- esperada), RAISE EXCEPTION y no se modifica nada. Requiere 0003 (branches) y 0018 (orders).
-- Reversión manual (destructiva; solo sin cobros reales que conservar; aprobación humana), en este orden:
--   DROP TABLE app.payment_events, app.payments, app.payment_methods;
--   DROP FUNCTION app.payment_events_append_only(), app.payments_guard(), app.orders_payment_pref_cash_only();
--   (el trigger orders_payment_pref_cash_only sobre app.orders cae con DROP TRIGGER; ver abajo)

CREATE TABLE IF NOT EXISTS "app"."payment_methods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_methods_code_key" UNIQUE ("code"),
    CONSTRAINT "payment_methods_chk" CHECK ("code" ~ '^[a-z][a-z_]{1,31}$' AND btrim("name") <> '')
);
-- Seed: SOLO efectivo. No se siembran bank_transfer ni card.
INSERT INTO "app"."payment_methods" ("code", "name", "active") VALUES ('cash', 'Efectivo', true)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE IF NOT EXISTS "app"."payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "method_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,                       -- añadida: copia inmutable de orders.branch_id
    "amount" DECIMAL(12,2) NOT NULL,                 -- = orders.total (deuda; es el ingreso aplicado)
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT,                                 -- DBML; NULL en efectivo (F25)
    "provider_reference" TEXT,                       -- DBML; NULL en efectivo (F25)
    "idempotency_key" TEXT,                          -- DBML; RESERVADA, NULL en F24 (la clave se guarda solo como hash)
    "tendered_amount" DECIMAL(12,2),                 -- añadida: efectivo entregado
    "change_amount" DECIMAL(12,2),                   -- añadida: tendered - amount (informativo, NO ingreso)
    "collector_type" TEXT,                           -- añadida: STAFF (F28 añadirá RIDER)
    "received_by_staff_id" UUID,                     -- añadida: staff_users.id SIN FK (criterio audit_events)
    "collection_context" TEXT,                       -- añadida: BRANCH | OWN_DELIVERY (derivado del pedido)
    "received_at" TIMESTAMPTZ(6),                    -- añadida: reloj del servidor
    "confirm_key_hash" BYTEA,                        -- añadida: sha256(Idempotency-Key)
    "confirm_request_hash" BYTEA,                    -- añadida: sha256(cuerpo canónico)
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_order_key" UNIQUE ("order_id"),
    CONSTRAINT "payments_idempotency_key_key" UNIQUE ("idempotency_key"),
    CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id")
        REFERENCES "app"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_method_id_fkey" FOREIGN KEY ("method_id")
        REFERENCES "app"."payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_branch_id_fkey" FOREIGN KEY ("branch_id")
        REFERENCES "app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_status_chk" CHECK ("status" IN ('pending', 'paid')),
    CONSTRAINT "payments_amount_chk" CHECK ("amount" >= 0),
    -- F24 es solo efectivo: sin proveedor, referencia ni clave en claro (F25 relajará esto con su propia migración).
    CONSTRAINT "payments_cash_only_chk" CHECK (
        "provider" IS NULL AND "provider_reference" IS NULL AND "idempotency_key" IS NULL
    ),
    -- Coherencia por estado: pending => sin recepción; paid => recepción completa y consistente.
    CONSTRAINT "payments_reception_chk" CHECK (
        ("status" = 'pending'
            AND "tendered_amount" IS NULL AND "change_amount" IS NULL AND "collector_type" IS NULL
            AND "received_by_staff_id" IS NULL AND "collection_context" IS NULL AND "received_at" IS NULL
            AND "confirm_key_hash" IS NULL AND "confirm_request_hash" IS NULL)
        OR ("status" = 'paid'
            AND "amount" > 0
            AND "tendered_amount" IS NOT NULL AND "tendered_amount" >= "amount"
            AND "change_amount" IS NOT NULL AND "change_amount" = "tendered_amount" - "amount"
            AND "collector_type" = 'STAFF' AND "received_by_staff_id" IS NOT NULL
            AND "collection_context" IN ('BRANCH', 'OWN_DELIVERY') AND "received_at" IS NOT NULL
            AND octet_length("confirm_key_hash") = 32 AND octet_length("confirm_request_hash") = 32)
    )
);
-- Índices: PK y UNIQUE(order_id) sirven toda lectura por pedido. NO se añaden índices por sucursal/estado
-- (no hay consulta que los use en F24; los reportes de caja de F34 los pedirán con EXPLAIN real).
CREATE INDEX IF NOT EXISTS "payments_method_idx" ON "app"."payments" ("method_id");   -- FK sin seq scan
CREATE INDEX IF NOT EXISTS "payments_branch_idx" ON "app"."payments" ("branch_id");   -- FK sin seq scan

CREATE TABLE IF NOT EXISTS "app"."payment_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,                        -- desnormalizado: historial por pedido con alcance en 1 sentencia
    "event_type" TEXT NOT NULL,
    "actor_staff_id" UUID,                           -- staff_users.id SIN FK; NULL = sistema/cliente
    "amount" DECIMAL(12,2) NOT NULL,                 -- deuda en ese momento
    "tendered_amount" DECIMAL(12,2),
    "change_amount" DECIMAL(12,2),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id")
        REFERENCES "app"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payment_events_order_id_fkey" FOREIGN KEY ("order_id")
        REFERENCES "app"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payment_events_chk" CHECK (
        ("event_type" = 'created' AND "actor_staff_id" IS NULL
            AND "tendered_amount" IS NULL AND "change_amount" IS NULL)
        OR ("event_type" = 'cash_received' AND "actor_staff_id" IS NOT NULL
            AND "tendered_amount" IS NOT NULL AND "change_amount" IS NOT NULL
            AND "tendered_amount" - "change_amount" = "amount")
    )
);
CREATE INDEX IF NOT EXISTS "payment_events_order_idx" ON "app"."payment_events" ("order_id", "occurred_at", "id");
CREATE INDEX IF NOT EXISTS "payment_events_payment_idx" ON "app"."payment_events" ("payment_id");

-- Triggers (patrón 0018; relanzable por CREATE OR REPLACE + guarda por catálogo).
CREATE OR REPLACE FUNCTION "app"."payments_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.allow_order_cleanup', true) = 'on' THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'app.payments no admite DELETE' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'INSERT' THEN
        -- Un pago nace pending, con el total y la sucursal del pedido.
        IF NEW.status <> 'pending' OR NOT EXISTS (
            SELECT 1 FROM app.orders o WHERE o.id = NEW.order_id AND o.total = NEW.amount AND o.branch_id = NEW.branch_id
        ) THEN
            RAISE EXCEPTION 'app.payments: un pago nace pending con el total y la sucursal del pedido'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    -- UPDATE: un pago confirmado NO se edita; la identidad nunca cambia; solo pending -> paid.
    IF OLD.status = 'paid' THEN
        RAISE EXCEPTION 'app.payments: un pago confirmado es inmutable' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.method_id IS DISTINCT FROM OLD.method_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'app.payments: id, pedido, metodo, sucursal, importe y created_at son inmutables'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "app"."payment_events_append_only"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_order_cleanup', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'app.payment_events es solo-anadir (% rechazado)', TG_OP USING ERRCODE = 'insufficient_privilege';
END; $$;

-- Preferencia de pago de pedidos NUEVOS: solo 'cash'. El CHECK orders_payment_pref_chk de 0018 se CONSERVA tal cual
-- (un CHECK NOT VALID más estricto se re-evalúa en cada UPDATE y rompería las transiciones de F22 sobre filas
-- históricas bank_transfer). Un trigger solo de INSERT lo hace cumplir sin tocar las filas existentes (P89).
CREATE OR REPLACE FUNCTION "app"."orders_payment_pref_cash_only"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
    IF NEW.payment_method_preference IS NOT NULL AND NEW.payment_method_preference <> 'cash' THEN
        RAISE EXCEPTION 'app.orders: solo se admite pago en efectivo (preferencia %)', NEW.payment_method_preference
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END; $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payments_guard' AND tgrelid = 'app.payments'::regclass) THEN
        CREATE TRIGGER "payments_guard" BEFORE INSERT OR UPDATE OR DELETE ON "app"."payments"
            FOR EACH ROW EXECUTE FUNCTION "app"."payments_guard"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_events_append_only'
                   AND tgrelid = 'app.payment_events'::regclass) THEN
        CREATE TRIGGER "payment_events_append_only" BEFORE UPDATE OR DELETE ON "app"."payment_events"
            FOR EACH ROW EXECUTE FUNCTION "app"."payment_events_append_only"();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_payment_pref_cash_only'
                   AND tgrelid = 'app.orders'::regclass) THEN
        CREATE TRIGGER "orders_payment_pref_cash_only" BEFORE INSERT ON "app"."orders"
            FOR EACH ROW EXECUTE FUNCTION "app"."orders_payment_pref_cash_only"();
    END IF;
END $$;

-- Backfill ADITIVO de pedidos existentes (solo preferencia cash o NULL; los bank_transfer históricos NO se tocan).
-- Un pago pending por pedido, por el total, con su evento 'created'. Idempotente (ON CONFLICT). No marca nada pagado:
-- un pedido ya entregado queda PENDING hasta que el personal registre el cobro (P88/P90).
WITH ins AS (
    INSERT INTO "app"."payments" ("order_id", "method_id", "branch_id", "amount")
    SELECT o."id", m."id", o."branch_id", o."total"
      FROM "app"."orders" o JOIN "app"."payment_methods" m ON m."code" = 'cash'
     WHERE o."payment_method_preference" IS NULL OR o."payment_method_preference" = 'cash'
    ON CONFLICT ("order_id") DO NOTHING
    RETURNING "id", "order_id", "amount"
)
INSERT INTO "app"."payment_events" ("payment_id", "order_id", "event_type", "amount")
SELECT "id", "order_id", 'created', "amount" FROM ins;

-- Privilegios: igual que 0018 (RLS sin políticas + REVOKE a PUBLIC/anon/authenticated, incl. funciones). Solo vía API.
ALTER TABLE "app"."payment_methods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."payment_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "app"."payment_methods", "app"."payments", "app"."payment_events" FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."payments_guard"(), "app"."payment_events_append_only"(),
                       "app"."orders_payment_pref_cash_only"() FROM PUBLIC;
-- (+ bloque DO $$ que repite el REVOKE para los roles anon y authenticated si existen, como 0018 §11)
COMMENT ON TABLE "app"."payments" IS 'F24. UN pago completo en efectivo por pedido (UNIQUE order_id). pending -> paid una vez; paid es inmutable (trigger). amount = orders.total = ingreso; el cambio NO es ingreso.';
COMMENT ON TABLE "app"."payment_events" IS 'F24. Historial SOLO-AÑADIR del pago (created, cash_received).';
```

Notas: la migración modifica `app.orders` solo añadiendo un trigger (`BEFORE INSERT`); no cambia columnas ni filas. Las pruebas de migración (`migration-0019.int-spec.ts`, patrón de `migration-0018.int-spec.ts`) cubren: relanzable, guarda, CHECK `payments_reception_chk` (paid sin recepción ⇒ rechazado), trigger de inmutabilidad (`42501`), `UNIQUE(order_id)`, `payment_events` solo-añadir, trigger cash-only (`23514` con `bank_transfer`, UPDATE de filas legacy sí funciona), backfill idempotente y que los `bank_transfer` no reciben pago.

### 2.3 `payment_method_preference` y filas legacy (decisión P88/P89)

- El CHECK `orders_payment_pref_chk` de 0018 (`cash|bank_transfer`) NO se modifica (cambiarlo exige DROP CONSTRAINT: evitable y arriesgado) y NO se añade un CHECK `NOT VALID` más estricto (se re-evalúa en cada UPDATE y bloquearía las transiciones de F22 en filas legacy). Se cumple en INSERT con el trigger `orders_payment_pref_cash_only` y en la API (400). Una migración de limpieza FUTURA podrá estrechar el CHECK cuando ya no existan filas `bank_transfer`.
- Filas legacy `bank_transfer` (solo posibles en bases de desarrollo: F20 aún no está en producción): NO reciben pago en el backfill. La API las trata así: lecturas públicas y de personal muestran `payment{method: CASH, status: PENDING}` y `paymentMethodPreference: null`; el registro de cobro responde 422 `PAYMENT_NOT_COLLECTABLE` (`LEGACY_PAYMENT_METHOD`). Recomendación: limpiar esas filas en desarrollo; no hay producción afectada.

## 3. Rutas finales (convenciones reales de F22) y reconciliación con el backlog

| Operación                   | Ruta                                             | Acceso                              | `operationId`                                     | Tag              |
| --------------------------- | ------------------------------------------------ | ----------------------------------- | ------------------------------------------------- | ---------------- |
| Pago del pedido (personal)  | `GET /v1/admin/orders/{id}/payment`              | `payments.read` + aal2, sucursal    | `getAdminOrderPayment`                            | `admin-payments` |
| Registrar efectivo recibido | `POST /v1/admin/orders/{id}/payment/cash`        | `payments.confirm` + aal2, sucursal | `registerAdminOrderCashPayment`                   | `admin-payments` |
| Historial del pago          | `GET /v1/admin/orders/{id}/payment/history`      | `payments.read` + aal2, sucursal    | `listAdminOrderPaymentHistory`                    | `admin-payments` |
| Detalle/seguimiento/recibo  | rutas de F20/F21/F23 (ampliadas, sin ruta nueva) | dueño (JWT) o `X-Order-Token`       | `getOrder`, `getOrderTracking`, `getOrderReceipt` | `orders`         |

Adaptaciones respecto del encargo y del backlog (sin duplicar rutas):

- Prefijo `/v1/admin/orders/{id}/…` y parámetro `AdminOrderId` como los seis comandos de F22 (el pago es un sub-recurso del pedido, con el mismo anti-IDOR). Se usa `payment` en SINGULAR (hay exactamente un pago por pedido): el encargo proponía `…/payments/history`; queda `…/payment/history`.
- El comando se llama `…/payment/cash` (hay un solo método) y deja espacio a otras acciones del mismo sub-recurso. `201` en el primer registro y `200` + `Idempotent-Replayed: true` en la repetición (igual que `createOrder`).
- NO se crean `GET /v1/payment-methods`, `GET /v1/admin/payments`, `GET /v1/orders/:id/payments`, `POST /v1/admin/payments/:id/confirm-transfer` ni `confirm-cash` (rutas del backlog): el único método es efectivo (no hay catálogo que elegir), el listado de pagos pendientes es el tablero de F22 filtrado por `paymentStatus` (futuro) y el cliente ya ve su pago en `getOrder`/`getOrderTracking`/`getOrderReceipt`. `POST /v1/payments/card` (borrador `MOCK_ONLY`) no es de F24.
- Sin `payment-sessions`, webhooks ni referencias bancarias (F25/prohibido).

## 4. Contrato (fuente: `openapi.yaml`)

### 4.1 Esquemas públicos (cliente: detalle, seguimiento y recibo)

- `PaymentMethodCode` = `CASH`. `OrderPaymentStatus` = `PENDING | PAID` (reemplaza a `NOT_STARTED`; los clientes deben tolerar valores futuros).
- `OrderDetailPayment {method, status, paidAt|null}` (reemplaza a `{methodPreference, status: NOT_STARTED}`) en `OrderDetail` (también dentro de `OrderCreated`) y como `OrderTracking.payment` (NUEVO, requerido). F20 aún no está en producción: el cambio incompatible se acepta SIN `/v2`; la web y la API de F20/F21/F23 se ajustan en el slice F24 (sección 11).
- `OrderReceiptPayment {method, status, paidAt, amountPaid|null, tendered|null, change|null}` en `OrderReceipt.payment`. Con `PAID`: importe pagado (total aplicado), efectivo entregado y cambio; con `PENDING`: `null`. Sin empleado, historial ni auditoría.
- `OrderPaymentPreference` = `cash` (solo). `bank_transfer`, `card` y cualquier otro valor en `OrderCreateRequest.paymentMethodPreference` => 400. `PAYMENT_METHOD_UNAVAILABLE` (422 de F20) queda RETIRADO. Las respuestas con `paymentMethodPreference` (`AdminOrderSummary`, `MyOrderSummary`) devuelven `cash` o `null` (un `bank_transfer` histórico se lee como `null`).
- Vocabulario público (web): «Pago en efectivo: Pendiente / Pagado». El pago NO entra en `steps` ni `events` del seguimiento (el timeline es solo operativo).

### 4.2 Esquemas de personal

- `AdminOrderPaymentSummary {method, status, amountDue, outstanding, paidAt|null, possibleRefundReview, registration{allowed, blockedReason|null}}`: va en `AdminOrderDetail.payment` (reemplaza a `OrderDetailPayment`; sin sentencia adicional) y como base de `AdminOrderPayment`. `AdminOrderSummary` gana `paymentStatus` (requerido) para la insignia del tablero.
- `AdminOrderPayment` = resumen + `orderId, displayNumber, orderStatus, branchId, fulfillmentType, deliveryProvider, currency, collectionContext (BRANCH|OWN_DELIVERY|null), reception|null, generatedAt`. `PaymentReception {amountApplied, tendered, change, receivedAt, collectorType (STAFF), collectorName|null, branchId, context}`.
- `AdminCashPaymentRequest {tendered, receivedConfirmed}` (`additionalProperties: false`). `AdminCashPaymentResult {payment, replayed, appliedByMe}`. `AdminPaymentConflict` (409 con `current: AdminOrderPayment`). `AdminPaymentHistory {orderId, displayNumber, items: AdminPaymentEvent[], generatedAt}`; `AdminPaymentEvent {seq, type (CREATED|CASH_RECEIVED), at, actorName|null, amountDue, tendered|null, change|null}`.
- `AdminOrderPendingAction.payment_review` cambia de significado: ahora es un hecho (`PAID` + pedido `rejected|cancelled` ⇒ posible devolución pendiente), ya no una heurística por preferencia (P74 cerrada).

### 4.3 Errores

| HTTP | `code`                                   | Cuándo                                                                                                                              |
| ---- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 400  | (validación) / `IDEMPOTENCY_KEY_INVALID` | UUID inválido, campos desconocidos o `__proto__`, `Idempotency-Key` ausente o fuera de formato                                      |
| 400  | `PAYMENT_AMOUNT_INVALID`                 | `tendered` no decimal, negativo, cero, con más de 2 decimales (sin redondeo silencioso), notación científica o separador de miles   |
| 400  | `PAYMENT_CONFIRMATION_REQUIRED`          | `receivedConfirmed` ausente o `false`                                                                                               |
| 401  | —                                        | JWT ausente, inválido o expirado                                                                                                    |
| 403  | `MFA_REQUIRED` / (sin código)            | sesión aal1; falta `payments.read`/`payments.confirm`                                                                               |
| 403  | `PAYMENT_ACTION_FORBIDDEN`               | ve el pedido (`orders.read`) pero NO tiene `payments.confirm` en SU sucursal                                                        |
| 404  | `ORDER_NOT_FOUND`                        | inexistente o fuera del alcance: MISMO cuerpo, cabeceras y número de sentencias (anti-IDOR)                                         |
| 409  | `PAYMENT_ALREADY_REGISTERED`             | ya `PAID` por otra clave/cuerpo; trae `current` (`AdminOrderPayment`)                                                               |
| 409  | `ORDER_NOT_PAYABLE`                      | pedido `rejected`/`cancelled` (no se cobra); trae `current`                                                                         |
| 409  | `IDEMPOTENCY_KEY_REUSED`                 | misma clave con otro cuerpo canónico                                                                                                |
| 422  | `CASH_AMOUNT_INSUFFICIENT`               | `tendered` < total del pedido                                                                                                       |
| 422  | `CASH_TENDERED_TOO_LARGE`                | `tendered` > tope de seguridad (Q 5,000.00; P83)                                                                                    |
| 422  | `PAYMENT_NOT_COLLECTABLE`                | `violations[].code`: `PROVIDER_BLOCKED_EXTERNAL` (PedidosYa), `LEGACY_PAYMENT_METHOD` (histórico sin pago `CASH`), `AMOUNT_ZERO`    |
| 429  | `RATE_LIMITED`                           | throttle propio (con `Retry-After`)                                                                                                 |
| 503  | `ORDERS_BUSY`                            | gate saturado, timeout o fallo reintentable (código ya público de F20; **sin códigos 5xx nuevos**); se reintenta con la MISMA clave |

## 5. Reglas de negocio

1. **Pedido ≠ pagado ≠ aceptado ≠ entregado.** Registrar el pago NO cambia `orders.status`; ningún comando de F22 (aceptar, preparar, listo, completar, cancelar, rechazar) ni F28 (asignar/iniciar/completar entrega) marca `PAID`. Un PICKUP puede completarse con pago `PENDING` (P84: sin regla de «pagar antes de entregar»; la web avisa «pedido entregado con pago pendiente», no bloquea) y un pedido puede cobrarse estando en cualquier estado salvo `rejected|cancelled`.
2. **Estados**: solo `PENDING` y `PAID`. Un pago confirmado no se edita (trigger), no vuelve a `PENDING` y no hay anulación (P82; ni siquiera si el pedido se cancela después).
3. **Pago completo único** por pedido; sin parciales ni divididos (P87).
4. **Importes**: cadenas decimales exactas (`"185.00"`), nunca `number`. Se parsea `tendered` con regex `^[0-9]{1,9}(\.[0-9]{1,2})?$` y se convierte a centavos enteros; más de 2 decimales ⇒ 400 (sin redondeo). `tendered > 0`; `tendered ≥ amount` o 422 `CASH_AMOUNT_INSUFFICIENT`; `tendered ≤ Q 5,000.00` o 422 `CASH_TENDERED_TOO_LARGE` (tope seguro propuesto: 25 billetes de Q200; constante del servidor, P83). `change = tendered − amount` (centavos enteros, solo servidor). El INGRESO aplicado es `amount` (la deuda), nunca `tendered`; el total del pedido no cambia. El cliente nunca envía total, estado, empleado, sucursal, cambio, fecha ni moneda (GTQ fija). Ejemplos: total 185.00 con 200.00 ⇒ cambio 15.00, ingreso 185.00; total 185.00 con 185.00 ⇒ cambio 0.00; 184.99 ⇒ 422; 200.001 ⇒ 400; 0 ⇒ 400; −5 ⇒ 400.
5. **Creación (F20)**: en la MISMA transacción de `createOrder` se inserta `payments(order_id, method=cash, branch_id, amount=orders.total, status='pending')` + evento `created` (una sola sentencia con CTE `WITH p AS (INSERT … RETURNING) INSERT INTO payment_events …`, leyendo `orders.total` y el método `cash` dentro de la sentencia). Sin efectivo real ni movimientos de caja. Un reintento idempotente de F20 (ruta `replay`) retorna ANTES de insertar y el `UNIQUE(order_id)` lo garantiza además. Si el método `cash` no existe (seed ausente) la creación revierte con `503 ORDERS_UNAVAILABLE` (fail-closed).
6. **Registro de cobro**: `payments.confirm` + aal2 + alcance de la sucursal del pedido; actor = personal del JWT; sucursal = la del pedido; `received_at` = reloj del servidor (`now()` de la transacción); `collection_context` = `BRANCH` (PICKUP) u `OWN_DELIVERY` (DELIVERY `OWN`), derivado del pedido. Pedido `rejected|cancelled` ⇒ 409 `ORDER_NOT_PAYABLE`. PedidosYa ⇒ 422 `PAYMENT_NOT_COLLECTABLE` (P86).
7. **Cancelado/rechazado SIN cobro**: no se inventa cobro ni devolución (el pago queda `PENDING`; `possibleRefundReview=false`). **CON cobro**: el pago sigue `PAID`; `possibleRefundReview=true` en el detalle y `pendingActions: ['payment_review']` en la respuesta de `reject`/`cancel`; la devolución real es F26 (no se crea ningún reembolso).
8. **PICKUP**: cobra el empleado en mostrador. **DELIVERY `OWN`**: el mismo endpoint, por quien tenga `payments.confirm` (típicamente quien despacha). El motorista (F28) cobrará con su propio flujo aditivo (§9).
9. **PedidosYa**: no se asume cobro en efectivo del proveedor (`BLOCKED_EXTERNAL`, F29). Comportamiento seguro: el pago nace `PENDING` como cualquier otro (F20 hoy no deja crear pedidos PedidosYa; los históricos existen), `registration.allowed=false` con `PROVIDER_BLOCKED_EXTERNAL`, `collectionContext=null` y el registro responde 422. F29 decide cómo se modela el cobro del proveedor.

## 6. Autorización, anti-IDOR y auditoría

1. Todas las rutas con `@RequireStaff('<permiso>')` por operación (nunca a nivel de clase): `payments.read` (GET) y `payments.confirm` (POST); aal2 obligatorio (aal1 ⇒ 403 `MFA_REQUIRED`). No se aceptan `staffId`, `branchId`, `collectorId` ni fecha de la entrada.
2. **Alcance por sucursal EN SQL**: la lectura del pedido filtra por las sucursales cubiertas por el permiso (`WHERE o.id = $1 AND o.branch_id = ANY($scope)` o global). Inexistente y fuera de alcance ⇒ mismo 404 `ORDER_NOT_FOUND` con una sola sentencia en ambos casos (prueba de igualdad de cuerpo, cabeceras y conteo). Para el POST la visibilidad es `orders.read` en la sucursal del pedido (mismo criterio que F22); con visibilidad pero sin `payments.confirm` allí ⇒ 403 `PAYMENT_ACTION_FORBIDDEN`.
3. `payments.read` ≠ `payments.confirm` ≠ `payments.refund` (F26): quien solo lee no ve el botón (`registration.blockedReason: NO_PERMISSION`) y recibe 403 al forzarlo. No se cambia RBAC: hoy solo `admin` (catálogo completo) los tiene; asignarlos a gerente/cajero es administración F03 (P91).
4. **Auditoría** (`audit_events`, misma transacción): `payment.cash_received` con `actor_id` = personal, `branch_id` del pedido, `entity_type='payment'`, `entity_id=payments.id`, `old_values {status:'pending'}`, `new_values {orderId, status:'paid', amount, tendered, change, context}`. Sin PII del cliente, sin clave ni hash. El evento `payment_events` y la auditoría se escriben en la MISMA transacción que el UPDATE: si cualquiera falla, revierte todo (prueba de rollback). Las lecturas no se auditan (mismo criterio que F22/P70).
5. **PII y logs**: el personal ve nombre del empleado y del cliente solo donde ya lo ve F22; el público NUNCA ve empleado/historial/auditoría (barrido de claves en pruebas). Logs: solo `requestId`, `orderId`, `paymentId`, código y resultado; sin importes entregados, claves ni hashes.
6. Cabeceras en TODA respuesta: `Cache-Control: private, no-store` (el middleware de `/v1/admin` ya lo fija; las rutas públicas ampliadas conservan `Vary: Authorization, X-Order-Token`). Sin `ETag`.
7. Throttles propios (contadores independientes de F20–F23; por instancia, riesgo conocido de F21): `ADMIN_PAYMENTS_READ_THROTTLE` 120/min por IP y 60/min por actor; `ADMIN_PAYMENTS_COMMAND_THROTTLE` 60/min por IP y 30/min por actor (cobrar es un acto manual; 30/min por persona sobra y frena automatización). 429 con `Retry-After`.
8. Ninguna ruta llama a PedidosYa/Neonet ni a otro servicio externo; sin Redis ni colas.

## 7. Idempotencia y concurrencia

**Clave**: cabecera `Idempotency-Key` OBLIGATORIA, `^[A-Za-z0-9_-]{22,128}$` (como F20; ausente/mal formada ⇒ 400 `IDEMPOTENCY_KEY_INVALID`). `key_hash = sha256(key)`; `request_hash = sha256('cash-receipt\0' + orderId + '\0' + tendered en centavos)` (el cuerpo normalizado: `100` y `100.00` son el mismo; `receivedConfirmed` siempre `true`). Alcance: el pedido (un pago por pedido; la misma clave en otro pedido es independiente). Se guardan solo ambos hashes, en la fila `payments` y en la MISMA transacción que la recepción; vigencia = la vida de la fila (no hay TTL que lo rompa: un reintento tardío sigue respondiendo lo mismo).

**Algoritmo** (transacción corta; `SET LOCAL lock_timeout`; gate `ORDERS_DB_GATE` de escritura):

```
1  SELECT pedido + sucursal + pago + empleado que cobró (LEFT JOIN payments, staff_users) con alcance en SQL   -- 0 filas => 404
   en memoria: permiso de confirmación en la sucursal => si no, 403 PAYMENT_ACTION_FORBIDDEN
   pago PAID  -> misma key_hash y mismo request_hash => 200 replayed (sin escribir)
              -> misma key_hash, otro request_hash   => 409 IDEMPOTENCY_KEY_REUSED
              -> otra clave                           => 409 PAYMENT_ALREADY_REGISTERED (+ current)
   pedido rejected|cancelled => 409 ORDER_NOT_PAYABLE (+ current); PedidosYa / sin fila de pago / total 0 => 422 PAYMENT_NOT_COLLECTABLE
   validar tendered (formato, >0, >= amount, <= tope) => 400 / 422                                          -- ANTES de escribir
2  UPDATE app.payments p SET status='paid', tendered_amount=$t, change_amount=$t - p.amount, collector_type='STAFF',
          received_by_staff_id=$staff, collection_context=$ctx, received_at=now(), confirm_key_hash=$k,
          confirm_request_hash=$r, updated_at=now()
     FROM app.orders o
    WHERE p.id=$pay AND p.order_id=o.id AND p.status='pending' AND o.status NOT IN ('rejected','cancelled')
   RETURNING p.received_at, p.change_amount
   0 filas => carrera perdida: relectura (sentencia 3) y mismo árbol de decisión que arriba (replay | 409)
3  INSERT INTO app.payment_events (payment_id, order_id, event_type='cash_received', actor_staff_id, amount, tendered_amount, change_amount)
4  AuditService.record(tx, payment.cash_received …)
```

**Doble clic / concurrencia**: el UPDATE condicional (`status='pending'`) toma el bloqueo de fila de `payments`; el segundo UPDATE espera, re-evalúa la condición (READ COMMITTED) y obtiene 0 filas; la relectura distingue «misma clave y cuerpo» (200 replay, no escribe) de «otra clave» (409). `UNIQUE(order_id)` impide un segundo pago aunque dos creaciones compitieran. Carrera con `cancel`/`reject`: ambos órdenes son consistentes (pagar-antes-de-cancelar ⇒ `PAID` + cancelado = «posible devolución»; cancelar-antes-de-pagar ⇒ 409 `ORDER_NOT_PAYABLE`); el UPDATE incluye la condición del estado del pedido leída en la misma sentencia.

**Respuesta perdida**: el cliente reintenta con la MISMA clave y obtiene 200 `Idempotent-Replayed: true` con la recepción original (`appliedByMe` indica si fue la misma persona). Un 503 `ORDERS_BUSY`/timeout deja el estado desconocido: la web reintenta con la misma clave (nunca declara éxito sin respuesta persistida). Una clave NUEVA tras un 409 `PAYMENT_ALREADY_REGISTERED` NO cobra otra vez.

## 8. Efectivo entregado y cambio

- Solo el servidor calcula `change` y `amountApplied`. La web muestra un cambio INFORMATIVO calculado en el cliente solo para ayudar al cajero mientras escribe; el valor persistido y mostrado después es el del servidor (la web no lo reenvía).
- Reglas y ejemplos en §5.4. `payments.amount` y `orders.total` no cambian nunca; una suma de ingresos usa `amount` (jamás `tendered_amount` ni `change_amount`). Ninguna otra feature debe sumar `tendered_amount` como ingreso (documentado en ADR-0030).
- Moneda fija GTQ (CHECK en `orders`); el contrato no tiene campo de moneda en la entrada.

## 9. Preparación para F28 (cobro del motorista), sin implementarlo

- Modelo: `collector_type` (hoy CHECK `STAFF`) y `collection_context` (`OWN_DELIVERY`) ya describen quién y dónde cobró. F28 añadirá de forma ADITIVA: `RIDER` al CHECK, `received_by_rider_id` (FK a `riders`) y el comando del motorista (p. ej. `POST /v1/rider/deliveries/{id}/cash-collection`) que reutiliza el MISMO servicio de registro (`CashPaymentService.register({collector})`), el MISMO `UNIQUE(order_id)` y la MISMA fila: no pueden existir dos ingresos para un pedido.
- Cobrador ≠ rendición de caja: el motorista cobra (recepción) y luego ENTREGA el efectivo al local (rendición/arqueo, F28/F26/F34, en tablas propias que referencian `payments.id`). F24 no modela la rendición ni suma el efectivo en poder del motorista a ningún saldo.
- Mientras F28 no exista, nada marca `PAID` al asignar, iniciar o completar una entrega; un pedido DELIVERY `OWN` se cobra con el endpoint de F24 por personal con `payments.confirm`.
- El contrato es compatible: `PaymentReception.collectorType`, `PaymentCollectionContext` y `AdminOrderPaymentBlockedReason` son enums abiertos (los clientes toleran valores futuros).

## 10. Integración con F19/F20/F21/F22/F23 (qué cambia en cada una)

- **F19 (cotización)**: sin cambio de importes; el checkout solo ofrece efectivo (la cotización no recibe método).
- **F20**: `OrderCreateRequest.paymentMethodPreference` solo `cash` (ausente ⇒ se guarda `NULL`, el pago es efectivo igualmente); `createOrder` añade la sentencia del pago pendiente a la transacción; `OrderDetail.payment` real (LEFT JOIN `payments` en la sentencia de pedido, sin sentencia extra); se retira `PAYMENT_METHOD_UNAVAILABLE`. El detalle no devuelve `methodPreference`.
- **F21**: `OrderTracking.payment` (requerido) leído por JOIN en la sentencia del pedido; fuera de `steps`/`events`.
- **F22**: `AdminOrderSummary.paymentStatus` (LEFT JOIN en el listado, sin sentencia extra); `AdminOrderDetail.payment` = `AdminOrderPaymentSummary` (incluye `registration` calculado con los `grants` ya leídos); `OrderPaymentReadPort.inspect(orderId)` ya no recibe la preferencia y su implementación real lee `payments` (+1 sentencia en `reject`/`cancel`, techo 7); `ProvisionalPaymentRule` se elimina. Las transiciones no tocan pagos.
- **F23**: `OrderReceipt.payment` = `OrderReceiptPayment`; el recibo imprime «Pagado en efectivo» con importe, efectivo recibido y cambio, o «Pago en efectivo pendiente». `MyOrderSummary.paymentMethodPreference` en `cash|null`.

## 11. Rendimiento y presupuesto de sentencias SQL

Se cuentan las sentencias del dominio (sin la lectura de `grants` del personal ya existente, ni `BEGIN/COMMIT/SET LOCAL`). Se MIDEN contra PostgreSQL real en la int-spec; no se afirman antes.

| Operación                                | Presupuesto                                 | Notas                                                                                       |
| ---------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `createOrder` (transacción)              | **10** (antes 9): **+1 INSERT** del pago    | CTE `INSERT payments … RETURNING` + `INSERT payment_events`; 1 conexión; sin lecturas extra |
| `getOrder`                               | sin cambio (objetivo +0; techo +1)          | `LEFT JOIN payments` en la sentencia del pedido                                             |
| `getOrderTracking`                       | objetivo 2 (techo 3)                        | `LEFT JOIN payments` en la sentencia del pedido (Prisma relacionado: medir)                 |
| `getOrderReceipt`                        | ≤ 5 (techo 6)                               | idem                                                                                        |
| `listAdminOrders` / `getAdminOrderBoard` | ≤ 2 / ≤ 3 sin cambio                        | `LEFT JOIN payments` por `UNIQUE(order_id)` en la misma sentencia; sin N+1 con 50 pedidos   |
| `getAdminOrder`                          | ≤ 7 sin cambio                              | el resumen de pago sale de un `LEFT JOIN` de la sentencia pedido+sucursal                   |
| `getAdminOrderPayment`                   | **≤ 2** (típico 1)                          | pedido + sucursal + pago + nombre del cobrador (`LEFT JOIN staff_users`) con alcance en SQL |
| `listAdminOrderPaymentHistory`           | **≤ 2** (típico 1)                          | autorización por pedido + eventos con nombre del actor por lote                             |
| `registerAdminOrderCashPayment`          | **≤ 6** (típico 4; replay 1; conflicto 2–3) | lectura, UPDATE condicional, evento, auditoría (+ relectura si pierde la carrera)           |
| `rejectAdminOrder` / `cancelAdminOrder`  | techo 7 (antes 6)                           | +1 lectura real de `payments` por `OrderPaymentReadPort`; `accept`/`prepare`/… sin cambio   |

Índices: PK y `UNIQUE(order_id)` bastan para todas las lecturas por pedido; `payment_events_order_idx (order_id, occurred_at, id)` sirve el historial; los FK llevan índice. No se añaden índices por sucursal/estado (YAGNI hasta F34). Costo en escritura: 2 filas más por pedido (≈ 200/día) — insignificante. Gate: lecturas con `rejectIfWaiting: 2`; el registro es escritura normal (misma plaza que las transiciones). Sin Redis ni servicios externos. Riesgo de pool: el registro usa 1 conexión.

## 12. Web

### 12.1 Checkout y cliente

- `PaymentStep` ofrece SOLO «Efectivo» (sin tarjeta, transferencia, Neonet, comprobantes ni cuentas). Mensajes fijos: PICKUP «Realiza el pago en efectivo cuando recojas tu pedido en la sucursal.»; DELIVERY `OWN` «Realiza el pago en efectivo cuando recibas tu pedido.». Sin datos de tarjeta en pantalla ni estado. `ReviewStep`, `CheckoutFlow`, `OrderReceived` y `checkout-model` quedan sin rama `bank_transfer`/`card`; el cuerpo de `createOrder` envía `paymentMethodPreference: 'cash'` (o lo omite).
- Seguimiento (`/pedidos/[id]/seguimiento`), detalle (`/pedidos/[id]`), confirmación y recibo (`/pedidos/[id]/recibo`) muestran «Pago en efectivo: Pendiente/Pagado» con ícono y texto (no solo color), la fecha (`paidAt`, `America/Guatemala`) y, solo en el recibo, importe pagado, efectivo recibido y cambio. Nunca «transferencia», empleado ni historial. El texto «Sin pago registrado» de F23 se sustituye por «Pago en efectivo pendiente».

### 12.2 Backoffice (detalle F22)

- Panel «Pago» en el detalle (`features/bo-orders`): estado, total debido, pendiente, contexto («Mostrador»/«Entrega propia»), y con `PAID` empleado, fecha y hora, efectivo recibido y cambio; aviso «posible devolución pendiente» si `possibleRefundReview`; insignia de pago en el tablero (`paymentStatus`). Botón «Registrar pago en efectivo» solo si `registration.allowed`; si no, texto con `blockedReason` (es/en).
- Modal «Registrar pago en efectivo»: total pendiente, campo «Monto entregado» (teclado numérico, hasta 2 decimales, validación local solo de ayuda), «Cambio» informativo calculado, casilla obligatoria «Recibí físicamente el dinero» (el botón «Registrar» permanece deshabilitado sin ella ni con monto insuficiente), `Idempotency-Key` ESTABLE por intento (se genera al abrir el modal o al cambiar el importe tras un 4xx definitivo y se reutiliza en cualquier reintento del mismo envío; se descarta al éxito/cierre), botón deshabilitado mientras la petición vuela (anti doble clic).
- Resultados: éxito SOLO tras 200/201 persistido (toast + panel actualizado con el cambio del servidor + `invalidateQueries` del detalle, tablero y pago); 200 `replayed` ⇒ «Este cobro ya estaba registrado» (distingue `appliedByMe`); 409 `PAYMENT_ALREADY_REGISTERED` ⇒ «Otra persona ya registró este pago» + refresco con `current`; 409 `ORDER_NOT_PAYABLE` ⇒ «El pedido está cancelado/rechazado: no se cobra»; 409 `IDEMPOTENCY_KEY_REUSED` ⇒ error genérico + nueva clave; 422 `CASH_AMOUNT_INSUFFICIENT`/`CASH_TENDERED_TOO_LARGE`/`PAYMENT_NOT_COLLECTABLE` ⇒ mensaje por código; 400 ⇒ errores de campo; 401 ⇒ sesión; 403 `MFA_REQUIRED`/`PAYMENT_ACTION_FORBIDDEN` ⇒ «No tienes permiso…»; 404 ⇒ «Pedido no disponible»; 429/503 ⇒ «Reintenta en N s» (misma clave).
- Cachés: claves por persona + sucursal (patrón F22); sin persistencia de importes en `localStorage`/`sessionStorage` (la clave de intento vive en memoria del modal).

### 12.3 Modo `mock`

`mocks/handlers/admin-orders.ts` y `order-placement.ts` responden las mismas rutas con la forma REAL (efectivo, `PENDING|PAID`, idempotencia por clave en memoria, 400/403/404/409/422/429/503), rotuladas «Simulación»; un cobro simulado NUNCA confirma un cobro real y no se mezcla con `http`. Se retira `bank_transfer` de mocks y pruebas. Fallos de prueba nuevos en `window.__sushimonMockFaults`: `payment-already-registered`, `payment-busy`.

### 12.4 Calidad

Responsive a 390 px sin desbordamiento (modal a pantalla casi completa); objetivos ≥ 44 px; tema claro/oscuro; es/en completos (`payments.*` en `es.json`/`en.json`, retirando `bank_transfer`); a11y: modal con `role="dialog"`, foco atrapado y devuelto, errores con `aria-live`, estados con texto + ícono, casilla asociada a su etiqueta.

## 13. Matriz de pruebas (U unitaria · S servicio con dobles · E e2e supertest · I int-spec contra PostgreSQL real · W Vitest web · P Playwright)

| #   | Caso                                                                                                                                                                                                                           | Nivel                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | `createOrder` crea el pago `CASH` `PENDING` con `amount = orders.total`, `branch_id` del pedido y evento `created`, en la MISMA transacción (un fallo posterior no deja pago huérfano)                                         | S, I                                                                                                     |
| 2   | Reintento idempotente de `createOrder` (misma clave) NO duplica pago ni evento; `UNIQUE(order_id)` rechaza un segundo pago por pedido                                                                                          | S, I                                                                                                     |
| 3   | `paymentMethodPreference` `bank_transfer` o `card` ⇒ 400; ausente o `cash` ⇒ 201; el trigger `orders_payment_pref_cash_only` rechaza `bank_transfer` en INSERT (SQL directo) y permite UPDATE de filas legacy                  | E, I                                                                                                     |
| 4   | `OrderDetail.payment`/`OrderCreated` reales: `{CASH, PENDING, paidAt: null}`; tras cobro `{CASH, PAID, paidAt}`; ausencia de `methodPreference` y de `NOT_STARTED`                                                             | S, E, I                                                                                                  |
| 5   | Checkout web ofrece SOLO «Efectivo»; sin radio de transferencia/tarjeta/Neonet; el cuerpo de `createOrder` lleva `cash`                                                                                                        | W                                                                                                        |
| 6   | Ausencia de `bank_transfer`/transferencia/tarjeta en contrato, mocks, textos i18n y pruebas (barrido `grep` automatizado de `openapi.yaml`, `src/` web y `src/` API)                                                           | U, W                                                                                                     |
| 7   | Mensajes de checkout: PICKUP «…cuando recojas tu pedido en la sucursal.» y DELIVERY `OWN` «…cuando recibas tu pedido.» (es/en)                                                                                                 | W                                                                                                        |
| 8   | `GET …/payment`: `payments.read` + aal2 devuelve pedido, total, GTQ, `CASH`, estado, pendiente, contexto y `registration`; con `PAID` la recepción (empleado, fecha, entregado, cambio)                                        | S, E, I                                                                                                  |
| 9   | Pago exacto: total 185.00, `tendered 185.00` ⇒ 201, `change 0.00`, `amountApplied 185.00`                                                                                                                                      | U, S, I                                                                                                  |
| 10  | Pago con cambio: total 185.00, `tendered 200.00` ⇒ `change 15.00`, `amount_applied 185.00`; el cambio lo calcula el servidor (cambio enviado por el cliente ⇒ 400)                                                             | U, S, I                                                                                                  |
| 11  | Efectivo insuficiente (184.99) ⇒ 422 `CASH_AMOUNT_INSUFFICIENT`; no escribe nada (pago sigue `pending`, sin evento ni auditoría)                                                                                               | U, S, I                                                                                                  |
| 12  | `tendered` negativo, `0`, `0.00`, vacío, `abc`, `1e2`, `1,000.00`, `NaN` ⇒ 400 `PAYMENT_AMOUNT_INVALID`                                                                                                                        | U, E                                                                                                     |
| 13  | Precisión: `200.001` ⇒ 400 (sin redondeo); `200` y `200.00` equivalentes; `0.1 + 0.2` no produce errores (centavos enteros, tabla de casos)                                                                                    | U                                                                                                        |
| 14  | Tope: `tendered` 5000.00 ⇒ 201; 5000.01 ⇒ 422 `CASH_TENDERED_TOO_LARGE`                                                                                                                                                        | U, S                                                                                                     |
| 15  | El ingreso es `amount` y no `tendered`: ninguna consulta/DTO suma `tendered_amount`/`change_amount` como ingreso; `orders.total` no cambia; `payments.amount = orders.total` tras el cobro                                     | S, I                                                                                                     |
| 16  | Doble pago: segundo POST con OTRA clave sobre un pedido `PAID` ⇒ 409 `PAYMENT_ALREADY_REGISTERED` con `current` (datos actuales); no escribe                                                                                   | S, E, I                                                                                                  |
| 17  | Doble clic: dos POST simultáneos con la MISMA clave y cuerpo ⇒ uno 201 y otro 200 `Idempotent-Replayed: true`; UN solo evento y UNA auditoría                                                                                  | S, I                                                                                                     |
| 18  | Reintento posterior con la misma clave y cuerpo ⇒ 200 `replayed` con la recepción original (mismo `receivedAt`, cambio y empleado); `appliedByMe` correcto para otro actor                                                     | S, E, I                                                                                                  |
| 19  | Concurrencia real (≥ 8 POST en paralelo, claves distintas): exactamente 1 gana (201), el resto 409; el pago queda consistente (CHECK `payments_reception_chk`)                                                                 | I                                                                                                        |
| 20  | Idempotencia persistente: tras reiniciar la aplicación/pool (nueva instancia del servicio) la misma clave sigue devolviendo 200 replay; en BD solo `sha256` (32 bytes), nunca la clave en claro                                | I                                                                                                        |
| 21  | Respuesta perdida: la transacción confirma pero el cliente no recibe respuesta; el reintento con la misma clave responde 200 y NO cobra otra vez                                                                               | S, I, W                                                                                                  |
| 22  | Misma clave con OTRO cuerpo (otro `tendered`) ⇒ 409 `IDEMPOTENCY_KEY_REUSED`; la misma clave en OTRO pedido es independiente; `Idempotency-Key` ausente/malformada ⇒ 400                                                       | S, E, I                                                                                                  |
| 23  | Sin `payments.confirm` ⇒ 403; con `payments.read` pero sin `confirm` ⇒ 403 y `registration.blockedReason = NO_PERMISSION`; sin sesión ⇒ 401; JWT de cliente ⇒ 403                                                              | E                                                                                                        |
| 24  | Sesión aal1 ⇒ 403 `MFA_REQUIRED` en las tres rutas                                                                                                                                                                             | E                                                                                                        |
| 25  | Alcance por sucursal: personal de la sucursal A no cobra, no ve el pago ni el historial de un pedido de B (404); con `orders.read` pero sin `confirm` en su sucursal ⇒ 403 `PAYMENT_ACTION_FORBIDDEN`; alcance global funciona | S, E, I                                                                                                  |
| 26  | Anti-IDOR: pedido inexistente y de otra sucursal ⇒ MISMO 404 `ORDER_NOT_FOUND` (cuerpo, cabeceras y número de sentencias) en las tres rutas                                                                                    | E, I                                                                                                     |
| 27  | Empleado = el del JWT: un cuerpo con `staffId`/`collectorId`/`receivedBy` ⇒ 400 (lista blanca); `received_by_staff_id` coincide con el actor                                                                                   | S, E, I                                                                                                  |
| 28  | Fecha = reloj del servidor: `receivedAt` = `payments.received_at` ≈ `now()` (reloj simulado); campos `receivedAt`/`date` de entrada ⇒ 400                                                                                      | S, E                                                                                                     |
| 29  | Sucursal = la del pedido (no editable): `branch_id` del pago y de la auditoría = `orders.branch_id`; `branchId` de entrada ⇒ 400                                                                                               | S, E, I                                                                                                  |
| 30  | `GET …/payment/history`: `CREATED` y `CASH_RECEIVED` en orden, con nombre del actor y montos; sin id de empleado ni hashes; fuera de alcance ⇒ 404; `payment_events` solo-añadir (trigger)                                     | S, E, I                                                                                                  |
| 31  | Auditoría: un evento `payment.cash_received` con actor, sucursal, `entity_id = payments.id` y valores sin PII; no hay auditoría en lecturas ni en replay                                                                       | S, I                                                                                                     |
| 32  | Rollback: si falla el INSERT del evento o la auditoría, el UPDATE revierte (pago sigue `pending`, sin evento ni auditoría), 503/500 sin éxito falso                                                                            | S, I                                                                                                     |
| 33  | PICKUP: el pago se registra en mostrador con `collectionContext = BRANCH`; completar el pedido (`picked_up`) NO marca `PAID` y se permite con pago `PENDING` (P84)                                                             | S, I                                                                                                     |
| 34  | DELIVERY `OWN`: mismo endpoint, `collectionContext = OWN_DELIVERY` derivado del pedido (no de la entrada); asignar/iniciar/completar entrega no marca `PAID`                                                                   | S, I                                                                                                     |
| 35  | Motorista: ninguna ruta de F24 acepta `collectorType=RIDER` (400); `payments_reception_chk` rechaza `collector_type <> 'STAFF'`; ningún flujo de entrega escribe `payments` (contrato listo para F28)                          | U, I                                                                                                     |
| 36  | PedidosYa: pedido con `delivery_provider='PEDIDOSYA'` ⇒ `registration.allowed=false (PROVIDER_BLOCKED_EXTERNAL)`, `collectionContext=null`, POST 422 `PAYMENT_NOT_COLLECTABLE`; sin llamadas externas                          | S, I                                                                                                     |
| 37  | Estado operativo intacto: el POST no cambia `orders.status` ni `updated_at` de forma que afecte `expectedStatus` de F22; ningún comando de F22 cambia `payments.status`; `PAID` solo por el POST                               | S, I                                                                                                     |
| 38  | Pedido `rejected`/`cancelled` SIN pago: POST ⇒ 409 `ORDER_NOT_PAYABLE`; el pago sigue `PENDING`; sin reembolso ni devolución; `possibleRefundReview=false`; `pendingActions=[]`                                                | S, E, I                                                                                                  |
| 39  | Pedido `PAID` luego cancelado/rechazado: pago sigue `PAID` (nunca vuelve a `PENDING`); `possibleRefundReview=true`; `cancel`/`reject` devuelven `pendingActions=['payment_review']` (lectura real)                             | S, E, I                                                                                                  |
| 40  | Sin reembolsos: no existe tabla `refunds` ni ruta de reembolso/devolución; ningún flujo crea filas de devolución                                                                                                               | U, I                                                                                                     |
| 41  | Pago confirmado inmutable: `UPDATE`/`DELETE` SQL directo sobre un pago `paid` ⇒ `42501`; `paid → pending` rechazado; cambiar `amount`/`order_id`/`branch_id` rechazado                                                         | I                                                                                                        |
| 42  | Recibo con pago `PENDING`: «Pago en efectivo pendiente», sin importes pagados (`null`); nunca «pagado»                                                                                                                         | S, I, W                                                                                                  |
| 43  | Recibo con pago `PAID`: fecha, importe pagado = total, efectivo entregado y cambio; coincide con la recepción                                                                                                                  | S, I, W                                                                                                  |
| 44  | Seguimiento F21: `payment` real `{CASH, PENDING                                                                                                                                                                                | PAID, paidAt}`; el pago NO aparece en `steps`/`events`; el polling de F21 no cambia de presupuesto (≤ 3) | S, E, I |
| 45  | `getOrder` y `getOrderTracking` y recibo para invitado con token y dueño por JWT: mismo `payment`; cambiar el estado del pedido no cambia `payment.status`                                                                     | S, E, I                                                                                                  |
| 46  | Sin fuga pública: ni empleado, ni historial, ni auditoría, ni `received_by_staff_id`, ni hashes, ni `collectionContext` en `OrderDetail`/`OrderTracking`/`OrderReceipt` (barrido de claves)                                    | S, E                                                                                                     |
| 47  | Integración real: int-spec contra PostgreSQL (`test/cash-payments.int-spec.ts`, `test/migration-0019.int-spec.ts`), API HTTP compilada y navegador (Playwright) contra la API real con datos sembrados y limpiados             | I, P                                                                                                     |
| 48  | Responsive 390 px: panel de pago, modal de registro, checkout y recibo sin desbordamiento; objetivos ≥ 44 px                                                                                                                   | P                                                                                                        |
| 49  | Tema claro/oscuro: panel, modal, insignia del tablero y recibo (impreso forzado a blanco)                                                                                                                                      | W, P                                                                                                     |
| 50  | es/en: todas las cadenas `payments.*` y `checkout.payment.*` existen en ambos idiomas, sin restos de transferencia/tarjeta                                                                                                     | W                                                                                                        |
| 51  | Accesibilidad: roles y foco del modal, casilla con etiqueta, errores con `aria-live`, estados texto+ícono, axe sin violaciones                                                                                                 | W, P                                                                                                     |
| 52  | Puertas: `pnpm lint`, typecheck, unit/S/E, int-spec, `pnpm build`, `pnpm contracts:check` y `pnpm check` verdes                                                                                                                | —                                                                                                        |
| 53  | Presupuesto de sentencias (§11) medido: `createOrder` 10; `getAdminOrderPayment` ≤ 2; historial ≤ 2; registro ≤ 6 con 50 pedidos de ruido; listado/tablero/detalle F22 sin cambio; sin N+1                                     | S, I                                                                                                     |
| 54  | Web modal: botón deshabilitado sin casilla o con monto insuficiente; cambio informativo; `Idempotency-Key` estable entre reintentos del mismo envío y nueva tras éxito/cambio de importe; anti doble clic                      | W                                                                                                        |
| 55  | Web modal: éxito solo tras 200/201; 409 con refresco de `current`; 422/400/401/403/404/429/503 con su mensaje; `invalidateQueries` de detalle, tablero y pago; sin persistencia de importes en storage                         | W                                                                                                        |
| 56  | Web panel/tablero: insignia de pago; botón «Registrar» solo con `registration.allowed`; aviso «posible devolución pendiente»; aviso «entregado con pago pendiente»                                                             | W                                                                                                        |
| 57  | Mock mode: handlers con la forma real, idempotencia por clave, rotulado «Simulación», nunca confirma cobros reales; paridad `parity.test.ts` con el contrato y las mismas tablas de casos                                      | W                                                                                                        |
| 58  | Migración 0019: relanzable, guarda de definición ajena, CHECKs, triggers, seed solo `cash`, backfill idempotente (cash/NULL sí; `bank_transfer` no), REVOKE/RLS; reversión documentada                                         | I                                                                                                        |
| 59  | Throttles propios (120/60 lectura, 60/30 comando): 429 `RATE_LIMITED` con `Retry-After`, contadores independientes de F22; gate: saturación ⇒ 503 `ORDERS_BUSY` con `Retry-After`                                              | E, S                                                                                                     |
| 60  | Logs: ninguna línea contiene claves, hashes, importes entregados ni PII; `Cache-Control: private, no-store` en 200 y errores                                                                                                   | S, E                                                                                                     |
| 61  | Pedido legacy `bank_transfer` sin pago: lecturas `CASH/PENDING` y `paymentMethodPreference: null`; POST 422 `LEGACY_PAYMENT_METHOD`; sus transiciones de F22 siguen funcionando                                                | S, I                                                                                                     |
| 62  | Pedido con total 0: `registration.allowed=false (AMOUNT_ZERO)`, POST 422; `payments_reception_chk` rechaza `paid` con `amount = 0`                                                                                             | U, I                                                                                                     |

### Trazabilidad usuario → matriz

El encargo no trae una lista numerada literal; los 52 puntos se enumeraron a partir de su texto y se cubren así (el orden sigue el del encargo).

| Punto                                | Pruebas    | Punto                                    | Pruebas       |
| ------------------------------------ | ---------- | ---------------------------------------- | ------------- |
| 1 CASH pendiente al crear el pedido  | #1, #4     | 27 empleado = JWT                        | #27           |
| 2 reintento F20 sin duplicar         | #2         | 28 fecha del servidor                    | #28           |
| 3 checkout solo efectivo             | #5, #7     | 29 sucursal del pedido                   | #29           |
| 4 sin transferencia                  | #3, #6     | 30 historial autorizado                  | #30           |
| 5 sin tarjeta/Neonet                 | #3, #5, #6 | 31 auditoría                             | #31           |
| 6 GET del pago                       | #8         | 32 rollback                              | #32           |
| 7 pago exacto                        | #9         | 33 PICKUP                                | #33           |
| 8 pago con cambio                    | #10        | 34 DELIVERY OWN                          | #34           |
| 9 insuficiente                       | #11        | 35 motorista sin cobro automático        | #34, #35      |
| 10 negativo                          | #12        | 36 PedidosYa sin cobro                   | #36           |
| 11 cero                              | #12, #62   | 37 estado operativo intacto              | #33, #34, #37 |
| 12 precisión                         | #12, #13   | 38 cancelado sin pago                    | #38           |
| 13 tope de `tendered`                | #14        | 39 cancelado con pago                    | #39           |
| 14 no sumar el cambio                | #15        | 40 sin reembolsos                        | #40           |
| 15 doble pago                        | #16        | 41 pago confirmado inmutable             | #41           |
| 16 doble clic                        | #17, #54   | 42 recibo pendiente                      | #42           |
| 17 reintentos con la misma clave     | #18        | 43 recibo pagado                         | #43           |
| 18 concurrencia                      | #19        | 44 seguimiento del cliente               | #44           |
| 19 idempotencia persistente          | #20        | 45 detalle del cliente                   | #4, #45       |
| 20 respuesta perdida                 | #21        | 46 sin PII/empleado en público           | #46           |
| 21 clave reutilizada con otro cuerpo | #22        | 47 integraciones reales                  | #47           |
| 22 sin permiso                       | #23        | 48 responsive                            | #48           |
| 23 aal1                              | #24        | 49 claro/oscuro                          | #49           |
| 24 sin sesión                        | #23        | 50 es/en                                 | #50           |
| 25 otra sucursal                     | #25        | 51 accesibilidad                         | #51           |
| 26 IDOR                              | #26        | 52 puertas lint/typecheck/unit/int/build | #52, #53      |

Cobertura mínima de la int-spec contra PostgreSQL real (datos `zz-` sembrados y borrados con `app.allow_order_cleanup`): #1, #2, #3, #9–#11, #15–#20, #22, #25, #26, #29–#32, #34, #37–#39, #41, #53, #58, #61, #62.

## 14. Riesgos aceptados y decisiones abiertas

Riesgos:

1. **Efectivo sin conciliación de caja**: F24 registra la recepción pero no cuadra caja ni valida que el dinero exista (confianza en el empleado con auditoría); el arqueo es F28/F26/F34. Mitigación: evento y auditoría con actor, sin edición, y `possibleRefundReview`.
2. **Sin anulación (P82)**: un error de digitación en `tendered` no puede corregirse (el ingreso es `amount`, así que el error afecta solo al `change` informativo). Un cobro registrado sobre el pedido equivocado requiere una futura feature de ajuste con doble control.
3. **Pedidos entregados con pago `PENDING`** son posibles (P84/P90): el negocio podría exigir cobro previo; hoy es solo aviso.
4. **Contrato incompatible con F20/F21/F23 ya implementados** (`OrderDetailPayment` y `OrderTracking.payment` requerido): se acepta porque F20 no está en producción; exige actualizar API, web, mocks y pruebas de esas features dentro del slice F24, y verificar `parity.test.ts`.
5. Throttle por instancia (riesgo de F21); `DB_POOL_MAX` ≥ 9 sigue aplicando; la creación de pedido sube de 9 a 10 sentencias (insignificante).
6. Carrera cobro/cancelación: ambos resultados son válidos pero distintos; la UI debe refrescar con `current`.
7. Backfill marca `PENDING` todo pedido existente, incluidos entregados: en producción recién iniciada es irrelevante; si hubiera datos reales habría que cobrar/depurar a mano (P88).
8. Solo `admin` tiene `payments.*` por catálogo: sin asignación (F03) el cajero no puede cobrar (P91).

Decisiones abiertas con valor seguro adoptado (detalle en `docs/business-rules/decisiones-pendientes.md`):

| #   | Tema                                         | Valor adoptado por defecto                                                                                                                         |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| P82 | Anulación/corrección de un pago registrado   | NO existe `VOIDED`; el pago `PAID` es inmutable; un error se resuelve con una feature futura de ajuste con doble control (F26)                     |
| P83 | Tope de `tendered`                           | Q 5,000.00 (constante del servidor; 422 `CASH_TENDERED_TOO_LARGE`)                                                                                 |
| P84 | Pagar antes de entregar en PICKUP            | NO se exige; aviso en la web «entregado con pago pendiente»; nada por sucursal sin configuración                                                   |
| P85 | Cobro del motorista (F28)                    | Solo `STAFF` en F24; F28 añade `RIDER` aditivo con el mismo `UNIQUE(order_id)`; rendición de caja separada; un único ingreso por pedido            |
| P86 | PedidosYa y efectivo                         | No se asume cobro del proveedor: `registration` bloqueado y 422 `PAYMENT_NOT_COLLECTABLE` hasta F29                                                |
| P87 | Pagos parciales, divididos, propinas         | NO; `UNIQUE(order_id)`; ampliar = migración + ADR                                                                                                  |
| P88 | Backfill de pedidos existentes               | Sí, aditivo, `PENDING` solo para cash/NULL; los `bank_transfer` históricos no reciben pago (se leen `CASH/PENDING`, no cobrables)                  |
| P89 | CHECK de `orders.payment_method_preference`  | Se conserva el CHECK de 0018; trigger de INSERT cash-only + API 400; sin `NOT VALID`; limpieza/estrechamiento futuro cuando no queden filas legacy |
| P90 | Pedidos terminados con pago pendiente        | Permitidos; se cobran luego; el reporte de «pendientes de cobro» es F34                                                                            |
| P91 | Roles con `payments.read`/`payments.confirm` | Sin cambio de RBAC (solo `admin`); negocio decide si `manager`/cajero los reciben vía F03                                                          |

## 15. Reparto de trabajo (agentes) y orden

1. **database-engineer**: migración 0019 (DDL de §2.2), `schema.prisma` (modelos `PaymentMethod`, `Payment`, `PaymentEvent`), `test/migration-0019.int-spec.ts`; confirmar numeración tras `git fetch`; validar backfill y trigger cash-only sobre filas legacy.
2. **api-engineer** (`src/orders/payments/` dentro de `OrdersModule`, sin módulo nuevo): `cash-amount.ts` (parseo/centavos/cambio, puro) + `.spec.ts`; `payments.repository.ts` (SQL de §7 con `$queryRaw` parametrizado y UPDATE condicional); `cash-payments.service.ts` (registro, replay, errores) reutilizable por F28; `admin-payments.controller.ts` (3 rutas, `@RequireStaff` por operación, DTO estricto, `Idempotency-Key`); `payments-read.adapter.ts` que sustituye a `ProvisionalPaymentRule` (`ORDER_PAYMENT_READ_PORT`); inserción del pago en `OrdersRepository.createOrder`; ajustes de mappers/DTO de F20/F21/F22/F23 (`payment`, `paymentStatus`); retirar `bank_transfer`/`card` y `PAYMENT_METHOD_UNAVAILABLE`; throttles `ADMIN_PAYMENTS_*`; `current` en `EXTRA_BODY_KEYS`. Orden: contrato (hecho) → `cash-amount` puro → repositorio → servicio → controlador → puerto → integración con F20–F23 → `contracts:check`.
3. **web-engineer**: servicios (`services/admin-orders.ts` + `payments`), hooks, panel y modal en `features/bo-orders`, `PaymentStep`/`ReviewStep`/`CheckoutFlow`/`OrderReceived`/`checkout-model`, seguimiento, detalle y recibo, mocks y paridad, i18n es/en, limpieza de `bank_transfer` en pruebas y mocks (`mocks/admin-orders.ts`, `handlers/order-placement.ts`, `handlers/admin-orders.ts`).
4. **security-reviewer** (solo lectura) tras la API: alcance en SQL, 404 uniforme, 403 por permiso, aal2, idempotencia y hashes, tope, PII pública, auditoría, throttles. **performance-reviewer**: presupuesto y plan del JOIN. **qa-engineer**: matriz §13. **ui-ux-reviewer**: panel, modal, checkout y recibo (a11y, responsive, temas).

## 16. Estado (implementado · simulado · pendiente de proveedor · bloqueado)

| Pieza                                                                 | Estado                                                                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Contrato (3 operaciones, esquemas de pago, retiro de `bank_transfer`) | `CONTRACT_DEFINED` (`contracts:check` rojo solo por las 3 operaciones nuevas hasta implementar)     |
| Migración 0019 (DDL de §2.2)                                          | Propuesta, SIN SQL en el repo ni aplicada; requiere aprobación humana                               |
| API, int-spec y presupuesto                                           | Pendiente                                                                                           |
| Web (checkout efectivo, panel y modal, tracking/recibo con pago real) | `MOCK_ONLY`/pendiente hasta integrar; el mock de F20–F23 sigue con la forma anterior hasta el slice |
| Transferencia, tarjeta/Neonet, reembolsos                             | Fuera de alcance por requerimiento (F25 `BLOCKED_EXTERNAL`; F26)                                    |
| Cobro del motorista (F28)                                             | Contrato y modelo preparados; sin implementar                                                       |
| PedidosYa                                                             | `BLOCKED_EXTERNAL`: sin cobro asumido; registro bloqueado                                           |
| Anulación de pagos, parciales, rendición de caja                      | No implementado por decisión (P82, P87; F28/F34)                                                    |

## 17. Cambio propuesto al backlog maestro (F24)

Texto sugerido para `docs/BACKLOG.md` (NO se edita aquí; lo aplica quien coordine el backlog). Reemplaza el título de la tabla y la ficha de F24:

> **F24 — Pagos en efectivo** (antes «Efectivo y transferencias bancarias»)
>
> - **Responsable:** A · **Prioridad:** P0 · **Tipo:** API + WEB (pago visible al cliente + registro de cobro en backoffice).
> - **Dependencias mínimas para avanzar:** F20, F22, F03, F02. **Integración posterior / para cierre completo:** F26 (reembolsos), F28 (cobro del motorista), F29 (PedidosYa).
> - **Alcance funcional:** Pago en efectivo único por pedido, creado `PENDING` con el pedido; registro del efectivo recibido (monto entregado, cambio calculado en servidor, ingreso = deuda) por personal con `payments.confirm` + aal2 + alcance de sucursal; idempotencia persistente y concurrencia segura; historial y auditoría; estado de pago público (`PENDING|PAID`) en detalle, seguimiento y recibo; señal derivada «posible devolución pendiente» en cancelados/rechazados con cobro. **Quedan FUERA por requerimiento**: transferencia bancaria (cuentas, comprobantes, conciliación), tarjetas/Neonet y reembolsos.
> - **API — rutas:** `GET /v1/admin/orders/:id/payment`, `POST /v1/admin/orders/:id/payment/cash`, `GET /v1/admin/orders/:id/payment/history` (+ ampliación de `getOrder`, `getOrderTracking`, `getOrderReceipt`, listado y detalle de F22). Sustituyen a `GET /v1/payment-methods`, `GET /v1/admin/payments`, `GET /v1/orders/:id/payments`, `confirm-transfer` y `confirm-cash`.
> - **Next.js:** Checkout solo «Efectivo» con instrucciones por modalidad; backoffice con panel y modal «Registrar pago en efectivo»; seguimiento y recibo con pago real.
> - **Datos y migraciones:** `app.payment_methods` (solo `cash`), `app.payments`, `app.payment_events`, `app.audit_events`; migración 0019 aditiva con backfill.
> - **Pruebas y aceptación:** `specs/025-cash-payments` §13 (62 casos): pedido ≠ pagado ≠ entregado, cambio solo en servidor, ingreso = deuda, sin doble cobro, idempotencia persistente, anti-IDOR, sin transferencia/tarjeta.
> - **Límite / no invadir otra feature:** No procesar tarjetas ni transferencias ni reembolsos; no cobrar por PedidosYa; no rendir caja.
> - **Decisión o brecha original resuelta:** sin comprobantes ni bucket privado (transferencia retirada). Abiertas: P82–P91.

Y en la tabla maestra: F24 «Pagos en efectivo», dependencias `F20, F22, F03`, desbloquea `F26, F28, F29`. F25 (Neonet) y F26 (reembolsos) conservan su ficha; en F26 la referencia a «transferencias» debe retirarse al planificarla.

## 18. Verificación pendiente de implementación

- Confirmar con `EXPLAIN`/contador que los `LEFT JOIN payments` no añaden sentencias a F20–F23 y que `getOrderTracking` queda en 2–3.
- Confirmar que Prisma 7 permite el UPDATE condicional con `FROM` vía `$queryRaw` dentro de la transacción de la API, y la CTE de `createOrder` vía `$queryRaw`.
- Confirmar el nombre y la ruta reales del modal/panel en `features/bo-orders` y la lista exacta de archivos web con `bank_transfer` (hoy: `checkout-model.ts`, `PaymentStep.tsx`, `ReviewStep.tsx`, `CheckoutFlow.tsx`, `OrderReceived.tsx`, `receipt-screen.tsx`, `mocks/admin-orders.ts`, `mocks/handlers/order-placement.ts`, `i18n/messages/{es,en}.json` y sus pruebas; API: `orders.types.ts`, `orders.service.ts`, `order-create-request.dto.ts`, `order-responses.dto.ts`, `order-mapper.ts`, `admin/*`, `history/*`, `ports/order-payment-read.port.ts`, `prisma/schema.prisma`).
- Actualizar `.claude/skills/checkout-payments/SKILL.md` (menciona transferencia) cuando se implemente.
