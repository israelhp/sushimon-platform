import { Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { TxClient } from '../riders.types.js';
import type {
  RiderActiveDeliveriesPort,
  RiderBusyQuery,
  RiderBusyResult,
} from './rider-active-deliveries.port.js';

/**
 * Adaptador REAL del puerto de ocupación (F28, spec 029 §11 F27-1; reemplaza a `NoActiveDeliveriesAdapter` en `RidersModule`).
 * `known = true`: un motorista está OCUPADO si tiene una entrega `assigned`, `picked_up` o `delivered` (hasta registrar el
 * retorno). Lectura SQL de `app.deliveries`: por `riderIds` usa `deliveries_one_active_per_rider_idx` (índice único parcial) y por
 * `branchIds` el índice `(branch_id, status, …)`. Una sentencia, sin escribir y sin bloquear; con `tx` corre en la transacción del
 * llamador (F28 lo usa dentro de la asignación). Solo ids: ningún dato personal.
 */
@Injectable()
export class RiderActiveDeliveriesAdapter implements RiderActiveDeliveriesPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findBusy(query: RiderBusyQuery, tx?: TxClient): Promise<RiderBusyResult> {
    const client: TxClient = tx ?? this.prisma;
    let rows: { rider_id: string }[];
    if ('riderIds' in query) {
      // Un id que no es UUID jamás puede estar ocupado (y casted a ::uuid sería un 500): se descarta.
      const ids = [...new Set(query.riderIds)].filter((id) => isUUID(id));
      if (ids.length === 0) return { known: true, busyIds: new Set<string>() };
      rows = await client.$queryRaw<{ rider_id: string }[]>(Prisma.sql`
        SELECT DISTINCT rider_id FROM app.deliveries
         WHERE rider_id = ANY(${ids}::uuid[]) AND status IN ('assigned', 'picked_up', 'delivered')`);
    } else if (query.branchIds === null) {
      rows = await client.$queryRaw<{ rider_id: string }[]>(Prisma.sql`
        SELECT DISTINCT rider_id FROM app.deliveries
         WHERE status IN ('assigned', 'picked_up', 'delivered') AND rider_id IS NOT NULL`);
    } else {
      const branches = query.branchIds.filter((id) => isUUID(id));
      if (branches.length === 0) return { known: true, busyIds: new Set<string>() };
      rows = await client.$queryRaw<{ rider_id: string }[]>(Prisma.sql`
        SELECT DISTINCT rider_id FROM app.deliveries
         WHERE branch_id = ANY(${branches}::uuid[]) AND status IN ('assigned', 'picked_up', 'delivered')
           AND rider_id IS NOT NULL`);
    }
    return { known: true, busyIds: new Set(rows.map((r) => r.rider_id)) };
  }
}
