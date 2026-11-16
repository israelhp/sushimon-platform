'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PublicCategory } from '@/lib/data-access/models';

/**
 * Nombre visible de una categoría. Los nombres del contrato son del restaurante (un solo idioma, F10): en inglés se usa,
 * si existe, la traducción puente `menu.categoryNames.<slug>`; si no, el nombre tal cual.
 */
export function useCategoryLabel(): (category: Pick<PublicCategory, 'slug' | 'name'>) => string {
  // Claves dinámicas (por slug): no existen en el tipo de mensajes.
  const t = useTranslations('menu') as unknown as {
    (key: string): string;
    has: (key: string) => boolean;
  };
  const locale = useLocale();
  return (category) => {
    const key = `categoryNames.${category.slug}`;
    return locale === 'en' && t.has(key) ? t(key) : category.name;
  };
}
