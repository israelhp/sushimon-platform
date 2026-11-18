'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OrderCreated } from '@/lib/data-access/models';
import { confirmedOrderId } from '@/features/cart/confirmed-order';
import { useCartActions } from '@/features/cart/cart-context';
import { useCreateOrder } from '@/features/orders/hooks';
import { queryKeys } from '@/features/query-keys';
import { useCustomerScope } from '@/features/session/customer-scope';
import {
  attemptFor,
  buildOrderRequest,
  clearAttempt,
  intentFingerprint,
  type OrderIntent,
} from './order-attempt';
import { saveConfirmation } from './confirmation-store';
import {
  classifyPlaceError,
  discardsAttempt,
  isAutoRetryable,
  type PlaceFailure,
} from './place-order-errors';

/** Esperas (ms) de los reintentos automáticos con la MISMA clave: red caída, 5xx, `ORDERS_BUSY`, `IDEMPOTENCY_IN_PROGRESS`. */
export const AUTO_RETRY_DELAYS_MS: readonly number[] = [1000, 2500];

export type PlaceState =
  | { status: 'idle' }
  /** `retrying`: reintento automático con la misma clave («Comprobando tu pedido…»). */
  | { status: 'sending'; retrying: boolean }
  /** Respuesta 200/201 del servidor: el ÚNICO camino a «pedido recibido». */
  | { status: 'success'; created: OrderCreated; persisted: boolean }
  | { status: 'failed'; failure: PlaceFailure };

export interface PlaceOrderOptions {
  /**
   * `true` (API real): tras el éxito confirmado por el servidor se vacía el carrito con `clearAfterOrder`. `false` (mock con la
   * pasarela NeoNet simulada): el flujo simulado vacía el carrito por su cuenta con `clear()` cuando termina el pago.
   */
  clearCart: boolean;
  retryDelaysMs?: readonly number[];
  /** Se llama una vez tras el éxito (síncrono; no se espera). */
  onSuccess?: (created: OrderCreated) => void;
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/**
 * F20 — Confirmación del pedido (máquina de estados). Garantías:
 *  - UN solo envío en vuelo (ref síncrona: un segundo clic no emite petición).
 *  - La clave de idempotencia es la del intento lógico (`order-attempt.ts`): ante red caída/5xx/ocupado se reintenta con la MISMA.
 *  - «Éxito» solo con la respuesta del servidor; entonces (y solo entonces) se guarda la credencial de invitado, se vacía el
 *    carrito (`clearAfterOrder`, si `clearCart`) y se descarta el intento. Ante error o estado ambiguo el carrito NO se toca.
 *  - `QUOTE_CHANGED` no reenvía solo: exige `acceptChange()` (re-aceptación explícita) con la cotización y el token nuevos y una
 *    clave nueva. `QUOTE_EXPIRED`/`QUOTE_INVALID`/`IDEMPOTENCY_KEY_REUSED` descartan la clave (la pantalla recotiza).
 */
export function usePlaceOrder({
  clearCart,
  retryDelaysMs = AUTO_RETRY_DELAYS_MS,
  onSuccess,
}: PlaceOrderOptions) {
  const { create } = useCreateOrder();
  const cart = useCartActions();
  const qc = useQueryClient();
  const identity = useCustomerScope();
  const scope = identity.state === 'ready' ? identity.scope : null;
  const [state, setState] = useState<PlaceState>({ status: 'idle' });
  const inFlight = useRef(false);
  const stateRef = useRef<PlaceState>({ status: 'idle' });
  const last = useRef<{ intent: OrderIntent; token: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  // Los callbacks cambian en cada render: se leen por ref para que `place` sea estable.
  const live = useRef({ create, cart, qc, scope, clearCart, onSuccess, retryDelaysMs });
  useEffect(() => {
    live.current = { create, cart, qc, scope, clearCart, onSuccess, retryDelaysMs };
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      // Al salir del checkout sin un pedido en vuelo ni un resultado incierto se descarta el intento (solo guarda un resumen de
      // la huella, pero no hay por qué conservarlo). Con un resultado incierto (red/5xx/ocupado) se conserva la clave.
      const s = stateRef.current;
      const uncertain =
        s.status === 'failed' && (s.failure.kind === 'ambiguous' || s.failure.kind === 'busy');
      if (!inFlight.current && !uncertain) clearAttempt();
    };
  }, []);

  // Cerrar sesión o cambiar de cuenta cambia el ámbito: el intento anterior ya no aplica.
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current !== scope) {
      lastScope.current = scope;
      if (!inFlight.current) clearAttempt();
    }
  }, [scope]);

  const set = (next: PlaceState) => {
    stateRef.current = next;
    if (mounted.current) setState(next);
  };

  const place = useCallback(async (intent: OrderIntent, quoteToken: string): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    last.current = { intent, token: quoteToken };
    const ctl = new AbortController();
    controller.current = ctl;
    const { create: send, retryDelaysMs: delays } = live.current;
    set({ status: 'sending', retrying: false });
    try {
      const attempt = await attemptFor(intentFingerprint(intent));
      const body = buildOrderRequest(intent, quoteToken);
      for (let tries = 0; ; tries++) {
        try {
          const created = await send(body, attempt.key, ctl.signal);
          const id = confirmedOrderId(created);
          if (!id) {
            // 2xx sin un pedido válido: no se presenta como éxito ni se toca el carrito.
            set({ status: 'failed', failure: { kind: 'unknown' } });
            return;
          }
          const l = live.current;
          // `persisted=false`: sessionStorage no disponible; la credencial queda solo en memoria y la pantalla lo avisa.
          const persisted = saveConfirmation(created);
          l.qc.setQueryData(queryKeys.orders.placed(l.scope, created.order.id), created.order);
          clearAttempt();
          if (l.clearCart) l.cart.clearAfterOrder(id);
          set({ status: 'success', created, persisted });
          l.onSuccess?.(created);
          return;
        } catch (error) {
          if ((error as Error | undefined)?.name === 'AbortError') return;
          const failure = classifyPlaceError(error);
          const delay = delays[tries];
          if (isAutoRetryable(failure) && delay !== undefined) {
            set({ status: 'sending', retrying: true });
            await wait(delay, ctl.signal);
            continue;
          }
          if (discardsAttempt(failure)) clearAttempt();
          set({ status: 'failed', failure });
          return;
        }
      }
    } catch (error) {
      // Solo la espera abortada (desmontaje): la clave sigue guardada para un reintento posterior.
      if ((error as Error | undefined)?.name !== 'AbortError')
        set({ status: 'failed', failure: { kind: 'unknown' } });
    } finally {
      inFlight.current = false;
    }
  }, []);

  /** Reenvía lo mismo (misma clave si la huella no cambió): el botón «Reintentar». */
  const retry = useCallback(() => {
    const l = last.current;
    if (l) void place(l.intent, l.token);
  }, [place]);

  /** `QUOTE_CHANGED`: el cliente aceptó el nuevo total; se envía con el token nuevo y una clave nueva. */
  const acceptChange = useCallback(() => {
    const l = last.current;
    const current = stateRef.current;
    if (!l || current.status !== 'failed' || current.failure.kind !== 'quoteChanged') return;
    const token = current.failure.quote.quote.token;
    if (token) void place(l.intent, token);
  }, [place]);

  const reset = useCallback(() => {
    if (!inFlight.current) set({ status: 'idle' });
  }, []);

  return { state, place, retry, acceptChange, reset, busy: state.status === 'sending' };
}
