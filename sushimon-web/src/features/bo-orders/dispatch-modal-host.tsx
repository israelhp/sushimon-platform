'use client';

import { useTranslations } from 'next-intl';
import { IconBike } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { SimulationBadge } from '@/components/ui/SimulationBadge';

/**
 * STUB del modal "Despachar pedido". Sustituir el cuerpo por el flujo real (elegir PedidosYa o repartidor
 * propio → cotización → asignación) en el bloque de Entregas; mantener la firma `{ orderId, onClose }`.
 * Mientras tanto deja un TODO visible y no solicita ningún repartidor (ni siquiera simulado).
 */
export function DispatchModalHost({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const t = useTranslations('backoffice.orders');
  return (
    <Modal
      open
      zone="bo"
      size="narrow"
      iconTone="blue"
      icon={<IconBike />}
      title={t('actions.dispatch')}
      description={`#${orderId}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('reject.back')}
        </button>
      }
    >
      <Banner zone="bo" tone="warning" role="status">
        {t('actions.dispatchTodo')}
      </Banner>
      <div className="mt8">
        <SimulationBadge kind="simulation" zone="bo" />
      </div>
    </Modal>
  );
}
