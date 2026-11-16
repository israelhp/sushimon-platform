'use client';

import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { ProductBranchesSection } from './ProductBranchesSection';

/** Hoja «Sucursales» de un producto: no exige `catalog.update` (un encargado puede marcar agotados en su sucursal). */
export function ProductBranchesModal({
  productId,
  productName,
  onClose,
}: {
  productId: string;
  productName: string;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.branchProducts');
  return (
    <Modal
      open
      zone="bo"
      size="wide"
      onClose={onClose}
      title={t('modalTitle', { name: productName })}
    >
      <ProductBranchesSection productId={productId} />
    </Modal>
  );
}
