import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OrderDetail } from '@/features/tracking/components/order-detail';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orders');
  return { title: t('order'), robots: { index: false } };
}

/**
 * Seguimiento y detalle del pedido. El número viaja en la ruta; que esta sesión pueda verlo lo decide la
 * API (con datos mock, el adaptador imita ese 404). Sin acceso, lleva a `/consultar`.
 */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetail orderId={decodeURIComponent(id)} />;
}
