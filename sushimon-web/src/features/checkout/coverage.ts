import type { Branch, DeliveryTierId } from '@/lib/data-access/models';

/**
 * Cobertura de envío para mostrar insignias en direcciones guardadas ("Con envío desde Sucursal 1").
 * Es solo orientativa: la tarifa y la sucursal definitivas las devuelve la cotización del servidor.
 */
const TIER_RANK: Record<DeliveryTierId, number> = { near: 0, mid: 1, extended: 2, far: 3 };

export function coveringBranch(
  branches: readonly Branch[],
  address: { department: string; municipality: string; zone: string },
): Branch | null {
  const zone = address.zone.trim() ? String(Number(address.zone)) : '';
  let best: { branch: Branch; rank: number } | null = null;
  for (const branch of branches) {
    if (branch.status !== 'active') continue;
    for (const rule of branch.coverage) {
      if (rule.department !== address.department || rule.municipality !== address.municipality) {
        continue;
      }
      if (rule.zone !== null && String(Number(rule.zone)) !== zone) continue;
      const rank = TIER_RANK[rule.tier];
      if (!best || rank < best.rank) best = { branch, rank };
    }
  }
  return best?.branch ?? null;
}
