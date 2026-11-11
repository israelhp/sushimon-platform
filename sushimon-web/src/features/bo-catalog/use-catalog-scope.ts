'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useShell } from '@/features/backoffice-shell/shell-context';

/**
 * Alcance de la disponibilidad según la sucursal elegida en el shell: una sucursal, o todas las activas.
 * Solo FILTRA la vista; el servidor decide a qué sucursales puede cambiar cada rol (403 si no).
 */
export function useCatalogScope() {
  const { branchId, branches, branchById } = useShell();
  const t = useTranslations('backoffice.shell');
  const activeBranches = useMemo(() => branches.filter((b) => b.status === 'active'), [branches]);
  const scope = useMemo(
    () => (branchId ? [branchId] : activeBranches.map((b) => b.id)),
    [branchId, activeBranches],
  );
  const current = branchId ? branchById(branchId) : undefined;
  const title = current ? `${current.name} · ${current.zoneLabel}` : t('allBranches');
  return { scope, activeBranches, title };
}
