'use client';

import { useEffect } from 'react';
import type { DemoStaff } from '@/lib/demo-session';
import type { AuthContext } from '@/services/auth';
import type { StaffRole } from '@/lib/data-access/models';
import { useAuth } from './auth-provider';
import { useAuthContext } from './auth-queries';
import { useDemoSession } from './demo-session';

const ROLE_PRIORITY: readonly StaffRole[] = ['admin', 'manager', 'staff', 'kitchen'];

/** Adapta el contexto que calculó el SERVIDOR al modelo de personal que ya consume el shell. */
export function staffFromContext(ctx: AuthContext): DemoStaff | null {
  if (ctx.access !== 'GRANTED' || !ctx.backofficeAccess || !ctx.staff) return null;
  const roles = ctx.staff.assignments.map((a) => a.role);
  const role = ROLE_PRIORITY.find((r) => roles.includes(r));
  if (!role) return null;
  return {
    userId: ctx.staff.staffId,
    email: ctx.email ?? '',
    name: ctx.staff.fullName,
    role,
    // Permisos con alcance por sucursal y sucursales autorizadas, tal como los calculó el servidor (F03).
    grants: ctx.staff.grants,
    branches: ctx.staff.branches,
  };
}

/**
 * Transitorio (hasta que cada pantalla lea el contexto real): con Supabase Auth, copia al estado del shell
 * SOLO lo que el servidor autorizó, y lo limpia sin sesión o sin acceso. No concede nada por sí mismo:
 * la API vuelve a autorizar cada solicitud. Con auth `mock` no hace nada.
 */
export function StaffSessionBridge() {
  const { mode, status } = useAuth();
  const { adoptStaff } = useDemoSession();
  const context = useAuthContext();

  useEffect(() => {
    if (mode !== 'supabase') return;
    if (status === 'anonymous') adoptStaff(null);
    else if (status === 'authenticated' && context.data) adoptStaff(staffFromContext(context.data));
    else if (status === 'authenticated' && context.isError) adoptStaff(null);
  }, [mode, status, context.data, context.isError, adoptStaff]);

  return null;
}
