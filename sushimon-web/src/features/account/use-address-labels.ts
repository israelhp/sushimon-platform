import { useTranslations } from 'next-intl';
import type { Address } from '@/lib/data-access/models';

/** Etiquetas traducidas de tipo de dirección (Casa, Trabajo, Otra). */
export function useAddressLabels(): Record<Address['label'], string> {
  const t = useTranslations('addr.labels');
  return { home: t('home'), work: t('work'), other: t('other') };
}
