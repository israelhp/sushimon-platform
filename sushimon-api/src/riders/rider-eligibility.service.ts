import { Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  RIDER_ACTIVE_DELIVERIES_PORT,
  type RiderActiveDeliveriesPort,
} from './ports/rider-active-deliveries.port.js';
import { RidersRepository } from './riders.repository.js';
import type { TxClient } from './riders.types.js';

export type RiderIneligibleReason =
  'NOT_FOUND' | 'INACTIVE' | 'WRONG_BRANCH' | 'UNAVAILABLE' | 'BUSY' | 'OWN_DELIVERY_DISABLED';

export interface RiderEligibility {
  riderId: string;
  /** Sucursal del pedido evaluado. */
  branchId: string;
  /** USO INTERNO: la sucursal del motorista NUNCA se serializa al cliente (F27 obligación 2; F28 mapea solo `reasons`). */
  riderBranchId: string | null;
  active: boolean;
  /** Activo Y marcado `AVAILABLE`. */
  available: boolean;
  busy: boolean;
  busyKnown: boolean;
  /** `reasons` vacío. */
  eligible: boolean;
  reasons: RiderIneligibleReason[];
}

/**
 * Elegibilidad de un motorista para un pedido (F27, spec 028 §8.2; lo consume F28). Es una LECTURA: no reserva, no asigna, no
 * bloquea (cero `UPDATE`/`FOR UPDATE`) y su resultado caduca al instante; F28 debe llamarla dentro de su transacción tras
 * `SELECT … FOR UPDATE` de la fila del motorista. Una sentencia (`riders LEFT JOIN branch_delivery_settings`) + una llamada
 * al puerto. Orden estable de razones: NOT_FOUND (cortocircuito), INACTIVE, WRONG_BRANCH, UNAVAILABLE, BUSY,
 * OWN_DELIVERY_DISABLED. `UNAVAILABLE` solo se añade a un motorista ACTIVO (un inactivo ya es `INACTIVE`). `busyKnown=false`
 * NO añade `BUSY`. Sin ruta HTTP: la autorización del actor es de F28.
 */
@Injectable()
export class RiderEligibilityService {
  constructor(
    @Inject(RidersRepository) private readonly repo: RidersRepository,
    @Inject(RIDER_ACTIVE_DELIVERIES_PORT) private readonly busyPort: RiderActiveDeliveriesPort,
  ) {}

  async evaluate(
    input: { riderId: string; branchId: string },
    tx?: TxClient,
  ): Promise<RiderEligibility> {
    // F28 (spec 029 §11 F27-3): `findEligibilityRow` castea `::uuid`; un valor inválido sería un 500. Se valida ANTES.
    const row =
      isUUID(input.riderId) && isUUID(input.branchId)
        ? await this.repo.findEligibilityRow(input.riderId, input.branchId, tx)
        : null;
    if (!row) {
      return {
        riderId: input.riderId,
        branchId: input.branchId,
        riderBranchId: null,
        active: false,
        available: false,
        busy: false,
        busyKnown: false,
        eligible: false,
        reasons: ['NOT_FOUND'],
      };
    }
    const busyInfo = await this.busyPort.findBusy({ riderIds: [input.riderId] }, tx);
    const busy = busyInfo.known && busyInfo.busyIds.has(input.riderId);
    const reasons: RiderIneligibleReason[] = [];
    if (!row.active) reasons.push('INACTIVE');
    if (row.riderBranchId !== input.branchId) reasons.push('WRONG_BRANCH');
    if (row.active && row.availability !== 'AVAILABLE') reasons.push('UNAVAILABLE');
    if (busy) reasons.push('BUSY');
    if (!row.ownDeliveryEnabled) reasons.push('OWN_DELIVERY_DISABLED');
    return {
      riderId: input.riderId,
      branchId: input.branchId,
      riderBranchId: row.riderBranchId,
      active: row.active,
      available: row.active && row.availability === 'AVAILABLE',
      busy,
      busyKnown: busyInfo.known,
      eligible: reasons.length === 0,
      reasons,
    };
  }
}
