'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useRef } from 'react';
import { useToast } from '@/components/ui/Toast';
import type {
  AdminOrderActionState,
  AdminOrderPendingAction,
  AdminOrderSummary,
} from '@/lib/data-access/models';
import {
  ACTION_COMMAND,
  classifyCommandError,
  outcomeOf,
  type CommandError,
  type CommandOutcome,
} from './admin-orders-model';
import { useAdminOrderCommand } from './hooks';

export type ActionResult =
  { ok: true; outcome: CommandOutcome } | { ok: false; error: CommandError; text: string };

const RETRY_MIN_S = 1;
const RETRY_MAX_S = 120;
const clampSeconds = (s: number | null) =>
  Math.min(RETRY_MAX_S, Math.max(RETRY_MIN_S, Math.round(s ?? 5)));

/**
 * F22 (spec 023 §10.5) — Ejecuta un comando y lo explica con claridad. SIN actualización optimista: nada se da por hecho hasta que
 * la API responde; un fallo de red NO se presenta como un estado de negocio (no sabemos si se aplicó). Tras 409/422/404 la vista se
 * refresca sola (invalidación) y NUNCA se reintenta automáticamente. Anti doble clic por solicitud en vuelo (además del CAS).
 */
export function useAdminOrderActions() {
  const t = useTranslations('backoffice.orders.live');
  const toast = useToast();
  const mutation = useAdminOrderCommand();
  const busy = useRef(false);

  const explain = useCallback(
    (error: CommandError, order: Pick<AdminOrderSummary, 'displayNumber'>) => {
      const code = order.displayNumber;
      switch (error.kind) {
        case 'conflict':
          return error.currentStatus
            ? t('toast.conflict', { code, status: t(`status.${error.currentStatus}`) })
            : t('toast.conflictUnknown', { code });
        case 'invalid':
          return error.violation &&
            [
              'ORDER_TERMINAL',
              'ORDER_FULFILLMENT_MISMATCH',
              'ORDER_SOURCE_INVALID',
              'ORDER_DISPATCH_NOT_AVAILABLE',
              'ORDER_PROVIDER_BLOCKED_EXTERNAL',
              'ORDER_CANCEL_NOT_ALLOWED',
            ].includes(error.violation)
            ? t(`toast.invalid.${error.violation as 'ORDER_TERMINAL'}`)
            : t('toast.invalid.default');
        case 'forbidden':
          return t('toast.forbidden');
        case 'mfa':
          return t('toast.mfa');
        case 'auth':
          return t('toast.auth');
        case 'notFound':
          return t('toast.notFound');
        case 'reason':
          return t('toast.reason');
        case 'rate':
          return t('toast.rate', { seconds: clampSeconds(error.retryAfterSec) });
        case 'busy':
          return t('toast.busy', { seconds: clampSeconds(error.retryAfterSec) });
        case 'network':
          return t('toast.network', { code });
        default:
          return t('toast.unknown');
      }
    },
    [t],
  );

  const pendingText = useCallback(
    (pending: readonly AdminOrderPendingAction[]) =>
      pending.map((p) => t(`pending.${p}`)).join(' '),
    [t],
  );

  const run = useCallback(
    async (
      order: Pick<AdminOrderSummary, 'id' | 'status' | 'displayNumber'>,
      action: AdminOrderActionState['action'],
      reason?: string,
    ): Promise<ActionResult> => {
      const command = ACTION_COMMAND[action];
      if (!command || busy.current) {
        return { ok: false, error: classifyCommandError(new Error('sin comando')), text: '' };
      }
      busy.current = true;
      try {
        const result = await mutation.mutateAsync({
          id: order.id,
          command,
          expectedStatus: order.status,
          reason,
        });
        const outcome = outcomeOf(result);
        const code = order.displayNumber;
        const status = t(`status.${outcome.to}`);
        const note = pendingText(outcome.pending);
        if (outcome.kind === 'replayed') {
          toast.notify(
            [
              outcome.byMe ? t('toast.replayedMine') : t('toast.replayedOther', { code, status }),
              note,
            ]
              .filter(Boolean)
              .join(' '),
          );
        } else {
          toast.notify([t('toast.done', { code, status }), note].filter(Boolean).join(' '));
        }
        return { ok: true, outcome };
      } catch (e) {
        const error = classifyCommandError(e);
        const text = explain(error, order);
        toast.notify(text, { tone: 'warn' });
        return { ok: false, error, text };
      } finally {
        busy.current = false;
      }
    },
    [mutation, t, toast, explain, pendingText],
  );

  return {
    run,
    /** Hay una solicitud en vuelo de ESTE observador (botones deshabilitados y `aria-busy`). */
    pending: mutation.isPending,
    pendingId: mutation.isPending ? mutation.variables?.id : undefined,
  };
}
