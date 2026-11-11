import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LookupForm } from '@/features/tracking/components/lookup-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('track');
  return { title: t('title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * Consulta de invitado: número de pedido + teléfono. `?pedido=` precarga el número (viene del seguimiento
 * al que no se tenía acceso, con `notfound=1`) y `?next=incidencia` continúa al reclamo.
 */
export default async function LookupPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <LookupForm
      initialOrderNumber={first(params.pedido) ?? ''}
      next={first(params.next)}
      notFound={first(params.notfound) === '1'}
    />
  );
}
