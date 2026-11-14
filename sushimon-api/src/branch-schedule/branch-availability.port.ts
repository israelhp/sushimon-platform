import type { ScheduleTx } from './branch-schedule.repository.js';
import type { AvailabilityReason } from './availability.js';

/** Token DI del puerto de disponibilidad para F17/F19/F20 (sin HTTP). */
export const BRANCH_AVAILABILITY_PORT = Symbol('BRANCH_AVAILABILITY_PORT');

export type BranchAvailabilityReason = AvailabilityReason;

export interface BranchAvailabilityResult {
  branchId: string;
  timezone: string;
  at: Date;
  isOpenNow: boolean;
  isAcceptingOrders: boolean;
  reason: BranchAvailabilityReason;
  nextOpensAt: Date | null;
  nextClosesAt: Date | null;
  nextTransitionAt: Date | null;
}

export interface AvailabilityInput {
  branchId: string;
  at: Date;
  /** Punto de extensión (sin valor por defecto): minutos antes del cierre en que se dejan de aceptar pedidos. */
  orderCutoffMinutes?: number;
  /** Cliente de la transacción del llamador (p. ej. la de crear el pedido): se lee con SU conexión. */
  tx?: ScheduleTx;
}

/**
 * Único lugar donde se decide si una sucursal acepta pedidos en un instante (spec F08 D9/D11). Lee SIEMPRE de la
 * BD (una sola consulta por llamada). `at` lo fija el llamador: para «pedir ahora» use `canAcceptOrderNow`
 * (reloj del servidor); `at` solo para pedidos PROGRAMADOS.
 */
export interface BranchAvailabilityPort {
  /** Lanza `NotFoundException` si la sucursal no existe; una inactiva devuelve `INACTIVE`. */
  getAvailability(input: AvailabilityInput): Promise<BranchAvailabilityResult>;
  /** Varias sucursales en UNA consulta (F17 bootstrap). `NotFoundException` si alguna no existe. */
  getAvailabilityMany(input: {
    branchIds: readonly string[];
    at: Date;
    orderCutoffMinutes?: number;
    tx?: ScheduleTx;
  }): Promise<BranchAvailabilityResult[]>;
  canAcceptOrder(input: { branchId: string; at: Date; tx?: ScheduleTx }): Promise<{
    accepted: boolean;
    reason: BranchAvailabilityReason;
    nextOpensAt: Date | null;
  }>;
  /** «Pedir ahora»: evalúa con el reloj del servidor (el llamador no puede fijar la hora). */
  canAcceptOrderNow(
    branchId: string,
    tx?: ScheduleTx,
  ): Promise<{ accepted: boolean; reason: BranchAvailabilityReason; nextOpensAt: Date | null }>;
}
