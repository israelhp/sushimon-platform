'use client';

import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { useFavorites, useToggleFavorite } from '@/features/account/hooks';
import { useDemoSession } from '@/features/session/demo-session';
import { useAuthModal } from '@/features/store-shell/store-shell-context';

/**
 * Corazón de favorito. Los favoritos pertenecen a la cuenta: sin sesión de demostración abre el
 * inicio de sesión simulado; con sesión alterna (optimista) y avisa con un toast.
 * `onTile`: sobre la ilustración (círculo blanco, como el prototipo).
 */
export function FavoriteButton({
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
  const { customer } = useDemoSession();
  const favorites = useFavorites();
  const toggle = useToggleFavorite();
  const auth = useAuthModal();
  const { notify } = useToast();
  const [beat, setBeat] = useState(0);
  const active = !!customer && (favorites.data ?? []).includes(productId);
  const label = active ? t('remove', { a: name }) : t('add', { a: name });

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        if (!customer) {
          auth.open();
          return;
        }
        setBeat((n) => n + 1);
        toggle.mutate(
          { productId, favorite: !active },
          {
            onSuccess: () => notify(!active ? t('added', { a: name }) : t('removed', { a: name })),
            onError: () => notify(t('error')),
          },
        );
      }}
      className={cn(
        'inline-flex flex-none items-center justify-center rounded-full transition-colors',
        size === 'md' ? 'h-11 w-11' : 'h-9 w-9',
        onTile
          ? 'bg-white/95 text-neutral-900 shadow-card hover:bg-white'
          : 'text-muted hover:bg-subtle hover:text-primary',
        active && '!text-primary',
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
}
