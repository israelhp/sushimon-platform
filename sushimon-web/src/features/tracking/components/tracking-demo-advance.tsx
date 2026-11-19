'use client';

import { useTranslations } from 'next-intl';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useAdvanceOrderDemo } from '@/features/orders/hooks';

/**
 * 🎭 SOLO mock: «Ver siguiente estado (simulación)». Avanza el pedido BORRADOR enlazado (`displayNumber`) y, al invalidar los
 * pedidos, el seguimiento real del mock (`GET /v1/orders/{id}/tracking`) refleja el nuevo historial. NUNCA se monta con la API real.
 */
export function TrackingDemoAdvance({
  displayNumber,
  onError,
}: {
  displayNumber: string;
  /** El error se ANUNCIA en la región `aria-live` única de la pantalla (además del texto visible). */
  onError?: () => void;
}) {
  const t = useTranslations('status');
  const tt = useTranslations('tracking');
  const advance = useAdvanceOrderDemo();
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-dashed border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="m-0 text-[12px] text-muted">
        <SimulationBadge kind="simulation" className="mr-1.5" />
        {t('demoNote')}
      </p>
      <div className="flex flex-col gap-2 sm:items-end">
        <button
          type="button"
          className="btn !min-h-[44px] !px-4 text-sm"
          // `aria-disabled` (no `disabled`): el botón conserva el foco mientras avanza (spec 022 §9.4: no se roba ni se pierde el foco).
          aria-disabled={advance.isPending || undefined}
          aria-busy={advance.isPending}
          onClick={() => {
            if (!advance.isPending) advance.mutate(displayNumber, { onError });
          }}
        >
          {t('nextDemo')}
        </button>
        {advance.isError ? (
          <p className="m-0 text-[13px] font-bold text-primary">{tt('advanceError')}</p>
        ) : null}
      </div>
    </div>
  );
}
