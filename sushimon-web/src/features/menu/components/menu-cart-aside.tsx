'use client';

import { useTranslations } from 'next-intl';
import { CartFooter, CartPanelBody } from '@/features/cart/components/CartPanel';
import { useCart } from '@/features/cart/cart-context';
import { useCartView } from '@/features/cart/use-cart-view';
import { useMediaQuery } from '@/hooks/use-media-query';
import { OrderModeButton } from '@/features/store-shell/components/OrderModeButton';

/**
 * Panel "Tu pedido" fijo a la derecha del menú en escritorio (lg): misma fuente de verdad que el cajón (`useCartView`). El cuerpo
 * (y su revalidación) SOLO se monta cuando la pantalla es `lg`: en móvil y tablet el CSS lo escondería pero seguiría consultando.
 * En esos tamaños la revalidación ocurre al abrir el cajón. Las cifras son provisionales.
 */
export function MenuCartAside() {
  const t = useTranslations();
  const desktop = useMediaQuery('(min-width: 1024px)');
  return (
    <aside className="hidden lg:block" aria-label={t('cart.title')}>
      <div className="sticky top-[72px] flex h-[calc(100vh-72px)] flex-col border-l border-line bg-bg">
        <h2 className="disp border-b border-line bg-surface px-5 py-3.5 text-[24px]">
          {t('cart.title')}
        </h2>
        {desktop ? <AsideBody /> : null}
      </div>
    </aside>
  );
}

function AsideBody() {
  const t = useTranslations();
  const cart = useCart();
  const view = useCartView({ enabled: cart.lines.length > 0 });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-dashed border-line bg-surface px-5 py-2.5">
        <span className="text-[13px] font-bold text-muted">{t('cart.delivery')}</span>
        <OrderModeButton />
      </div>
      <CartPanelBody view={view} emptyAction={false} />
      {cart.lines.length > 0 ? (
        <div className="border-t border-line bg-surface px-5 pb-4 pt-3.5">
          <CartFooter view={view} units={cart.count} showKeepShopping={false} />
        </div>
      ) : null}
    </div>
  );
}
