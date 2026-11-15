'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { IconLock } from '@/components/icons/bo';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useToast } from '@/components/ui/Toast';
import { useResetStaffMfa } from '@/features/staff/hooks';
import type { AdminStaff } from '@/lib/data-access/models';
import { mfaResetErrorMessage } from '../users-view';
import { ConfirmModal } from './ConfirmModal';

/** Con datos simulados no se contacta a ningún proveedor de identidad: se rotula como simulación. */
const IS_DEMO_DATA = process.env.NEXT_PUBLIC_DATA_SOURCE !== 'http';

/**
 * Confirmación de «Restablecer MFA» (F02). El empleado deberá volver a enrolar su autenticador en su próximo acceso.
 * Muestra los errores del servidor sin cerrarse (mensajes de negocio; nunca el detalle del proveedor).
 */
export function StaffMfaResetModal({ staff, onClose }: { staff: AdminStaff; onClose: () => void }) {
  const t = useTranslations('backoffice.users.mfaReset');
  const toast = useToast();
  const mutation = useResetStaffMfa();
  const [error, setError] = useState('');

  const confirm = () => {
    if (mutation.isPending) return;
    setError('');
    mutation.mutate(staff.id, {
      onSuccess: () => {
        toast.notify(t(IS_DEMO_DATA ? 'toastDemo' : 'toast', { name: staff.fullName }));
        onClose();
      },
      onError: (err) => setError(mfaResetErrorMessage(err)),
    });
  };

  return (
    <ConfirmModal
      title={t('title')}
      description={staff.fullName}
      icon={<IconLock />}
      danger
      confirmLabel={t('confirm')}
      cancelLabel={t('cancel')}
      pendingLabel={t('pending')}
      pending={mutation.isPending}
      error={error || undefined}
      onConfirm={confirm}
      onClose={onClose}
    >
      <p style={{ margin: 0 }}>{t('text', { name: staff.fullName })}</p>
      <p style={{ margin: '8px 0 0' }}>{t('lastAdmin')}</p>
      {IS_DEMO_DATA ? (
        <p style={{ margin: '8px 0 0' }}>
          <SimulationBadge kind="simulation" zone="bo" /> {t('simulationNote')}
        </p>
      ) : null}
    </ConfirmModal>
  );
}
