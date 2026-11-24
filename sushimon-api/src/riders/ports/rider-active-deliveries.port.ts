import { Injectable } from '@nestjs/common';
import type { TxClient } from '../riders.types.js';

/**
 * Puerto de lectura de entregas ACTIVAS de motoristas (F27, spec 028 §8.1). Desde F28 lo implementa `RiderActiveDeliveriesAdapter`
 * (`known=true`, lee `app.deliveries`) enlazado en `RidersModule`.
 */
export interface RiderBusyResult {
  /** `false`: el adaptador no puede afirmar nada (F28 inexistente). `busyIds` solo es fiable si `known = true`. */
  known: boolean;
  busyIds: ReadonlySet<string>;
}

export type RiderBusyQuery = { riderIds: string[] } | { branchIds: string[] | null };

export interface RiderActiveDeliveriesPort {
  findBusy(query: RiderBusyQuery, tx?: TxClient): Promise<RiderBusyResult>;
}

export const RIDER_ACTIVE_DELIVERIES_PORT = Symbol('RIDER_ACTIVE_DELIVERIES_PORT');

/**
 * Adaptador «sin entregas» de F27 (`known=false`, sin SQL). Ya NO está enlazado en `RidersModule` (F28 lo reemplazó): queda SOLO
 * para dobles de pruebas. Con él, la asignación de F28 falla CERRADA (503 `DELIVERIES_BUSY`).
 */
@Injectable()
export class NoActiveDeliveriesAdapter implements RiderActiveDeliveriesPort {
  findBusy(): Promise<RiderBusyResult> {
    return Promise.resolve({ known: false, busyIds: new Set<string>() });
  }
}
