import type { BranchAvailability } from '@/lib/data-access/models';

/**
 * Refetch programado de la disponibilidad (spec 007 D16): en lugar de sondear por segundo, se agenda UN temporizador en
 * `nextTransitionAt`. El retraso se calcula con las horas del SERVIDOR (`nextTransitionAt − serverTime`), así no depende
 * del reloj del dispositivo; se descuenta el tiempo ya transcurrido desde que llegó la respuesta.
 */
/** Margen tras la transición para que el servidor ya refleje el cambio. */
export const REFETCH_GRACE_MS = 1_000;
/** Tope: aunque la transición sea lejana se refresca (cierres creados o editados por otros). */
export const MAX_REFETCH_DELAY_MS = 10 * 60_000;
/** Piso: evita bucles si el servidor devolviera una transición ya vencida. */
export const MIN_REFETCH_DELAY_MS = 1_000;

export function nextRefetchDelay(
  availability: Pick<BranchAvailability, 'serverTime' | 'nextTransitionAt'> | undefined,
  elapsedMs: number,
): number | null {
  if (!availability?.nextTransitionAt) return null;
  const untilTransition =
    new Date(availability.nextTransitionAt).getTime() - new Date(availability.serverTime).getTime();
  if (!Number.isFinite(untilTransition)) return null;
  const delay = untilTransition + REFETCH_GRACE_MS - Math.max(0, elapsedMs);
  return Math.min(MAX_REFETCH_DELAY_MS, Math.max(MIN_REFETCH_DELAY_MS, delay));
}
