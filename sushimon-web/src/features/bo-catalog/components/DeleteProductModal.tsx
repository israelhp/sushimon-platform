'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/features/bo-admin/components/ConfirmModal';
import { useDeleteProduct, useUpdateProduct } from '@/features/products/hooks';
import { queryKeys } from '@/features/query-keys';
import type { AdminProduct, ProductUsage } from '@/lib/data-access/models';
import { productServerError } from '../products-view';

/**
 * Confirmación de ELIMINAR un producto (ADR-0035): borrado físico y permanente, solo si no tiene pedidos, promociones ni banners.
 * El foco inicial va a «Cancelar». Si el servidor responde 409 `PRODUCT_IN_USE` el diálogo NO se cierra: explica con los conteos de
 * `usage` qué lo usa y guía (pedidos => «Desactivar en su lugar», misma mutación que la pantalla; promociones y banners => quitarlo
 * de ellos). 404 => se avisa y se cierra (la lista ya se recarga). El resto de errores (401, 403, 503 `PRODUCTS_BUSY`…) se muestran
 * en el diálogo y se puede reintentar.
 */
export function DeleteProductModal({
  product,
  onClose,
  onDone,
}: {
  product: AdminProduct;
  onClose: () => void;
  /** Tras eliminar, desactivar o 404: el foco inicial (la tarjeta) ya no existe; la pantalla lo mueve a un elemento estable. */
  onDone?: () => void;
}) {
  const t = useTranslations('backoffice.products');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const remove = useDeleteProduct();
  const deactivate = useUpdateProduct();
  const [error, setError] = useState<string | undefined>();
  const [usage, setUsage] = useState<ProductUsage | null>(null);
  const [conflict, setConflict] = useState(false);

  const fail = (e: unknown) => {
    const parsed = productServerError(e);
    if (parsed.reload) void qc.invalidateQueries({ queryKey: queryKeys.products.all });
    if (parsed.kind === 'notFound') {
      toast.notify(t('deleteDialog.gone'));
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
    remove.mutate(product.id, {
      onSuccess: () => {
        toast.notify(t('deleteDialog.done', { name: product.name }));
        onClose();
        onDone?.();
      },
      onError: fail,
    });
  };

  const switchToDeactivate = () => {
    setError(undefined);
    deactivate.mutate(
      { id: product.id, input: { active: false } },
      {
        onSuccess: () => {
          toast.notify(t('toastDeactivated', { name: product.name }));
          onClose();
          onDone?.();
        },
        onError: fail,
      },
    );
  };

  const parts = usage
    ? [
        usage.orders > 0 && t('deleteDialog.usageOrders', { count: usage.orders }),
        usage.promotions > 0 && t('deleteDialog.usagePromotions', { count: usage.promotions }),
        usage.banners > 0 && t('deleteDialog.usageBanners', { count: usage.banners }),
      ].filter((p): p is string => typeof p === 'string')
    : [];
  const usageText = parts.length
    ? new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts)
    : '';
  const pending = remove.isPending || deactivate.isPending;

  return (
    <ConfirmModal
      title={t('deleteDialog.title', { name: product.name })}
      description={product.slug}
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
      <p>{t('deleteDialog.text', { name: product.name })}</p>
      <p style={{ marginTop: 8 }}>{t('deleteDialog.rules')}</p>
      {conflict ? (
        <div style={{ marginTop: 8 }}>
          <p role="alert">
            {usageText
              ? t('deleteDialog.inUse', { name: product.name, usage: usageText })
              : t('deleteDialog.inUseGeneric', { name: product.name })}
          </p>
          {usage && usage.orders > 0 ? (
            <p style={{ marginTop: 4 }}>{t('deleteDialog.hintOrders')}</p>
          ) : null}
          {usage && usage.promotions > 0 ? (
            <p style={{ marginTop: 4 }}>{t('deleteDialog.hintPromotions')}</p>
          ) : null}
          {usage && usage.banners > 0 ? (
            <p style={{ marginTop: 4 }}>{t('deleteDialog.hintBanners')}</p>
          ) : null}
          {usage && usage.orders > 0 && product.active ? (
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
