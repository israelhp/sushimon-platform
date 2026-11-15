import type { DeliveryCoverageCheckResponse } from '@/lib/data-access/models';

/**
 * Lectura de la respuesta de `checkDeliveryCoverage` para la TIENDA (F09). La elegibilidad (`CONFIRMED | PENDING |
 * NONE`) y la tarifa propia las deriva el SERVIDOR: aquí solo se traduce a un resultado de presentación y se elige la
 * sucursal (la de menor tarifa propia confirmada). No se recalcula cobertura, no se decide el precio y no se muestran
 * `integrationStatus`/`reason` crudos al cliente.
 */
export type CoverageOutcome =
  /** Hay un proveedor confirmado. `fee` es el `baseFee` PROPIO del servidor (string GTQ) o null si solo confirma PedidosYa. */
  | {
      kind: 'confirmed';
      branchId: string;
      provider: 'OWN' | 'PEDIDOSYA';
      fee: string | null;
      /** El dato de PedidosYa viene de un adaptador MOCK: es una simulación, nunca disponibilidad real. */
      simulated: boolean;
    }
  /** Sin confirmados pero PedidosYa `UNKNOWN`: NO es «sin cobertura» ni «cubierto». */
  | { kind: 'pending'; branchId: string; simulated: boolean }
  | { kind: 'none'; branchId: string };

export function outcomeOf(response: DeliveryCoverageCheckResponse): CoverageOutcome {
  const { eligibility, providers, branchId } = response;
  if (eligibility.status === 'CONFIRMED') {
    const own = eligibility.confirmedProviders.includes('OWN');
    return {
      kind: 'confirmed',
      branchId,
      provider: own ? 'OWN' : 'PEDIDOSYA',
      fee: own ? providers.OWN.baseFee : null,
      simulated: eligibility.simulated,
    };
  }
  if (eligibility.status === 'PENDING') {
    return { kind: 'pending', branchId, simulated: eligibility.simulated };
  }
  return { kind: 'none', branchId };
}

const cents = (amount: string) => {
  const [whole = '0', frac = ''] = amount.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
};

/** Compara importes decimales exactos (string) sin pasar por `number` de punto flotante. */
export const compareFee = (a: string, b: string) => cents(a) - cents(b);

const rank = (o: CoverageOutcome) =>
  o.kind === 'confirmed' ? (o.provider === 'OWN' ? 0 : 1) : o.kind === 'pending' ? 2 : 3;

/**
 * Mejor resultado entre sucursales: propio confirmado más barato > confirmado solo por PedidosYa > pendiente > nada.
 * Con empate gana la sucursal que aparece primero (orden estable de la lista pública).
 */
export function bestOutcome(outcomes: readonly CoverageOutcome[]): CoverageOutcome | null {
  let best: CoverageOutcome | null = null;
  for (const o of outcomes) {
    if (!best) {
      best = o;
      continue;
    }
    const d = rank(o) - rank(best);
    if (d < 0) best = o;
    else if (
      d === 0 &&
      o.kind === 'confirmed' &&
      best.kind === 'confirmed' &&
      o.fee !== null &&
      best.fee !== null &&
      compareFee(o.fee, best.fee) < 0
    ) {
      best = o;
    }
  }
  return best;
}

/** `Q15.00` a partir del string decimal del servidor (sin `number`). */
export { formatMoneyGtq } from '@/lib/delivery-zone';
