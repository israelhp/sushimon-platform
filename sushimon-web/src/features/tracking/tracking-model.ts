import type {
  OrderLifecycleStatus,
  OrderPublicStatus,
  OrderTracking,
  OrderTrackingEvent,
  OrderTrackingStep,
} from '@/lib/data-access/models';

/**
 * F21 (spec 022 §3, §9.4) — Presentación del seguimiento: códigos del servidor → claves de texto estables y estado visual de cada
 * fase. Lógica PURA (sin red ni reloj). NO calcula estados ni transiciones (las gobierna el servidor/F22): solo presenta lo recibido.
 */

export const KNOWN_PHASES = [
  'received',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
  'completed',
  'rejected',
  'cancelled',
] as const satisfies readonly OrderPublicStatus[];

/**
 * Mapeo `OrderLifecycleStatus` → fase pública publicado en el contrato (`OrderPublicStatus`, F21): solo para pantallas que reciben el
 * estado real (`OrderDetail.status`) y no la fase. Las listas, el recibo y el seguimiento usan la fase que entrega el servidor.
 */
export const publicStatusOf = (status: OrderLifecycleStatus): OrderPublicStatus =>
  status === 'pending'
    ? 'received'
    : status === 'delivered' || status === 'picked_up'
      ? 'completed'
      : status;

export const isKnownPhase = (value: string): value is OrderPublicStatus =>
  (KNOWN_PHASES as readonly string[]).includes(value);

type Fulfillment = OrderTracking['fulfillmentType'];

/**
 * Clave de texto (`tracking.phase.<clave>` / `tracking.phaseHint.<clave>`) de una fase pública. La web decide el texto con
 * `fulfillmentType` (`ready`: recoger vs. entrega; `completed`: «Recogido» vs. «Entregado»). Un valor futuro desconocido usa la
 * etiqueta neutra `unknown` («En proceso»): nunca rompe.
 */
export type PhaseTextKey =
  | 'received'
  | 'accepted'
  | 'preparing'
  | 'readyPickup'
  | 'readyDelivery'
  | 'onTheWay'
  | 'delivered'
  | 'pickedUp'
  | 'rejected'
  | 'cancelled'
  | 'unknown';

export function phaseTextKey(phase: string, fulfillment: Fulfillment): PhaseTextKey {
  if (!isKnownPhase(phase)) return 'unknown';
  switch (phase) {
    case 'ready':
      return fulfillment === 'PICKUP' ? 'readyPickup' : 'readyDelivery';
    case 'completed':
      return fulfillment === 'PICKUP' ? 'pickedUp' : 'delivered';
    case 'on_the_way':
      return 'onTheWay';
    default:
      return phase;
  }
}

/** `done` = alcanzada; `skipped` = superada sin registro (salto en el historial: sin hora); `current`; `pending` = futura. */
export type PhaseState = 'done' | 'skipped' | 'current' | 'pending';

export interface PhaseView {
  phase: string;
  state: PhaseState;
  /** Hora REAL alcanzada o `null` (nunca una estimación). */
  reachedAt: string | null;
  /** Fase terminal negativa (rechazado/cancelado): se destaca como corte del recorrido. */
  negative: boolean;
}

const isNegative = (phase: string) => phase === 'rejected' || phase === 'cancelled';

/**
 * Fases visibles. La fase ACTUAL es la de `publicStatus` (viene de `orders.status`, no del último evento). Las anteriores son
 * `done` (con hora) o `skipped` (sin hora). Las posteriores son `pending` sin hora. Si el pedido está terminado con éxito todas son
 * `done`; rechazado/cancelado cortan el recorrido: no se muestra ninguna etapa futura. `steps` vacío o incompleto se tolera.
 */
export function buildPhaseViews(
  tracking: Pick<OrderTracking, 'steps' | 'publicStatus' | 'terminal'>,
): PhaseView[] {
  const steps: readonly OrderTrackingStep[] = tracking.steps ?? [];
  const currentIndex = steps.findIndex((s) => s.phase === tracking.publicStatus);
  const cut = isNegative(tracking.publicStatus);
  const views: PhaseView[] = [];
  steps.forEach((step, index) => {
    const reached = step.reachedAt !== null && step.reachedAt !== undefined;
    let state: PhaseState;
    if (currentIndex === -1) state = reached ? 'done' : 'pending';
    else if (index < currentIndex) state = reached ? 'done' : 'skipped';
    else if (index === currentIndex) {
      state = tracking.terminal && tracking.publicStatus === 'completed' ? 'done' : 'current';
    } else state = 'pending';
    // Recorrido cortado: solo lo alcanzado y la fase terminal (ni futuras ni «fantasma» sin hora).
    if (cut && state !== 'current' && !reached) return;
    views.push({
      phase: step.phase,
      state,
      reachedAt: state === 'pending' || state === 'skipped' ? null : (step.reachedAt ?? null),
      negative: isNegative(step.phase),
    });
  });
  return views;
}

/** ¿El historial muestra la fase `accepted`? (solo informativo para pruebas: la web jamás afirma «aceptado» sin que el servidor lo diga). */
export const hasEventFor = (events: readonly OrderTrackingEvent[], phase: string) =>
  events.some((e) => e.publicStatus === phase);
