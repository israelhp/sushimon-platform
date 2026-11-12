import type { Rider, StaffUser } from '@/lib/data-access/models';
import { permissionsFor } from '@/lib/permissions';

/**
 * Personal, repartidores propios y nombres de repartidores PedidosYa del backoffice
 * (USERS 8, OWN_RIDERS 6, RIDERS 6). Roles: admin → admin, encargado → manager, cocina → kitchen.
 * Sucursales s1/s2/s3 → sucursal-1/2/3; 'all' → null.
 */
const user = (
  id: string,
  name: string,
  email: string,
  role: StaffUser['role'],
  branchId: string | null,
  active = true,
): StaffUser => ({ id, name, email, role, branchId, active, permissions: permissionsFor(role) });

export const STAFF_SEEDS: StaffUser[] = [
  user('u1', 'Ana Lucía Pérez', 'ana.perez@sushimon.gt', 'admin', null),
  user('u2', 'Marco Antonio Gómez', 'marco.gomez@sushimon.gt', 'manager', 'sucursal-1'),
  user('u3', 'Karla Rodríguez', 'karla.rodriguez@sushimon.gt', 'manager', 'sucursal-2'),
  user('u4', 'Luis Fernando Chávez', 'luis.chavez@sushimon.gt', 'manager', 'sucursal-3'),
  user('u5', 'Cocina Zona 4', 'cocina.z4@sushimon.gt', 'kitchen', 'sucursal-1'),
  user('u6', 'Cocina Oakland', 'cocina.z10@sushimon.gt', 'kitchen', 'sucursal-2'),
  user('u7', 'Cocina Cayalá', 'cocina.z16@sushimon.gt', 'kitchen', 'sucursal-3'),
  user('u8', 'Pedro Xicará', 'pedro.xicara@sushimon.gt', 'manager', 'sucursal-1', false),
];

/** Usuario de demostración por rol (pantalla de acceso del backoffice). */
export const DEMO_STAFF_BY_ROLE = { admin: 'u1', manager: 'u2', kitchen: 'u5' } as const;

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
