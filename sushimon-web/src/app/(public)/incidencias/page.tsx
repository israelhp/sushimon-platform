import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { IncidentsHub } from '@/features/incidents/components/incidents-hub';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('incidents');
  return { title: t('waTitle') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** "Hacer un reclamo": elige el pedido y abre WhatsApp con sus datos (como el prototipo). `?pedido=` lo destaca. */
export default async function IncidentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { pedido } = await searchParams;
  return <IncidentsHub highlightId={(Array.isArray(pedido) ? pedido[0] : pedido) ?? null} />;
}
