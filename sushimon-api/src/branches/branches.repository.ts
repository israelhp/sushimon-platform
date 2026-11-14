import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  AdminBranchListQuery,
  AdminBranchView,
  BranchPatch,
  NewBranchData,
  PublicBranchView,
} from './branches.types.js';

export type BranchTx = Prisma.TransactionClient;

const PUBLIC_SELECT = {
  id: true,
  code: true,
  name: true,
  address: true,
  phone: true,
  latitude: true,
  longitude: true,
} satisfies Prisma.BranchSelect;

const ADMIN_SELECT = {
  ...PUBLIC_SELECT,
  active: true,
  createdAt: true,
} satisfies Prisma.BranchSelect;

type PublicRow = Prisma.BranchGetPayload<{ select: typeof PUBLIC_SELECT }>;
type AdminRow = Prisma.BranchGetPayload<{ select: typeof ADMIN_SELECT }>;

/** numeric(10,7) llega como Decimal: la API expone `number` (rango y precisión de coordenadas lo permiten). */
const num = (value: { toString(): string } | null): number | null =>
  value === null ? null : Number(value.toString());

function toPublic(row: PublicRow): PublicBranchView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    address: row.address,
    phone: row.phone,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
  };
}

function toAdmin(row: AdminRow): AdminBranchView {
  return { ...toPublic(row), active: row.active, createdAt: row.createdAt.toISOString() };
}

export interface AdminListFilter extends AdminBranchListQuery {
  /** null = todas las sucursales; lista = solo esas (alcance del empleado). */
  scope: string[] | null;
  page: number;
  pageSize: number;
  sort: NonNullable<AdminBranchListQuery['sort']>;
  order: NonNullable<AdminBranchListQuery['order']>;
}

/** Único punto de acceso a datos de sucursales: selects mínimos y filtros/paginación en SQL. */
@Injectable()
export class BranchesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: BranchTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  async listPublic(): Promise<PublicBranchView[]> {
    const rows = await this.prisma.branch.findMany({
      where: { active: true },
      select: PUBLIC_SELECT,
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
    return rows.map(toPublic);
  }

  async findPublicById(id: string): Promise<PublicBranchView | null> {
    const row = await this.prisma.branch.findFirst({
      where: { id, active: true },
      select: PUBLIC_SELECT,
    });
    return row ? toPublic(row) : null;
  }

  async existsActive(id: string): Promise<boolean> {
    const row = await this.prisma.branch.findFirst({
      where: { id, active: true },
      select: { id: true },
    });
    return row !== null;
  }

  /** Existencia y estado administrativo (sin alcance ni filtro de activa). Para F08. */
  async findStatus(id: string): Promise<{ id: string; active: boolean } | null> {
    return this.prisma.branch.findUnique({ where: { id }, select: { id: true, active: true } });
  }

  /**
   * Bloquea (FOR SHARE) las sucursales ACTIVAS de la lista dentro de la transacción y devuelve sus ids. Impide que
   * se desactiven entre la validación y la escritura de una asignación (usa el cliente `tx`, sin otra conexión).
   */
  async lockActiveForShare(tx: BranchTx, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.branches WHERE id = ANY(${ids}::uuid[]) AND active FOR SHARE`;
    return rows.map((r) => r.id);
  }

  /** Ids de sucursales (opcionalmente solo activas y/o dentro de un alcance). */
  async findIds(opts: { scope: string[] | null; activeOnly: boolean }): Promise<string[]> {
    const rows = await this.prisma.branch.findMany({
      where: {
        ...(opts.scope ? { id: { in: opts.scope } } : {}),
        ...(opts.activeOnly ? { active: true } : {}),
      },
      select: { id: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => r.id);
  }

  /** Bloquea la fila (FOR UPDATE) hasta el fin de la transacción y la devuelve; null si no existe. */
  async findAdminForUpdate(tx: BranchTx, id: string): Promise<AdminBranchView | null> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.branches WHERE id = ${id}::uuid FOR UPDATE`;
    return locked.length === 0 ? null : this.findAdminById(id, tx);
  }

  async findAdminById(id: string, tx?: BranchTx): Promise<AdminBranchView | null> {
    const row = await (tx ?? this.prisma).branch.findUnique({
      where: { id },
      select: ADMIN_SELECT,
    });
    return row ? toAdmin(row) : null;
  }

  async listAdmin(f: AdminListFilter): Promise<{ items: AdminBranchView[]; total: number }> {
    const q = f.q?.trim();
    const where: Prisma.BranchWhereInput = {
      ...(f.scope ? { id: { in: f.scope } } : {}),
      ...(f.active !== undefined ? { active: f.active } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { code: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        select: ADMIN_SELECT,
        orderBy: [{ [f.sort]: f.order }, { id: 'asc' }],
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.branch.count({ where }),
    ]);
    return { items: rows.map(toAdmin), total };
  }

  async insert(tx: BranchTx, data: NewBranchData): Promise<AdminBranchView> {
    return toAdmin(await tx.branch.create({ data, select: ADMIN_SELECT }));
  }

  async update(tx: BranchTx, id: string, data: BranchPatch | { active: boolean }) {
    return toAdmin(await tx.branch.update({ where: { id }, data, select: ADMIN_SELECT }));
  }
}
