import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OrderTrackingScreen } from '@/features/tracking/components/order-tracking-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tracking');
  return { title: t('pageTitle'), robots: { index: false } };
}

/**
 * F21 — Seguimiento del pedido (canónico). `/pedidos/[id]` conserva la confirmación/detalle de F20 sin polling. El invitado accede
 * con la credencial guardada en `sessionStorage` (nunca en la URL); sin ella ni sesión ve «se perdió el acceso». El `key` evita
 * mezclar datos si el cliente navega de un pedido a otro.
 */
export default async function OrderTrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = decodeURIComponent(id);
  return <OrderTrackingScreen key={orderId} orderId={orderId} />;
}
