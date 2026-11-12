'use client';

import type { ReactNode } from 'react';
import { canSee, type BackofficeScreen } from '@/lib/permissions';
import { ForbiddenScreen } from './ForbiddenScreen';
import { useShell } from './shell-context';

/**
 * Envuelve el contenido de una pantalla: si el rol no la tiene en su menú muestra "sin permiso".
 * Comprobación de UI; el servidor rechaza igualmente los datos (403).
 *
 *   <ScreenGuard screen="entregas"><DeliveriesScreen /></ScreenGuard>
 */
export function ScreenGuard({
  screen,
  children,
}: {
  screen: BackofficeScreen;
  children: ReactNode;
}) {
  const { role } = useShell();
  return canSee(role, screen) ? <>{children}</> : <ForbiddenScreen reason="role" />;
}
