'use client';

import { useTranslations } from 'next-intl';
import type { Address } from '@/lib/data-access/models';
import { requiresZone } from '@/features/order-mode/draft';
import { useBranches, useDeliveryQuote } from '@/features/store/hooks';

/**
 * Cobertura de envío de una dirección ("Con envío desde Sucursal 1" / "Sin cobertura"), calculada con
 * la estimación de envío del servidor. Mientras no hay datos suficientes (o carga), no muestra nada.
 */
export function CoverageChip({
  address,
}: {
  address: Pick<Address, 'department' | 'municipality' | 'zone'>;
}) {
  const t = useTranslations('addr');
  // Sin municipio, o sin zona en la Ciudad de Guatemala, no hay tarifa posible: sin cobertura (como el prototipo).
  const incomplete =
    !address.department ||
    !address.municipality ||
    (requiresZone(address.department, address.municipality) && !address.zone);
  const quote = useDeliveryQuote(
    !incomplete
      ? {
          department: address.department,
          municipality: address.municipality,
          zone: address.zone || undefined,
        }
      : null,
  );
  const branches = useBranches();
  if (!incomplete && !quote.data) return null;
  if (incomplete || !quote.data?.covered) {
    return (
      <span className="inline-flex items-center rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] font-extrabold text-danger">
        {t('notCovered')}
      </span>
    );
  }
  const branch = branches.data?.find((b) => b.id === quote.data?.branchId);
  return (
    <span className="inline-flex items-center rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] font-extrabold text-success">
      {t('covered', { a: branch?.name ?? quote.data?.branchId ?? '' })}
    </span>
  );
}
