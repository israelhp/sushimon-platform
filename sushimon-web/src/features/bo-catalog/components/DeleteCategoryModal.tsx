'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useDeleteCategory, useUpdateCategory } from '@/features/categories/hooks';
import { ConfirmModal } from '@/features/bo-admin/components/ConfirmModal';
import { queryKeys } from '@/features/query-keys';
import type { AdminCategory, CategoryUsage } from '@/lib/data-access/models';
import { categoryServerError } from '../categories-view';

/**
 * Confirmación de ELIMINAR una categoría (ADR-0034): borrado físico y permanente, solo si no tiene subcategorías, productos ni
 * banners. El foco inicial va a «Cancelar». Si el servidor responde 409 `CATEGORY_IN_USE` el diálogo NO se cierra: explica con los
 * conteos de `usage` qué la usa y ofrece «Desactivar en su lugar» (misma mutación que la pantalla). 404 => se avisa y se cierra
 * (la lista ya se recarga). El resto de errores (401, 403, 503 `CATEGORIES_BUSY`…) se muestran en el diálogo y se puede reintentar.
 */
export function DeleteCategoryModal({
  category,
  onClose,
  onDone,
}: {
  category: AdminCategory;
  onClose: () => void;
  /** Tras eliminar o desactivar: el foco inicial (la fila) ya no existe o cambió; la pantalla lo mueve a un elemento estable. */
  onDone?: () => void;
}) {
  const t = useTranslations('backoffice.categories');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const remove = useDeleteCategory();
  const deactivate = useUpdateCategory();
  const [error, setError] = useState<string | undefined>();
  const [usage, setUsage] = useState<CategoryUsage | null>(null);
  const [conflict, setConflict] = useState(false);

  const fail = (e: unknown) => {
    const parsed = categoryServerError(e);
    if (parsed.reload) void qc.invalidateQueries({ queryKey: queryKeys.categories.all });
    if (parsed.kind === 'notFound') {
      toast.notify(parsed.message);
      onClose();
      onDone?.();
      return;
    }
    setConflict(parsed.kind === 'inUse');
    if (parsed.kind === 'inUse') setUsage(parsed.usage ?? null);
    // En uso: el propio diálogo explica con conteos (alerta propia); el resto va en la alerta de `ConfirmModal`.
    setError(parsed.kind === 'inUse' ? undefined : parsed.message);
  };

  const confirm = () => {
    setError(undefined);
    remove.mutate(category.id, {
      onSuccess: () => {
        toast.notify(t('deleteDialog.done', { name: category.name }));
        onClose();
        onDone?.();
      },
      onError: fail,
    });
  };

  const switchToDeactivate = () => {
    setError(undefined);
    deactivate.mutate(
      { id: category.id, input: { active: false } },
      {
        onSuccess: () => {
          toast.notify(t('toastDeactivated', { name: category.name }));
          onClose();
          onDone?.();
        },
        onError: fail,
      },
    );
  };

  const parts = usage
    ? [
        usage.children > 0 && t('deleteDialog.usageChildren', { count: usage.children }),
        usage.products > 0 && t('deleteDialog.usageProducts', { count: usage.products }),
        usage.banners > 0 && t('deleteDialog.usageBanners', { count: usage.banners }),
      ].filter((p): p is string => typeof p === 'string')
    : [];
  const usageText = parts.length
    ? new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts)
    : '';
  const pending = remove.isPending || deactivate.isPending;

  return (
    <ConfirmModal
      title={t('deleteDialog.title', { name: category.name })}
      description={category.slug}
      danger
      initialFocus="cancel"
      confirmLabel={t('deleteDialog.confirm')}
      cancelLabel={t('deleteDialog.cancel')}
      pendingLabel={t('deleteDialog.working')}
      pending={pending}
      error={error}
      onConfirm={confirm}
      onClose={onClose}
    >
      <p>{t('deleteDialog.text', { name: category.name })}</p>
      <p style={{ marginTop: 8 }}>{t('deleteDialog.rules')}</p>
      {conflict ? (
        <div style={{ marginTop: 8 }}>
          <p role="alert">
            {usageText
              ? t('deleteDialog.inUse', { name: category.name, usage: usageText })
              : t('deleteDialog.inUseGeneric', { name: category.name })}
          </p>
          <p style={{ marginTop: 4 }}>{t('deleteDialog.inUseHint')}</p>
          {category.active ? (
            <button
              type="button"
              className="btn"
              style={{ marginTop: 8 }}
              disabled={pending}
              onClick={switchToDeactivate}
            >
              {deactivate.isPending
                ? t('deleteDialog.deactivating')
                : t('deleteDialog.deactivateInstead')}
            </button>
          ) : null}
        </div>
      ) : null}
    </ConfirmModal>
  );
}
