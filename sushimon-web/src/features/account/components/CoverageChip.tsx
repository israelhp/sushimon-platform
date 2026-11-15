'use client';

import { useTranslations } from 'next-intl';
import type { Address } from '@/lib/data-access/models';
import { useAddressCoverage } from '@/features/delivery-coverage/hooks';
import { usePublicBranches } from '@/features/branches/hooks';
import { requiresZone } from '@/features/order-mode/draft';

/**
 * Cobertura de una dirección guardada («Con envío desde Sucursal 1» / «Envío por confirmar» / «Sin cobertura»),
 * comprobada con `checkDeliveryCoverage` (la tarifa y la elegibilidad las deriva el servidor). Mientras no hay datos
 * suficientes (o carga) no muestra nada. «Por confirmar» NO es «sin cobertura»: PedidosYa no es verificable todavía.
 */
export function CoverageChip({
  address,
}: {
  address: Pick<Address, 'department' | 'municipality' | 'zone'>;
}) {
  const t = useTranslations('addr');
  const branches = usePublicBranches();
  // Sin municipio, o sin zona en la Ciudad de Guatemala, la selección no está completa: sin cobertura (como el prototipo).
  const incomplete =
    !address.department ||
    !address.municipality ||
    (requiresZone(address.department, address.municipality) && !address.zone);
  const coverage = useAddressCoverage(
    address,
    (branches.data ?? []).map((b) => b.id),
    !incomplete && !!branches.data,
  );
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-extrabold';
  if (incomplete) {
    return <span className={`${base} bg-danger-soft text-danger`}>{t('notCovered')}</span>;
  }
  const best = coverage.best;
  if (coverage.state !== 'ready' || !best) return null;
  if (best.kind === 'confirmed' && best.provider === 'OWN') {
    const name = branches.data?.find((b) => b.id === best.branchId)?.name ?? best.branchId;
    return (
      <span className={`${base} bg-success-soft text-success`}>{t('covered', { a: name })}</span>
    );
  }
  if (best.kind === 'none') {
    return <span className={`${base} bg-danger-soft text-danger`}>{t('notCovered')}</span>;
  }
  return <span className={`${base} bg-subtle text-muted`}>{t('pending')}</span>;
}
