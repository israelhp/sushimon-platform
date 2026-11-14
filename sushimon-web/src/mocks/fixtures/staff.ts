import type { Rider, StaffRole } from '@/lib/data-access/models';
import type { DemoStaff } from '@/lib/demo-session';
import { computeGrants, contextBranches, primaryRole } from '../rbac';
import { BRANCH_SEEDS } from './branches';
import { ROLE_SEEDS, roleSeedByCode } from './rbac';

/**
 * Personal del backoffice (F03): empleados con asignaciones rol+sucursal (varias posibles), estado de identidad
 * (`PENDING_LINK` = preautorizado sin iniciar sesión con Google, `LINKED`) y activo/inactivo. Roles: admin → admin,
 * encargado → manager, cocina → kitchen, empleado → staff. Sucursales s1/s2/s3 → sucursal-1/2/3; global → null.
 */
export interface StaffSeed {
  id: string;
  fullName: string;
  email: string;
  active: boolean;
  /** false = PENDING_LINK. */
  linked: boolean;
  createdAt: string;
  createdById: string | null;
  assignments: { role: StaffRole; branchId: string | null }[];
}

const seed = (
  id: string,
  fullName: string,
  email: string,
  assignments: StaffSeed['assignments'],
  extra: Partial<Pick<StaffSeed, 'active' | 'linked' | 'createdById'>> = {},
): StaffSeed => ({
  id,
  fullName,
  email,
  active: extra.active ?? true,
  linked: extra.linked ?? true,
  createdAt: '2026-06-01T15:00:00.000Z',
  createdById: extra.createdById ?? null,
  assignments,
});

export const STAFF_SEEDS: StaffSeed[] = [
  seed('u1', 'Ana Lucía Pérez', 'ana.perez@sushimon.gt', [{ role: 'admin', branchId: null }]),
  seed('u2', 'Marco Antonio Gómez', 'marco.gomez@sushimon.gt', [
    { role: 'manager', branchId: 'sucursal-1' },
  ]),
  seed('u3', 'Karla Rodríguez', 'karla.rodriguez@sushimon.gt', [
    { role: 'manager', branchId: 'sucursal-2' },
  ]),
  seed('u4', 'Luis Fernando Chávez', 'luis.chavez@sushimon.gt', [
    { role: 'manager', branchId: 'sucursal-3' },
  ]),
  seed('u5', 'Cocina Zona 4', 'cocina.z4@sushimon.gt', [
    { role: 'kitchen', branchId: 'sucursal-1' },
  ]),
  seed('u6', 'Cocina Oakland', 'cocina.z10@sushimon.gt', [
    { role: 'kitchen', branchId: 'sucursal-2' },
  ]),
  seed('u7', 'Cocina Cayalá', 'cocina.z16@sushimon.gt', [
    { role: 'kitchen', branchId: 'sucursal-3' },
  ]),
  seed(
    'u8',
    'Pedro Xicará',
    'pedro.xicara@sushimon.gt',
    [{ role: 'manager', branchId: 'sucursal-1' }],
    { active: false },
  ),
  seed(
    'u9',
    'Empleado Zona 4',
    'empleado.z4@sushimon.gt',
    [{ role: 'staff', branchId: 'sucursal-1' }],
    { createdById: 'u2' },
  ),
  // Preautorizado: aún no inició sesión con Google (PENDING_LINK).
  seed(
    'u10',
    'Valeria Ixcoy',
    'valeria.ixcoy@sushimon.gt',
    [{ role: 'kitchen', branchId: 'sucursal-2' }],
    { linked: false, createdById: 'u1' },
  ),
  // Encargada con dos sucursales (ejemplo de asignaciones múltiples).
  seed(
    'u11',
    'Sofía Morales',
    'sofia.morales@sushimon.gt',
    [
      { role: 'manager', branchId: 'sucursal-2' },
      { role: 'manager', branchId: 'sucursal-3' },
    ],
    { createdById: 'u1' },
  ),
];

/** Usuario de demostración por rol (pantalla de acceso del backoffice). */
export const DEMO_STAFF_BY_ROLE = {
  admin: 'u1',
  manager: 'u2',
  kitchen: 'u5',
  staff: 'u9',
} as const satisfies Record<StaffRole, string>;

/** Sesión de demostración de un empleado sembrado, con los `grants` y sucursales que calcularía el servidor. */
export function demoStaffFromSeed(userId: string): DemoStaff {
  const user = STAFF_SEEDS.find((u) => u.id === userId);
  if (!user) throw new Error(`Usuario de demostración desconocido: ${userId}`);
  const assignments = user.assignments.map((a) => ({
    roleId: roleSeedByCode(a.role).id,
    branchId: a.branchId,
  }));
  const grants = computeGrants(
    { active: user.active, assignments },
    ROLE_SEEDS,
    BRANCH_SEEDS.map((b) => ({ id: b.id, active: b.active })),
  );
  const branches = contextBranches(grants, BRANCH_SEEDS);
  return {
    userId: user.id,
    email: user.email,
    name: user.fullName,
    role: primaryRole(user.assignments.map((a) => a.role)),
    grants,
    branches,
  };
}

export type RiderSeed = Omit<Rider, 'busy'>;

export const RIDER_SEEDS: RiderSeed[] = [
  {
    id: 'r1',
    name: 'Juan Carlos P.',
    branchId: 'sucursal-1',
    vehicle: 'Moto · P-482HJK',
    phone: '+502 5530-1122',
    active: true,
  },
  {
    id: 'r2',
    name: 'Luis Coc',
    branchId: 'sucursal-1',
    vehicle: 'Moto · P-219FRT',
    phone: '+502 4418-7730',
    active: true,
  },
  {
    id: 'r3',
    name: 'Mario Tzul',
    branchId: 'sucursal-2',
    vehicle: 'Moto · P-760KLM',
    phone: '+502 5212-0457',
    active: true,
  },
  {
    id: 'r4',
    name: 'Ana Sicán',
    branchId: 'sucursal-2',
    vehicle: 'Moto · P-338BCD',
    phone: '+502 3391-6620',
    active: true,
  },
  {
    id: 'r5',
    name: 'Pedro Ajanel',
    branchId: 'sucursal-3',
    vehicle: 'Moto · P-905GHT',
    phone: '+502 5874-2215',
    active: true,
  },
  {
    id: 'r6',
    name: 'Carlos Yat',
    branchId: 'sucursal-3',
    vehicle: 'Moto · P-147ZXC',
    phone: '+502 4027-9984',
    active: false,
  },
];

/** Repartidores simulados de PedidosYa (solo nombres para la demo). */
export const COURIER_RIDER_NAMES = [
  'Kevin R. · moto',
  'Marvin L. · moto',
  'Edwin T. · moto',
  'Brenda S. · moto',
  'Óscar P. · moto',
  'Wendy C. · moto',
];

/** Motivos de rechazo del backoffice (CANCEL_R). */
export const REJECTION_REASONS = [
  'Producto agotado',
  'Fuera de zona de cobertura',
  'Sucursal saturada',
  'Datos de contacto incompletos',
];
