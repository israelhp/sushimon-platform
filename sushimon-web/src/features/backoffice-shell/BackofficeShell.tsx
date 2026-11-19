'use client';

import { useTranslations } from 'next-intl';
import { useEffect, type ReactNode } from 'react';
import { OrderDetailHost } from '@/features/bo-orders/components/OrderDetailHost';
import { OrderDetailProvider } from '@/features/bo-orders/order-detail-context';
import { DispatchModalProvider } from '@/features/bo-orders/use-dispatch-modal';
import { BoardFeedProvider, useBoardFeed } from '@/features/bo-orders/board-feed';
import { Sidebar } from './Sidebar';
import { StaffGate } from './StaffGate';
import { BackofficeShellProvider, useShell } from './shell-context';
import { Topbar } from './Topbar';

/**
 * Shell autenticado del backoffice (sidebar + topbar + contenido). Compone la puerta de sesión de demostración,
 * el estado del shell, el punto de integración de despacho y el detalle global del pedido.
 *
 * Reutilizable por las demás pantallas: basta con renderizarlas como `children` (layout del grupo `(app)`).
 */
export function BackofficeShell({ children }: { children: ReactNode }) {
  return (
    <StaffGate>
      <BackofficeShellProvider>
        <OrderDetailProvider>
          <DispatchModalProvider>
            <BoardFeedProvider>
              <ShellFrame>{children}</ShellFrame>
              <OrderDetailHost />
            </BoardFeedProvider>
          </DispatchModalProvider>
        </OrderDetailProvider>
      </BackofficeShellProvider>
    </StaffGate>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('backoffice.shell');
  const shell = useShell();
  // F22: el contador de «nuevos» sale del tablero real (un único sondeador, vive en `BoardFeedProvider`).
  const newCount = useBoardFeed().pendingCount;

  useEffect(() => {
    if (!shell.mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && shell.setMobileNavOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shell]);

  return (
    <div className="app">
      {shell.mobileNavOpen ? (
        <button
          type="button"
          className="scrim"
          aria-label={t('closeMenu')}
          onClick={() => shell.setMobileNavOpen(false)}
        />
      ) : null}
      <Sidebar newCount={newCount} />
      <div className="main">
        <Topbar newCount={newCount} />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
