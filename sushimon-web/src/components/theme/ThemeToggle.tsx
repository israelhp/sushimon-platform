'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useTheme } from './ThemeProvider';

/** Botón de tema con el aspecto del prototipo de la tienda (círculo con sol/luna). */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const t = useTranslations('prefs');
  const dark = theme === 'dark';
  const label = dark ? t('toLight') : t('toDark');
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-8 w-8 flex-none items-center justify-center rounded-full border border-line bg-surface text-fg transition-colors hover:bg-subtle min-[400px]:h-9 min-[400px]:w-9',
        className,
      )}
    >
      {dark ? (
        <Sun className="h-[18px] w-[18px] text-accent" aria-hidden="true" />
      ) : (
        <Moon className="h-[18px] w-[18px]" aria-hidden="true" />
      )}
    </button>
  );
}
