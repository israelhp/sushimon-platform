'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useFavoritesApi, useIsFavoritePending } from '../favorites-provider';

/**
 * "Quitar" de las filas de Mis favoritos sin tarjeta de producto (no disponible, retirado o sin detalles). Usa la misma
 * mutación que el corazón (optimista, sin doble envío). El nombre accesible EMPIEZA con el texto visible ("Quitar").
 */
export function RemoveFavoriteButton({ productId, name }: { productId: string; name: string }) {
  const t = useTranslations('fav');
  const { toggle } = useFavoritesApi();
  const busy = useIsFavoritePending(productId);
  return (
    <button
      type="button"
      aria-label={t('remove', { a: name })}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) toggle({ productId, favorite: false, name });
      }}
      className="btn !min-h-[44px] flex-none !px-3 text-sm"
    >
      <Trash2 className="h-4 w-4" aria-hidden="true" /> {t('removeBtn')}
    </button>
  );
}
