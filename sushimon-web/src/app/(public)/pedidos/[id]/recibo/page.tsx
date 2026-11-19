import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReceiptScreen } from '@/features/orders/receipt/receipt-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('receipt');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * F23 — Recibo NO fiscal imprimible `/pedidos/[id]/recibo` (`noindex`). Sirve al dueño (sesión) y al invitado con la credencial
 * guardada en `sessionStorage` (nunca en la URL). El `key` evita mezclar datos si se navega de un pedido a otro.
 */
export default async function OrderReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = decodeURIComponent(id);
  return <ReceiptScreen key={orderId} orderId={orderId} />;
}
