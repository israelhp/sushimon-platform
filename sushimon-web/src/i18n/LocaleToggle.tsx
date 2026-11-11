'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { cn } from '@/lib/cn';
import { setLocaleAction } from './actions';
import { LOCALES, LOCALE_LABELS, type Locale } from './config';

/** Cambia el idioma (Server Action + refresco). `pending` indica que la recarga está en curso. */
export function useLocaleSwitch() {
  const locale = useLocale() as Locale;
  const [pending, startTransition] = useTransition();
  const setLocale = (next: Locale) => {
    if (next === locale) return;
    startTransition(async () => {
      await setLocaleAction(next);
    });
  };
  return { locale, setLocale, pending };
}

/** Selector ES/EN con el aspecto del prototipo de la tienda (grupo de botones con `aria-pressed`). */
export function LocaleToggle({ className }: { className?: string }) {
  const t = useTranslations('prefs');
  const { locale, setLocale, pending } = useLocaleSwitch();
  return (
    <div
      role="group"
      aria-label={t('language')}
      aria-busy={pending || undefined}
      className={cn(
        'inline-flex h-8 flex-none items-center rounded-full border border-line bg-surface p-0.5 min-[400px]:h-9',
        className,
      )}
    >
      {LOCALES.map((id) => {
        const active = id === locale;
        const label = LOCALE_LABELS[id];
        return (
          <button
            key={id}
            type="button"
            lang={id}
            aria-pressed={active}
            aria-label={active ? label.full : t('switchTo', { a: label.full })}
            onClick={() => setLocale(id)}
            className={cn(
              'inline-flex h-full min-w-[26px] items-center justify-center rounded-full px-1 text-[11px] font-extrabold tracking-wide transition-colors min-[400px]:min-w-[30px] min-[400px]:px-1.5 min-[400px]:text-[12px]',
              active ? 'bg-deep text-ondeep' : 'text-muted hover:text-fg',
            )}
          >
            {label.short}
          </button>
        );
      })}
    </div>
  );
}
