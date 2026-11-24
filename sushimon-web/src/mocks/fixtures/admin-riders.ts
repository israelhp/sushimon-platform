import type { AdminRider } from '@/lib/data-access/models';

/**
 * F27 (SIMULADO) — Motoristas propios de la demostración con la forma persistida de `app.riders` (el listado y el detalle los
 * derivan en el handler). Personas y teléfonos FICTICIOS (`+5025550XXXX`); ningún dato real. Sin entregas: `busyKnown=false`.
 * Distintos del `RIDER_SEEDS` del despacho simulado de `bo-deliveries`, que no se toca hasta F28.
 */
export type AdminRiderRecord = Pick<
  AdminRider,
  | 'id'
  | 'branchId'
  | 'fullName'
  | 'phone'
  | 'vehicleType'
  | 'licensePlate'
  | 'active'
  | 'availability'
  | 'version'
  | 'createdAt'
  | 'updatedAt'
>;

const AT = '2026-10-01T15:00:00.000Z';
const base = {
  version: 1,
  createdAt: AT,
  updatedAt: AT,
} as const;

export const ADMIN_RIDER_SEEDS: readonly AdminRiderRecord[] = [
  {
    ...base,
    id: 'rider-1',
    branchId: 'sucursal-1',
    fullName: 'Juan Carlos Pérez',
    phone: '+50255501001',
    vehicleType: 'MOTORCYCLE',
    licensePlate: 'M482HJK',
    active: true,
    availability: 'AVAILABLE',
  },
  {
    ...base,
    id: 'rider-2',
    branchId: 'sucursal-1',
    fullName: 'Luis Coc',
    phone: '+50255501002',
    vehicleType: 'MOTORCYCLE',
    licensePlate: 'M219PLX',
    active: true,
    availability: 'UNAVAILABLE',
  },
  {
    ...base,
    id: 'rider-3',
    branchId: 'sucursal-1',
    fullName: 'Ángel Morales',
    phone: '+50255501003',
    vehicleType: 'BICYCLE',
    licensePlate: null,
    active: true,
    availability: 'AVAILABLE',
  },
  {
    ...base,
    id: 'rider-4',
    branchId: 'sucursal-2',
    fullName: 'Marvin Tzoc',
    phone: '+50255501004',
    vehicleType: 'MOTORCYCLE',
    licensePlate: 'M730QRT',
    active: true,
    availability: 'AVAILABLE',
  },
  {
    ...base,
    id: 'rider-5',
    branchId: 'sucursal-2',
    fullName: 'Rosa Elena Xicay',
    phone: '+50255501005',
    vehicleType: 'CAR',
    licensePlate: 'P551BCD',
    active: true,
    availability: 'UNAVAILABLE',
  },
  {
    ...base,
    id: 'rider-6',
    branchId: 'sucursal-3',
    fullName: 'Diego Batz',
    phone: '+50255501006',
    vehicleType: null,
    licensePlate: null,
    active: true,
    availability: 'UNAVAILABLE',
  },
  {
    ...base,
    id: 'rider-7',
    branchId: 'sucursal-3',
    fullName: 'Olga Tuyuc',
    phone: '+50255501007',
    vehicleType: 'ON_FOOT',
    licensePlate: null,
    active: false,
    availability: 'UNAVAILABLE',
    version: 3,
  },
];
