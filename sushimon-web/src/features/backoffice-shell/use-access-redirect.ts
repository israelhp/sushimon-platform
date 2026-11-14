'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { safeNextPath } from '@/lib/auth/safe-redirect';
import {
  BO_PATHS,
  pathForAccess,
  type BackofficeAccessKind,
} from '@/features/session/backoffice-access';

/** Destino tras autorizar: solo rutas internas del backoffice (`safeNextPath`); por defecto el panel. */
export function readNext(): string {
  if (typeof window === 'undefined') return BO_PATHS.home;
  const next = safeNextPath(new URLSearchParams(window.location.search).get('next'), BO_PATHS.home);
  return next === BO_PATHS.home || next.startsWith('/backoffice/') ? next : BO_PATHS.home;
}

/**
 * Lleva a cada estado a su pantalla SIN bucles: nunca navega a la ruta donde ya está (`own`) y, mientras se
 * completa una verificación (`settling`), solo reacciona a STAFF_AUTHORIZED o a perder la sesión, para no
 * saltar a otra pantalla con datos intermedios.
 */
export function useAccessRedirect(state: BackofficeAccessKind, own: string, settling = false) {
  const router = useRouter();
  const [from] = useState(readNext);
  useEffect(() => {
    if (state === 'STAFF_AUTHORIZED') {
      router.replace(from);
      return;
    }
    const target = pathForAccess(state);
    if (!target || target === own) return;
    if (settling && target !== BO_PATHS.login) return;
    router.replace(
      target === BO_PATHS.login ? target : `${target}?next=${encodeURIComponent(from)}`,
    );
  }, [state, own, settling, from, router]);
}
