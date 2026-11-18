import type { DataClient } from '@/lib/data-access/types';
import type {
  CardPaymentRequest,
  CreateIncidentRequest,
  DraftCreateOrderRequest,
  DraftOrder,
  Incident,
  OrderCreateRequest,
  OrderCreated,
  OrderDetail,
  OrderLookupRequest,
  PaymentResult,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/** Pedidos de la tienda: crear (F20), consultar, seguir (simulado), consultar como invitado, pagar e incidencias. */

/**
 * F20 — `POST /v1/orders` (`createOrder`). Cuerpo `OrderCreateRequest`: la cotización aceptada (`quoteToken`) + contacto +
 * dirección + preferencia de pago; NUNCA importes. `idempotencyKey` es obligatoria (cabecera `Idempotency-Key`) y debe ser la
 * MISMA ante cualquier reintento del mismo envío (ver `features/checkout/order-attempt.ts`). El 200 (repetición idempotente) y
 * el 201 devuelven el mismo `OrderCreated`; `access.guestToken` solo viene para invitados y es una credencial: no se registra.
 * Lectura/escritura PRIVADA: con sesión viaja `Authorization`.
 */
export const createOrder = (
  client: DataClient,
  input: OrderCreateRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  client.request<OrderCreated>(paths.orders(), {
    method: 'POST',
    body: input,
    signal,
    headers: { 'Idempotency-Key': idempotencyKey },
  });

/**
 * F20 — `GET /v1/orders/{id}` (`getOrder`): `id` es el UUID del pedido. Dueño por sesión (JWT) o invitado con la credencial
 * `X-Order-Token` (cabecera, nunca en la URL). Cualquier otro caso es el mismo 404.
 */
export const getOrder = (
  client: DataClient,
  id: string,
  options: { guestToken?: string | null; signal?: AbortSignal } = {},
) =>
  client.request<OrderDetail>(paths.order(id), {
    method: 'GET',
    signal: options.signal,
    ...(options.guestToken ? { headers: { 'X-Order-Token': options.guestToken } } : {}),
  });

/**
 * 🎭 Solo mock: pedido BORRADOR que usan el seguimiento y el backoffice simulados. En `http` no existe (404): el pedido real es
 * `createOrder`. Se retira con F21/F22.
 */
export const createDraftOrder = (client: DataClient, input: DraftCreateOrderRequest) =>
  client.post<DraftOrder>(paths.demoDraftOrders(), input);

/** 🎭 Seguimiento SIMULADO (borrador `DraftOrder`, id `MON-…`). En `http` el seguimiento es F21. */
export const getDraftOrder = (client: DataClient, id: string) =>
  client.get<DraftOrder>(paths.order(id));

/** 🎭 Solo mock: prepara el pedido borrador para la pasarela NeoNet SIMULADA. */
export const prepareDraftCardOrder = (client: DataClient, id: string) =>
  client.post<DraftOrder>(paths.demoPrepareCardOrder(id));

export const lookupOrder = (client: DataClient, input: OrderLookupRequest) =>
  client.post<DraftOrder>(paths.orderLookup(), input);

/**
 * Pago con tarjeta — pasarela NeoNet SIMULADA (solo tarjetas de prueba). La integración real
 * tokenizará la tarjeta en el navegador (pendiente de documentación y credenciales).
 */
export const payWithCard = (client: DataClient, input: CardPaymentRequest) =>
  client.post<PaymentResult>(paths.cardPayment(), input);

export const createIncident = (client: DataClient, input: CreateIncidentRequest) =>
  client.post<Incident>(paths.incidents(), input);

/** 🎭 Solo mock: "Ver siguiente estado (simulación)". En http no existe (404). */
export const advanceOrderDemo = (client: DataClient, id: string) =>
  client.post<DraftOrder>(paths.demoAdvanceOrder(id));
