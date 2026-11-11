import { ActionCards } from '@/features/home/components/action-cards';
import { FavoritesSection, HomeFootnote } from '@/features/home/components/favorites-section';
import { HomeHero } from '@/features/home/components/home-hero';
import { JobsBanner } from '@/features/home/components/jobs-banner';
import { ActiveOrderBanner, LastOrderCard } from '@/features/home/components/orders-section';
import { PromoCarousel } from '@/features/home/components/promo-carousel';

/**
 * Inicio de la tienda (como el prototipo): bienvenida, carrusel de promociones, acciones
 * ("¿Tenés hambre?"), pedido en curso, último pedido, favoritos y banda de empleo.
 * Los datos salen de los hooks de `features/*` (mock o http según la fuente configurada).
 */
export default function PublicHome() {
  return (
    <>
      <HomeHero />
      <div className="wrap flex flex-col gap-4 pt-4 short:gap-3 short:pt-3 sm:gap-6 sm:pt-6">
        <PromoCarousel />
        <ActionCards />
        <ActiveOrderBanner />
        <LastOrderCard />
        <FavoritesSection />
        <JobsBanner />
        <HomeFootnote />
      </div>
    </>
  );
}
