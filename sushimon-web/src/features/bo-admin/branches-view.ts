import type { Branch, Order } from '@/lib/data-access/models';
import { isActive } from '../bo-orders/order-view';

/**
 * Sucursales (UI). El tope de 5 sucursales es una regla del PROTOTIPO que hoy solo vive en la UI: el modelo de datos no
 * limita el número y no hay endpoint de alta (la API real debe decidir si el tope es regla de negocio: pendiente ❓,
 * ver docs/ui/prototype-inventory.md). La UI solo muestra/oculta; el servidor es quien autoriza.
 */
export const BRANCH_CAP = 5;

export interface BranchCapacity {
  /** Sucursales configuradas (activas). */
  count: number;
  cap: number;
  full: boolean;
  /** Sucursales "próximamente" que pueden activarse con el cupo libre (un espacio por cada una). */
  slots: Branch[];
  /** Espacios libres que no tienen una sucursal que activar (alta nueva: sin contrato todavía). */
  unassignedSlots: number;
}

export function branchCapacity(all: readonly Branch[], cap = BRANCH_CAP): BranchCapacity {
  const count = all.filter((b) => b.status === 'active').length;
  const free = Math.max(0, cap - count);
  const slots = all.filter((b) => b.status === 'coming_soon').slice(0, free);
  return { count, cap, full: count >= cap, slots, unassignedSlots: free - slots.length };
}

export const radiusLabel = (branch: Pick<Branch, 'radiusKm'>) =>
  branch.radiusKm > 0 ? `Radio ${branch.radiusKm} km` : '—';

export interface BranchStats {
  orders: number;
  active: number;
  sales: number;
}

/** Estadísticas de hoy de una sucursal: pedidos y ventas del panel + los que siguen en curso. */
export function branchStats(
  branchId: string,
  byBranch: readonly { branchId: string; orders: number; sales: number }[] | undefined,
  todayOrders: readonly Order[] | undefined,
): BranchStats {
  const row = byBranch?.find((b) => b.branchId === branchId);
  return {
    orders: row?.orders ?? 0,
    sales: row?.sales ?? 0,
    active: (todayOrders ?? []).filter((o) => o.branchId === branchId && isActive(o)).length,
  };
}

export interface BranchFormValues {
  name: string;
  zoneLabel: string;
  address: string;
  phone: string;
  hoursLabel: string;
  radiusKm: string;
}

export type BranchFormErrors = Partial<Record<'name' | 'address' | 'radiusKm', string>>;

export function branchToForm(branch: Branch): BranchFormValues {
  return {
    name: branch.name,
    zoneLabel: branch.zoneLabel,
    address: branch.address,
    phone: branch.phone,
    hoursLabel: branch.hoursLabel,
    radiusKm: String(branch.radiusKm),
  };
}

export function validateBranchForm(values: BranchFormValues): BranchFormErrors {
  const errors: BranchFormErrors = {};
  if (!values.name.trim()) errors.name = 'Escribe el nombre de la sucursal.';
  if (!values.address.trim()) errors.address = 'Escribe la dirección de la sucursal.';
  const radius = Number(values.radiusKm.trim() === '' ? NaN : values.radiusKm);
  if (!(radius >= 0)) errors.radiusKm = 'Indica el radio en kilómetros (0 o más).';
  return errors;
}
