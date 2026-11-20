import { useTranslations } from 'next-intl';
import { IconCheck, IconClock } from '@/components/icons/bo';
import { cn } from '@/lib/cn';
import type { OrderPaymentStatus } from '@/lib/data-access/models';

/**
 * F24: insignia del estado de pago de un pedido (tablero y tabla). Ícono + texto (nunca solo color). Es INDEPENDIENTE del estado
 * del pedido. Tolera estados futuros del contrato mostrándolos como pendientes.
 */
export function PaymentBadge({
  status,
  className,
}: {
  status: OrderPaymentStatus;
  className?: string;
}) {
  const t = useTranslations('backoffice.orders.live.payment');
  const paid = status === 'PAID';
  return (
    <span
      className={cn('zone-tag row gap6', className)}
      data-payment-status={paid ? 'PAID' : 'PENDING'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      {paid ? <IconCheck size="sm" /> : <IconClock size="sm" />}
      {t(paid ? 'badge.PAID' : 'badge.PENDING')}
    </span>
  );
}
