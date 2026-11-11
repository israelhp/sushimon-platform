'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { THEME_COLORS, THEME_STORAGE_KEY, type Theme } from './theme-config';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): Theme | null {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', THEME_COLORS[theme]));
}

// La fuente de verdad es la clase `.dark` de <html> (la fija el script inline antes de hidratar).
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
const getSnapshot = (): Theme =>
  document.documentElement.classList.contains('dark') ? 'dark' : 'light';
// En el servidor no se conoce el tema: se asume claro y React re-renderiza tras hidratar sin error de hidratación.
const getServerSnapshot = (): Theme => 'light';

/**
 * Tema claro/oscuro compartido por la tienda y el backoffice. Preferencia en `localStorage['monsushi-theme']`;
 * sin preferencia guardada sigue a `prefers-color-scheme` (también en vivo), como el prototipo.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const stored = readStored();
    // Si el documento se renderizó en el cliente (p. ej. la página 404 de Next), el script inline del
    // <head> no se ejecutó: se aplica aquí la preferencia guardada.
    if (stored && getSnapshot() !== stored) applyTheme(stored);
    if (stored) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (getSnapshot() !== (mq.matches ? 'dark' : 'light'))
      applyTheme(mq.matches ? 'dark' : 'light');
    const onChange = (e: MediaQueryListEvent) => {
      if (!readStored()) applyTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* almacenamiento no disponible: el tema se aplica solo en esta visita */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider');
  return ctx;
}
