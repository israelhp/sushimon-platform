import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { IncidentForm } from '@/features/incidents/components/incident-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('incidents');
  return { title: t('title'), robots: { index: false } };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Reclamo en la app (con `POST /v1/incidents`), complemento del reclamo por WhatsApp del prototipo.
 * `?pedido=` fija el pedido; sin él se elige entre los pedidos recientes.
 */
export default async function NewIncidentPage({ searchParams }: { searchParams: SearchParams }) {
  const { pedido } = await searchParams;
  return <IncidentForm orderId={(Array.isArray(pedido) ? pedido[0] : pedido) ?? null} />;
}
