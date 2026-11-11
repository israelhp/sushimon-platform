'use client';

import { useTranslations } from 'next-intl';
import { IconMoon, IconSun } from '@/components/icons/bo';
import { useTheme } from '@/components/theme/ThemeProvider';

/**
 * Botón de tema claro/oscuro del backoffice (`icon-btn bordered theme-btn`). Usa la MISMA preferencia que la tienda
 * (`localStorage['monsushi-theme']`, solo preferencia visual) en lugar de la clave propia del prototipo.
 */
export function BoThemeButton({ scope = 'shell' }: { scope?: 'shell' | 'login' }) {
  const t = useTranslations(`backoffice.${scope}`);
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const label = dark ? t('themeToLight') : t('themeToDark');
  return (
    <button
      type="button"
      className="icon-btn bordered theme-btn"
      aria-label={label}
      title={label}
      aria-pressed={dark}
      onClick={toggle}
    >
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}
