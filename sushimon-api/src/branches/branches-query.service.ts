import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { StaffContext } from '../identity/identity.types.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { BranchesRepository, type BranchTx } from './branches.repository.js';
import type {
  AdminBranchListQuery,
  AdminBranchPageView,
  AdminBranchView,
  PublicBranchView,
} from './branches.types.js';

const NOT_FOUND = 'Sucursal no encontrada';
const READ = 'branches.read';

/**
 * Consultas de sucursales. Exportado para F08/F09/F13/F17 (horarios, cobertura, precios, bootstrap): es la
 * única vía para saber si una sucursal existe y está ACTIVA administrativamente (no implica abierta, F08).
 */
@Injectable()
export class BranchesQueryService {
  constructor(
    @Inject(BranchesRepository) private readonly repo: BranchesRepository,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  listPublic(): Promise<PublicBranchView[]> {
    return this.repo.listPublic();
  }

  async getPublicById(id: string): Promise<PublicBranchView> {
    const branch = await this.repo.findPublicById(id);
    if (!branch) throw new NotFoundException(NOT_FOUND);
    return branch;
  }

  existsActive(id: string): Promise<boolean> {
    return this.repo.existsActive(id);
  }

  /**
   * Para escrituras de otros módulos: ¿existen TODAS las sucursales y están activas? Se evalúa con el cliente `tx`
   * de la transacción del llamador y las bloquea (FOR SHARE) hasta su fin: nadie puede desactivarlas en medio.
   */
  async allActiveForShare(tx: BranchTx, ids: string[]): Promise<boolean> {
    const unique = [...new Set(ids)];
    return (await this.repo.lockActiveForShare(tx, unique)).length === unique.length;
  }

  /** Ids de sucursales dentro del alcance del empleado para un permiso (por defecto `branches.read`). */
  async idsInScope(
    staff: StaffContext,
    opts: { activeOnly?: boolean; permission?: string } = {},
  ): Promise<string[]> {
    const scope = this.authorization.scopeFor(staff, opts.permission ?? READ);
    if (!scope.allBranches && scope.branchIds.length === 0) return [];
    return this.repo.findIds({
      scope: scope.allBranches ? null : scope.branchIds,
      activeOnly: opts.activeOnly ?? false,
    });
  }

  async listAdmin(staff: StaffContext, query: AdminBranchListQuery): Promise<AdminBranchPageView> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const scope = this.authorization.scopeFor(staff, READ);
    if (!scope.allBranches && scope.branchIds.length === 0) {
      return { items: [], page, pageSize, total: 0 };
    }
    const { items, total } = await this.repo.listAdmin({
      ...query,
      scope: scope.allBranches ? null : scope.branchIds,
      page,
      pageSize,
      sort: query.sort ?? 'name',
      order: query.order ?? 'asc',
    });
    return { items, page, pageSize, total };
  }

  /** Fuera de alcance = inexistente (404): no revela qué sucursales existen. */
  async getAdminById(staff: StaffContext, id: string): Promise<AdminBranchView> {
    const branch = this.authorization.canAccess(staff, READ, id)
      ? await this.repo.findAdminById(id)
      : null;
    if (!branch) throw new NotFoundException(NOT_FOUND);
    return branch;
  }
}
