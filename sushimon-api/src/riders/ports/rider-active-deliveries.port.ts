import { Injectable } from '@nestjs/common';
import type { TxClient } from '../riders.types.js';

/**
 * Puerto de lectura de entregas ACTIVAS de motoristas (F27, spec 028 §8.1). F28 (entregas propias) lo implementa con un
 * adaptador `known=true` que consulta `deliveries` y reemplaza el provider del módulo, sin tocar controladores ni contrato.
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
 * Adaptador por defecto: «F28 no existe». No simula entregas ni inventa datos: `known=false`, sin sentencias SQL. Los comandos
 * peligrosos (desactivar, `UNAVAILABLE`, traslado) no pueden bloquear por entrega activa hasta que F28 lo reemplace.
 */
@Injectable()
export class NoActiveDeliveriesAdapter implements RiderActiveDeliveriesPort {
  findBusy(): Promise<RiderBusyResult> {
    return Promise.resolve({ known: false, busyIds: new Set<string>() });
  }
}
