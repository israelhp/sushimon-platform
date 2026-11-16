'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { PublicCategory } from '@/lib/data-access/models';
import { useCategoryLabel } from '../category-label';
import { activeSlugs, chipRows, menuHref } from '../menu-model';

/**
 * Subcategorías de la ruta activa (una fila por nivel con hijas visibles). El primer enlace de cada fila vuelve a la
 * categoría padre ("Todo en …"). Sin categoría activa o sin hijas no renderiza nada.
 */
export function MenuSubnav({ tree, active }: { tree: readonly PublicCategory[]; active: string }) {
  const t = useTranslations('menu');
  const label = useCategoryLabel();
  const path = activeSlugs(tree, active);
  const rows = chipRows(tree, active).filter((r) => r.parent !== null);
  if (rows.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {rows.map(({ parent, items }) =>
        parent ? (
          <nav key={parent.id} aria-label={t('subcategoriesAria', { name: label(parent) })}>
            <ul className="no-scrollbar m-0 flex list-none gap-2 overflow-x-auto p-0 pb-0.5">
              {[
                { slug: parent.slug, text: t('allOf', { name: label(parent) }) },
                ...items.map((c) => ({ slug: c.slug, text: label(c) })),
              ].map((chip) => {
                const exact = chip.slug === active;
                const current = exact || (chip.slug !== parent.slug && path.has(chip.slug));
                return (
                  <li key={chip.slug} className="flex-none">
                    <Link
                      href={menuHref(chip.slug)}
                      replace
                      aria-current={exact ? 'true' : current ? 'location' : undefined}
                      className={cn(
                        'inline-flex min-h-[38px] items-center rounded-full border px-3.5 text-sm font-bold no-underline transition',
                        exact || current
                          ? 'border-primary bg-primary text-onprimary'
                          : 'border-line bg-surface text-fg hover:bg-subtle',
                      )}
                    >
                      {chip.text}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null,
      )}
    </div>
  );
}
