import { Inject, Injectable } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import { DbGate, type DbGateRunOptions } from '../common/concurrency/db-gate.js';
import type { StaffContext } from '../identity/identity.types.js';
import type { AdminRiderDto, AdminRiderPageDto } from './dto/riders-responses.dto.js';
import type { ListAdminRidersQuery } from './dto/riders-requests.dto.js';
import { normalizeSearch } from './rider-policy.js';
import { toDetail, toSummary } from './rider-view.js';
import {
  RIDER_ACTIVE_DELIVERIES_PORT,
  type RiderActiveDeliveriesPort,
} from './ports/rider-active-deliveries.port.js';
import { riderNotFound, RIDERS_DB_GATE, translateRidersDbError } from './riders-errors.js';
import { RidersRepository } from './riders.repository.js';

/** Lecturas de bajo valor: con el cupo lleno se rechazan si ya hay 2 esperas; las plazas siguientes son de las escrituras. */
const READ_ADMISSION: DbGateRunOptions = { rejectIfWaiting: 2 };

/**
 * Lecturas del backoffice de motoristas (F27, spec 028 §3.1). El alcance de `riders.read` se aplica EN SQL (anti-IDOR). La
 * ocupación sale del puerto `RiderActiveDeliveriesPort` (con el adaptador por defecto, `busyKnown=false`). El listado nunca
 * entrega el teléfono completo ni la placa. Sin logs de datos personales.
 */
@Injectable()
export class RidersQueriesService {
  constructor(
    @Inject(RidersRepository) private readonly repo: RidersRepository,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(RIDER_ACTIVE_DELIVERIES_PORT) private readonly busyPort: RiderActiveDeliveriesPort,
    @Inject(RIDERS_DB_GATE) private readonly gate: DbGate,
  ) {}

  async list(staff: StaffContext, query: ListAdminRidersQuery): Promise<AdminRiderPageDto> {
    const scope = this.scopeOf(staff, 'riders.read');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (scope !== null && scope.length === 0) return { items: [], page, pageSize, total: 0 };
    const branchIds = query.branchId !== undefined ? [query.branchId] : scope;
    const key = normalizeSearch(query.q);

    const result = await this.db(async () => {
      const busy = await this.busyPort.findBusy({ branchIds });
      const filter = {
        scope,
        ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
        ...(query.active !== undefined ? { active: query.active } : {}),
        ...(query.availability !== undefined ? { availability: query.availability } : {}),
        ...(key !== undefined ? { key } : {}),
        busyIds: busy.known ? [...busy.busyIds] : [],
        sort: query.sort ?? 'fullName',
        order: query.order ?? 'asc',
        page,
        pageSize,
      } as const;
      return { busy, ...(await this.repo.list(filter)) };
    }, READ_ADMISSION);

    return {
      items: result.rows.map((row) => toSummary(row, result.busy)),
      page,
      pageSize,
      total: result.total,
    };
  }

  async get(staff: StaffContext, id: string): Promise<AdminRiderDto> {
    const scope = this.scopeOf(staff, 'riders.read');
    const rider = await this.db(() => this.repo.findOne(id, scope), READ_ADMISSION);
    if (!rider) throw riderNotFound();
    const busy = await this.db(
      () => this.busyPort.findBusy({ riderIds: [rider.id] }),
      READ_ADMISSION,
    );
    return toDetail(rider, busy);
  }

  /** `null` = todas las sucursales; lista = SOLO esas. */
  private scopeOf(staff: StaffContext, permission: string): string[] | null {
    const scope = this.authorization.scopeFor(staff, permission);
    return scope.allBranches ? null : scope.branchIds;
  }

  private async db<T>(task: () => Promise<T>, options?: DbGateRunOptions): Promise<T> {
    try {
      return await this.gate.run(task, options);
    } catch (error) {
      throw translateRidersDbError(error);
    }
  }
}
