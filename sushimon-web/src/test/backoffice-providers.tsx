import { QueryClient } from '@tanstack/react-query';
import { act, render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import {
  DemoSessionProvider,
  useDemoSession,
  type DemoSessionApi,
} from '@/features/session/demo-session';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import type { StaffRole } from '@/lib/data-access/models';
import { DataProvider } from '@/lib/data-access/provider';
import type { DataClient } from '@/lib/data-access/types';
import { createFixedClock, type FixedClock } from '@/mocks/clock';
import { createMockDataClient } from '@/mocks/index';
import type { MockScenario } from '@/mocks/scenarios';
import { createSeedStore } from '@/mocks/seed';
import type { MockStore } from '@/mocks/store';

export interface RenderBackofficeOptions {
  scenario?: MockScenario;
  /** Rol de la sesión de demostración (null = sin sesión). Por defecto, encargado. */
  role?: StaffRole | null;
  locale?: 'es' | 'en';
}

export interface BackofficeTestApi {
  session: DemoSessionApi;
  clock: FixedClock;
  /** Cliente de datos mock (para provocar cambios "del servidor" fuera de la UI). */
  client: DataClient;
  /** Store del mock (para provocar cambios "del servidor" fuera de la UI, p. ej. revocar un permiso). */
  store: MockStore;
}

/**
 * Renderiza con los proveedores REALES del backoffice (next-intl, DataProvider con `createMockDataClient`: latencia 0,
 * reloj fijo 2026-11-11 14:25 GT, sin persistencia; sesión de demostración; avisos `bo`). Inicia la sesión del rol
 * ANTES de montar `ui` para que la puerta de sesión no redirija. Úsalo con
 * `vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'))`.
 */
export async function renderBackoffice(
  ui: ReactElement,
  { scenario = 'default', role = 'manager', locale = 'es' }: RenderBackofficeOptions = {},
): Promise<RenderResult & { api: () => BackofficeTestApi }> {
  let current: BackofficeTestApi | null = null;
  const clock = createFixedClock();

  function SessionSetup({ children }: { children: ReactNode }) {
    const session = useDemoSession();
    current = { session, clock, client, store };
    const [ready, setReady] = useState(false);
    useEffect(() => {
      if (role) session.signInStaff(role);
      else session.signOutStaff();
      setReady(true);
      // Solo al montar: define la identidad inicial de la prueba.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return ready ? <>{children}</> : null;
  }

  const store = createSeedStore(scenario);
  const client = createMockDataClient({
    scenario,
    latencyMs: 0,
    persist: false,
    store,
    clock,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'en' ? en : es}
      timeZone="America/Guatemala"
    >
      <ThemeProvider>
        <DataProvider client={client} queryClient={queryClient}>
          <DemoSessionProvider>
            <ToastProvider zone="bo">
              <SessionSetup>{children}</SessionSetup>
            </ToastProvider>
          </DemoSessionProvider>
        </DataProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );

  let result!: RenderResult;
  await act(async () => {
    result = render(ui, { wrapper: Wrapper });
  });
  const api = () => {
    if (!current) throw new Error('SessionSetup no montado');
    return current;
  };
  return Object.assign(result, { api });
}
