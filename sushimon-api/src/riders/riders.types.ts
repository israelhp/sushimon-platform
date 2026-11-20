import type { AuditEventInput } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';

/** Cliente transaccional mínimo que reciben los puertos (lectura SQL). */
export type TxClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

export type RiderAvailabilityValue = 'AVAILABLE' | 'UNAVAILABLE';
export type RiderAvailabilityFilterValue = 'AVAILABLE' | 'UNAVAILABLE' | 'BUSY';
export type RiderOperationalStateValue = 'INACTIVE' | 'UNAVAILABLE' | 'BUSY' | 'AVAILABLE';
export const RIDER_VEHICLE_TYPES = ['MOTORCYCLE', 'BICYCLE', 'CAR', 'ON_FOOT'] as const;
export type RiderVehicleTypeValue = (typeof RIDER_VEHICLE_TYPES)[number];

/** Motorista tal como se LEE (con el nombre de su sucursal por JOIN). `phone` y `licensePlate` son PII. */
export interface RiderRecord {
  id: string;
  branchId: string;
  branchName: string;
  fullName: string;
  phone: string;
  vehicleType: string | null;
  licensePlate: string | null;
  active: boolean;
  availability: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RiderRead {
  rider: RiderRecord;
  /** Solo si se pidió `destBranchId`: `true|false` = sucursal destino activa/inactiva; `null` = no existe (o no se pidió). */
  destActive: boolean | null;
}

export interface NewRiderData {
  branchId: string;
  fullName: string;
  nameKey: string;
  phone: string;
  vehicleType: string | null;
  licensePlate: string | null;
}

/** Cambios de la edición ya normalizados (`undefined` = no tocar; `null` = borrar). */
export interface RiderPatchData {
  fullName?: string;
  nameKey?: string;
  phone?: string;
  vehicleType?: string | null;
  licensePlate?: string | null;
  branchId?: string;
}

export interface RiderListFilter {
  /** `null` = todas las sucursales; lista = SOLO esas (vacía no devuelve nada). */
  scope: string[] | null;
  branchId?: string;
  active?: boolean;
  availability?: RiderAvailabilityFilterValue;
  /** Ids ocupados según el puerto (vacío si `known=false`). */
  busyIds: string[];
  /** `name_key` buscado (ya normalizado). */
  key?: string;
  sort: 'fullName' | 'createdAt' | 'updatedAt';
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface RiderEligibilityRow {
  riderBranchId: string;
  active: boolean;
  availability: string;
  ownDeliveryEnabled: boolean;
}

/** Operaciones de UNA transacción de comando (doble atómico en las pruebas e2e). */
export interface RidersTx {
  readonly client: TxClient;
  /** Lectura con alcance EN SQL; `lock` = `FOR UPDATE OF r`. `null` = no existe o fuera de alcance (misma respuesta). */
  read(
    id: string,
    branchIds: string[] | null,
    opts?: { lock?: boolean; destBranchId?: string },
  ): Promise<RiderRead | null>;
  /** `INSERT … SELECT` desde `branches` activas; `null` = sucursal inexistente o inactiva. `23505` = teléfono repetido. */
  insert(data: NewRiderData): Promise<RiderRecord | null>;
  /** CAS: `WHERE id AND version = expected AND branch_id = origen`; sube `version`; `null` = 0 filas. */
  update(
    id: string,
    expectedVersion: number,
    originBranchId: string,
    patch: RiderPatchData,
  ): Promise<RiderRecord | null>;
  setActive(id: string, branchId: string, active: boolean): Promise<RiderRecord | null>;
  setAvailability(
    id: string,
    branchId: string,
    availability: RiderAvailabilityValue,
  ): Promise<RiderRecord | null>;
  audit(event: AuditEventInput): Promise<void>;
}
