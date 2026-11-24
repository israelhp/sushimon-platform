'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useRef } from 'react';
import { useToast } from '@/components/ui/Toast';
import type { AdminDeliveryCommandResult } from '@/lib/data-access/models';
import {
  classifyDeliveryError,
  outcomeOf,
  type DeliveryError,
  type DeliveryOutcome,
  type OrderReason,
  type RiderReason,
  ORDER_REASONS,
  RIDER_REASONS,
} from './delivery-model';
import { useDeliveryCommand, type DeliveryCommandInput } from './hooks';

export type DeliveryActionResult =
  | { ok: true; outcome: DeliveryOutcome; result: AdminDeliveryCommandResult; text: string }
  | { ok: false; error: DeliveryError; text: string };

const RETRY_MIN_S = 1;
const RETRY_MAX_S = 120;
const clampSeconds = (s: number | null) =>
  Math.min(RETRY_MAX_S, Math.max(RETRY_MIN_S, Math.round(s ?? 5)));

/** Texto en español/inglés de un error del contrato de entregas (por `kind` y `code`, nunca por `message`). */
export function useDeliveryErrorText(): (error: DeliveryError, code?: string) => string {
  const t = useTranslations('backoffice.deliveries.fleet.errors');
  const ts = useTranslations('backoffice.deliveries.fleet.status');
  const to = useTranslations('backoffice.orders.live.status');
  return useCallback(
    (error, displayNumber = '') => {
      switch (error.kind) {
        case 'stateConflict':
          return error.current
            ? t('stateConflict', {
                code: displayNumber,
                status: ts(error.current.status),
              })
            : t('stateConflictUnknown', { code: displayNumber });
        case 'orderConflict':
          return error.currentOrder
            ? t('orderConflict', {
                code: displayNumber,
                status: to(error.currentOrder),
              })
            : t('orderConflictUnknown', { code: displayNumber });
        case 'hasActiveDelivery':
          return t('hasActiveDelivery', { code: displayNumber });
        case 'riderNotEligible': {
          const reasons = error.violations.filter((v): v is RiderReason =>
            (RIDER_REASONS as readonly string[]).includes(v),
          );
          return reasons.length > 0
            ? t('riderNotEligible', {
                reasons: reasons.map((r) => t(`riderReason.${r}`)).join(' · '),
              })
            : t('riderNotEligibleUnknown');
        }
        case 'orderNotEligible': {
          const reasons = error.violations.filter((v): v is OrderReason =>
            (ORDER_REASONS as readonly string[]).includes(v),
          );
          return reasons.length > 0
            ? t('orderNotEligible', {
                reasons: reasons.map((r) => t(`orderReason.${r}`)).join(' · '),
              })
            : t('orderNotEligibleUnknown');
        }
        case 'reasonRequired':
          return t('reasonRequired');
        case 'cursorInvalid':
          return t('cursorInvalid');
        case 'actionForbidden':
          return t('actionForbidden');
        case 'forbidden':
          return t('forbidden');
        case 'mfa':
          return t('mfa');
        case 'auth':
          return t('auth');
        case 'deliveryNotFound':
        case 'notFound':
          return t('deliveryNotFound');
        case 'riderNotFound':
          return t('riderNotFound');
        case 'orderNotFound':
          return t('orderNotFound');
        case 'rate':
          return t('rate', { seconds: clampSeconds(error.retryAfterSec) });
        case 'busy':
          return t('busy', { seconds: clampSeconds(error.retryAfterSec) });
        case 'network':
          return t('network', { code: displayNumber });
        case 'invalid':
          return t('invalid');
        default:
          return t('unknown');
      }
    },
    [t, ts, to],
  );
}

/**
 * Ejecuta un comando y lo explica con claridad (toast con `aria-live` + texto devuelto para dejarlo visible). SIN actualización
 * optimista; un fallo de red NO se presenta como un estado de negocio (no sabemos si se aplicó) y NUNCA se reintenta solo.
 * `replayed=true` ⇒ aviso «ya estaba hecho». Anti doble clic por solicitud en vuelo (además del `expectedVersion` del servidor).
 */
export function useDeliveryActions() {
  const t = useTranslations('backoffice.deliveries.fleet.toast');
  const ts = useTranslations('backoffice.deliveries.fleet.status');
  const toast = useToast();
  const mutation = useDeliveryCommand();
  const errorText = useDeliveryErrorText();
  const busy = useRef(false);

  const run = useCallback(
    async (input: DeliveryCommandInput, displayNumber: string): Promise<DeliveryActionResult> => {
      if (busy.current) {
        const error = classifyDeliveryError(new Error('en curso'));
        return { ok: false, error, text: '' };
      }
      busy.current = true;
      try {
        const result = await mutation.mutateAsync(input);
        const outcome = outcomeOf(result);
        const code = displayNumber || result.delivery.displayNumber;
        const text =
          outcome.kind === 'replayed'
            ? outcome.byMe
              ? t('replayedMine', { code })
              : t('replayedOther', { code, status: ts(outcome.status) })
            : t(`event.${outcome.event}`, { code });
        toast.notify(text);
        return { ok: true, outcome, result, text };
      } catch (e) {
        const error = classifyDeliveryError(e);
        const text = errorText(error, displayNumber);
        toast.notify(text, { tone: 'warn' });
        return { ok: false, error, text };
      } finally {
        busy.current = false;
      }
    },
    [mutation, t, ts, toast, errorText],
  );

  return {
    run,
    /** Hay una solicitud en vuelo de ESTE observador (botones deshabilitados y `aria-busy`). */
    pending: mutation.isPending,
  };
}
