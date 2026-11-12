import { vi } from 'vitest';

/**
 * Doble de `next/navigation` para pruebas del backoffice:
 *   vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));
 * `nav.pathname` cambia la ruta activa; `router` registra push/replace.
 */
export const nav = { pathname: '/backoffice/pedidos' };
export const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() };

export const usePathname = () => nav.pathname;
export const useRouter = () => router;
export const useSearchParams = () => new URLSearchParams();

export function resetNavigationMock(pathname = '/backoffice/pedidos') {
  nav.pathname = pathname;
  router.push.mockClear();
  router.replace.mockClear();
  router.back.mockClear();
  router.refresh.mockClear();
}
