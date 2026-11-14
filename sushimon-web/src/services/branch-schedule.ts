import type { DataClient } from '@/lib/data-access/types';
import type {
  BranchAvailability,
  BranchClosure,
  BranchClosureList,
  BranchHours,
  CreateBranchClosureRequest,
  PublicBranchHours,
  ReplaceBranchHoursRequest,
  UpdateBranchClosureRequest,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/**
 * F08 — Horarios, cierres y disponibilidad (contrato `branch-schedule`). Operaciones: getBranchHours,
 * getBranchAvailability, getAdminBranchHours, replaceAdminBranchHours, listAdminBranchClosures,
 * createAdminBranchClosure, updateAdminBranchClosure y deleteAdminBranchClosure. La disponibilidad la calcula el
 * SERVIDOR; la web no la recalcula. Horas semanales: `HH:mm` locales de America/Guatemala; instantes: ISO UTC con `Z`.
 */

/** Horario semanal público (7 días ISO 1–7) + cierres próximos SIN motivo. 404 si no existe o está inactiva. */
export const getBranchHours = (client: DataClient, id: string) =>
  client.get<PublicBranchHours>(paths.branchHours(id));

/** Estado actual compacto (`isOpenNow`, `reason`, `nextOpensAt`, `nextTransitionAt`…). 404 si inactiva. */
export const getBranchAvailability = (client: DataClient, id: string) =>
  client.get<BranchAvailability>(paths.branchAvailability(id));

/** Horario administrativo con `version` (`branches.read`). */
export const getAdminBranchHours = (client: DataClient, id: string) =>
  client.get<BranchHours>(paths.adminBranchHours(id));

/** Reemplaza la semana completa (`branches.manage_hours`); 409 `HOURS_VERSION_CONFLICT`, 422 `SCHEDULE_INVALID`. */
export const replaceAdminBranchHours = (
  client: DataClient,
  id: string,
  input: ReplaceBranchHoursRequest,
) => client.put<BranchHours>(paths.adminBranchHours(id), input);

export type ClosureStatusFilter = 'current' | 'upcoming' | 'active' | 'past' | 'all';

export interface ClosureFilters {
  status?: ClosureStatusFilter;
  page?: number;
  pageSize?: number;
}

export const listAdminBranchClosures = (
  client: DataClient,
  id: string,
  filters: ClosureFilters = {},
) =>
  client.get<BranchClosureList>(paths.adminBranchClosures(id), {
    query: { status: filters.status, page: filters.page, pageSize: filters.pageSize },
  });

export const createAdminBranchClosure = (
  client: DataClient,
  id: string,
  input: CreateBranchClosureRequest,
) => client.post<BranchClosure>(paths.adminBranchClosures(id), input);

export const updateAdminBranchClosure = (
  client: DataClient,
  id: string,
  closureId: string,
  input: UpdateBranchClosureRequest,
) => client.patch<BranchClosure>(paths.adminBranchClosure(id, closureId), input);

/** Solo cierres futuros (204). En curso o terminados => 409 `CLOSURE_NOT_DELETABLE`. */
export const deleteAdminBranchClosure = (client: DataClient, id: string, closureId: string) =>
  client.delete<void>(paths.adminBranchClosure(id, closureId));
