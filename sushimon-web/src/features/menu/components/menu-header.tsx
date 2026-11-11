'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { FoodArt } from '@/components/art/FoodArt';
import { cn } from '@/lib/cn';
import { categoryName, foodArtKind } from '@/features/catalog/localized';
import { ALL_CATEGORY, menuHref, type MenuSection } from '../menu-model';

/**
 * Cabecera fija del menú (banda seigaiha oscura) con el título y los chips de categoría.
 * Los chips son enlaces a `/menu?cat=<id>` (la categoría vive en la URL); el activo lleva `aria-current`.
 */
export function MenuHeader({
  sections,
  active,
}: {
  sections: readonly MenuSection[];
  active: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const chips = [
    { id: ALL_CATEGORY, label: t('categories.all'), art: 'pizza' as const },
    ...sections.map(({ category }) => ({
      id: category.id,
      label: categoryName(category, locale),
      art: foodArtKind(category.illustration ?? ''),
    })),
  ];
  return (
    <div className="seigaiha seigaiha-ink sticky top-[calc(64px+env(safe-area-inset-top))] z-30 flex h-[136px] items-center sm:h-[160px] md:top-[72px] lg:h-[184px]">
      <div className="wrap">
        <h1 className="disp mb-2.5 text-[clamp(30px,6.5vw,56px)] text-white sm:mb-3">
          {t('menu.title')}{' '}
          <span
            className="ml-1 align-middle font-jp text-[13px] tracking-[0.2em] text-accent"
            lang="ja"
          >
            メニュー
          </span>
        </h1>
        <nav aria-label={t('menu.categoriesAria')}>
          <ul className="no-scrollbar -mx-4 m-0 flex list-none gap-2 overflow-x-auto p-0 px-4 pb-0.5 sm:mx-0 sm:px-0">
            {chips.map((chip) => {
              const current = chip.id === active;
              return (
                <li key={chip.id} className="flex-none">
                  <Link
                    href={menuHref(chip.id)}
                    replace
                    aria-current={current ? 'true' : undefined}
                    ref={(el) => {
                      if (el && current)
                        el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
                    }}
                    className={cn(
                      'inline-flex min-h-[42px] items-center gap-1.5 rounded-full py-1 pl-1.5 pr-3.5 text-sm font-bold no-underline transition',
                      current
                        ? 'bg-primary text-onprimary'
                        : 'bg-white text-neutral-900 hover:bg-[rgb(var(--tile-cream))]',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex h-8 w-8 items-center justify-center rounded-full',
                        current ? 'bg-white' : 'bg-[rgb(var(--tile-cream))]',
                      )}
                    >
                      <FoodArt kind={chip.art} className="h-6 w-6" />
                    </span>
                    {chip.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
