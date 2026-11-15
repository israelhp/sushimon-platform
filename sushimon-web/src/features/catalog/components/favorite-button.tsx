'use client';

import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { memo, useState } from 'react';
import { cn } from '@/lib/cn';
import {
  useFavoritesApi,
  useIsFavorite,
  useIsFavoritePending,
} from '@/features/favorites/favorites-provider';

/**
 * Corazón de favorito (F06, spec 010 D17). Los favoritos pertenecen a la CUENTA del cliente y viven en el servidor:
 *  - visitante: no crea nada; abre el inicio de sesión (Google en producción, simulado en la demo) y, tras entrar, el
 *    cliente vuelve a tocar el corazón (sin escrituras ocultas ni favoritos locales de invitado);
 *  - cliente: alterna con actualización optimista y avisa con un toast; el estado de TODOS los corazones sale de UNA sola
 *    consulta compartida (`useFavoriteIds`), nunca una petición por tarjeta;
 *  - mientras se conoce el estado o hay una alta/baja de ese producto en vuelo queda `aria-busy` y no admite otro envío
 *    (`aria-disabled`, no `disabled`: conserva el foco).
 * Foco visible: `:focus-visible` global de la tienda (`styles/store.css`). Solo icono: el nombre accesible es la etiqueta "Agregar/Quitar {nombre} de favoritos".
 * `onTile`: sobre la ilustración (círculo blanco, como el prototipo).
 */
export const FavoriteButton = memo(function FavoriteButton({
  productId,
  name,
  onTile = false,
  size = 'sm',
  className,
}: {
  productId: string;
  name: string;
  onTile?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const t = useTranslations('fav');
  const api = useFavoritesApi();
  const active = useIsFavorite(productId);
  const pending = useIsFavoritePending(productId);
  const [beat, setBeat] = useState(0);
  const busy = api.isPending || pending;
  const label = active ? t('remove', { a: name }) : t('add', { a: name });

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={(event) => {
        event.stopPropagation();
        if (api.state === 'guest') {
          api.openLogin();
          return;
        }
        if (busy) return;
        if (api.isError) {
          // No se conoce el estado real: reintentar la lectura en vez de adivinar la acción.
          api.refetch();
          return;
        }
        if (api.toggle({ productId, favorite: !active, name })) setBeat((n) => n + 1);
      }}
      className={cn(
        'inline-flex flex-none items-center justify-center rounded-full transition-colors',
        size === 'md' ? 'h-11 w-11' : 'h-9 w-9',
        onTile
          ? 'bg-white/95 text-neutral-900 shadow-card hover:bg-white'
          : 'text-muted hover:bg-subtle hover:text-primary',
        active && '!text-primary',
        busy && 'cursor-progress opacity-60',
        className,
      )}
    >
      <Heart
        key={beat}
        className={cn(
          size === 'md' ? 'h-[22px] w-[22px]' : 'h-[18px] w-[18px]',
          beat && 'anim-heart',
        )}
        fill={active ? 'currentColor' : 'none'}
        strokeWidth={2.2}
        aria-hidden="true"
      />
    </button>
  );
});
