'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useDeleteBanner } from '@/features/banners/hooks';
import { ConfirmModal } from '@/features/bo-admin/components/ConfirmModal';
import { queryKeys } from '@/features/query-keys';
import type { AdminBanner } from '@/lib/data-access/models';
import { bannerServerError } from '../banners-view';

/**
 * Confirmación de ELIMINAR un banner (F16 simplificado): borrado físico con `expectedVersion` (409 `BANNER_VERSION_CONFLICT` =>
 * se refresca la lista y se avisa). Muestra el error del servidor sin cerrarse (salvo que el banner ya no exista).
 */
export function DeleteBannerModal({
  banner,
  onClose,
  onDeleted,
}: {
  banner: AdminBanner;
  onClose: () => void;
  /** Tras borrar: el foco inicial del diálogo (la fila) ya no existe; la pantalla lo mueve a un elemento estable. */
  onDeleted?: () => void;
}) {
  const t = useTranslations('backoffice.banners.deleteDialog');
  const toast = useToast();
  const qc = useQueryClient();
  const remove = useDeleteBanner();
  const [error, setError] = useState<string | undefined>();

  const confirm = () => {
    setError(undefined);
    remove.mutate(
      { id: banner.id, expectedVersion: banner.version },
      {
        onSuccess: () => {
          toast.notify(t('done'));
          onClose();
          onDeleted?.();
        },
        onError: (e) => {
          const parsed = bannerServerError(e);
          if (parsed.reload) void qc.invalidateQueries({ queryKey: queryKeys.backoffice.banners });
          if (parsed.kind === 'notFound') {
            toast.notify(parsed.message);
            onClose();
            return;
          }
          setError(parsed.message);
        },
      },
    );
  };

  return (
    <ConfirmModal
      title={t('title')}
      description={banner.imageAlt}
      danger
      initialFocus="cancel"
      confirmLabel={t('confirm')}
      cancelLabel={t('cancel')}
      pendingLabel={t('working')}
      pending={remove.isPending}
      error={error}
      onConfirm={confirm}
      onClose={onClose}
    >
      {t('text')}
    </ConfirmModal>
  );
}
