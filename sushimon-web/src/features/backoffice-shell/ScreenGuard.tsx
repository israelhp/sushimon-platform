'use client';

import type { ReactNode } from 'react';
import type { BackofficeScreen } from '@/lib/permissions';
import { ForbiddenScreen } from './ForbiddenScreen';
import { useShell } from './shell-context';

/**
 * Envuelve el contenido de una pantalla: si sus permisos no la incluyen muestra "sin permiso".
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
  const shell = useShell();
  return shell.canSee(screen) ? <>{children}</> : <ForbiddenScreen reason="role" />;
}
