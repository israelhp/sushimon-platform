'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Zone } from './zone';
import { useIsClient } from './use-dialog';

/**
 * Monta superposiciones en <body> conservando los tokens/estilos de su zona: el envoltorio
 * `data-zone` usa `display: contents`, así no genera caja propia (ni fondo ni alto mínimo del backoffice).
 */
export function Portal({ zone, children }: { zone: Zone; children: ReactNode }) {
  const isClient = useIsClient();
  if (!isClient) return null;
  return createPortal(
    <div data-zone={zone} style={{ display: 'contents' }}>
      {children}
    </div>,
    document.body,
  );
}
