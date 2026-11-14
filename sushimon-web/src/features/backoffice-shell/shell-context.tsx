'use client';

import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useToast } from '@/components/ui/Toast';
import { useSimulateIncomingOrder } from '@/features/backoffice/hooks';
import { useDemoSession } from '@/features/session/demo-session';
import { useAdminContext } from '@/features/staff/hooks';
import { useBranches } from '@/features/store/hooks';
import type { Branch, StaffPermission, StaffRole } from '@/lib/data-access/models';
import { can, canSee, type BackofficeScreen, type Grants } from '@/lib/permissions';
import { errorMessage } from '../bo-orders/error-message';

/**
 * Estado del shell del backoffice compartido por todas las pantallas: sucursal activa, sonido/timbre de pedidos
 * nuevos, navegación móvil y el pedido entrante simulado. La sucursal activa solo FILTRA la vista: el servidor
 * (o el adaptador mock) decide a qué sucursales puede acceder cada usuario.
 */

/** Zona corta de una sucursal ("Zona 4 · Cuatro Grados Norte" → "Zona 4"), como `brShort` del prototipo. */
export function branchShortName(
  branch: Pick<Branch, 'zoneLabel'> | undefined,
  fallback = '',
): string {
  return branch ? (branch.zoneLabel.split(' · ')[0] ?? fallback) : fallback;
}

export interface ShellApi {
  /** Rol principal (solo para mostrar). La autorización se decide con `can` (grants). */
  role: StaffRole;
  /** Permisos con alcance por sucursal (contexto administrativo; cosmético: la API decide). */
  grants: Grants;
  can: (permission: StaffPermission, branchId?: string | null) => boolean;
  canSee: (screen: BackofficeScreen) => boolean;
  /** Sucursal elegida (undefined = todas). Para roles de sucursal siempre es la propia. */
  branchId: string | undefined;
  /** El usuario solo tiene una sucursal autorizada (no puede cambiarla). */
  branchLocked: boolean;
  setBranchId: (id: string | undefined) => void;
  branches: readonly Branch[];
  branchById: (id: string) => Branch | undefined;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** true unos segundos tras llegar un pedido (campana animada + "Sonando"). */
  ring: boolean;
  /** 🎭 Simula un pedido entrante desde la web (solo mock). */
  simulateOrder: () => void;
  simulating: boolean;
}

const ShellContext = createContext<ShellApi | null>(null);

const RING_MS = 3200;

export function BackofficeShellProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('backoffice.shell.notifications');
  const toast = useToast();
  const { staff } = useDemoSession();
  const branchesQuery = useBranches();
  const [pickedBranch, setPickedBranch] = useState<string | undefined>(undefined);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [ring, setRing] = useState(false);
  const simulate = useSimulateIncomingOrder();

  // El timbre dura unos segundos desde que llega el pedido.
  useEffect(() => {
    if (!ring) return;
    const id = setTimeout(() => setRing(false), RING_MS);
    return () => clearTimeout(id);
  }, [ring]);

  const adminContext = useAdminContext();
  // El contexto del servidor manda; la instantánea de la sesión solo cubre hasta que llega.
  const grants = useMemo<Grants>(
    () => adminContext.data?.staff.grants ?? staff?.grants ?? {},
    [adminContext.data, staff?.grants],
  );
  const authorized = adminContext.data?.staff.branches ?? staff?.branches;
  const global = Object.values(grants).some((g) => g.allBranches);
  const authorizedIds = useMemo(() => new Set((authorized ?? []).map((b) => b.id)), [authorized]);
  const locked = !global && authorizedIds.size === 1;
  const lockedBranch = locked ? [...authorizedIds][0] : undefined;
  const branchId = locked
    ? lockedBranch
    : pickedBranch && (global || authorizedIds.has(pickedBranch))
      ? pickedBranch
      : undefined;
  // Solo sucursales operativas (las "próximamente" no reciben pedidos) y autorizadas para el empleado.
  const branches = useMemo(
    () =>
      (branchesQuery.data ?? []).filter(
        (b) => b.status === 'active' && (global || authorizedIds.has(b.id)),
      ),
    [branchesQuery.data, global, authorizedIds],
  );

  const simulateOrder = useCallback(() => {
    simulate.mutate(branchId, {
      onSuccess: (order) => {
        setRing(true);
        toast.notify(t('newOrderToast', { id: order.id, name: order.customer.name }));
      },
      onError: (error) => toast.notify(errorMessage(error)),
    });
  }, [simulate, branchId, toast, t]);

  const api = useMemo<ShellApi | null>(
    () =>
      staff
        ? {
            role: staff.role,
            grants,
            can: (permission, forBranch) => can(grants, permission, forBranch),
            canSee: (screen) => canSee(grants, screen),
            branchId,
            branchLocked: locked,
            setBranchId: (id) => {
              if (!locked) setPickedBranch(id);
            },
            branches,
            branchById: (id) => branches.find((b) => b.id === id),
            mobileNavOpen,
            setMobileNavOpen,
            soundOn,
            setSoundOn,
            ring,
            simulateOrder,
            simulating: simulate.isPending,
          }
        : null,
    [
      staff,
      grants,
      branchId,
      locked,
      branches,
      mobileNavOpen,
      soundOn,
      ring,
      simulateOrder,
      simulate.isPending,
    ],
  );

  if (!api) return null;
  return <ShellContext.Provider value={api}>{children}</ShellContext.Provider>;
}

/** Estado del shell (sucursal activa, sonido, navegación móvil, pedido demo). Solo dentro del backoffice autenticado. */
export function useShell(): ShellApi {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell debe usarse dentro de <BackofficeShellProvider>');
  return ctx;
}
