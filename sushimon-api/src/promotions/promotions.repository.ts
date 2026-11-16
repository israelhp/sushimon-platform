import { Inject, Injectable } from '@nestjs/common';
import { formatClock, parsePgTime } from '../branch-schedule/business-time.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { folded } from '../products/products.repository.js';
import type {
  NewPromotion,
  ProductBasics,
  PromotionKind,
  PromotionLists,
  PromotionPageFilter,
  PromotionRecord,
  PromotionScalars,
  PromotionSort,
  ScheduleSlot,
  StoreCandidateRecord,
} from './promotions.types.js';

export type PromotionTx = Prisma.TransactionClient;

const SORT_COLUMNS: Record<PromotionSort, string> = {
  startsAt: 'p.starts_at',
  endsAt: 'p.ends_at',
  name: 'p.name',
  createdAt: 'p.created_at',
};

/** Filtro de candidatas: vigencia por instantes, sucursal y qué códigos se incluyen. */
export interface CandidateQuery {
  branchId: string;
  /** `starts_at <= startsBefore` (inclusivo). */
  startsBefore: Date;
  /** `ends_at > endsAfter` (exclusivo). */
  endsAfter: Date;
  /** `'all'` (tienda) o solo automáticas más la del cupón indicado (F19). */
  codes: 'all' | { coupon: string | null };
  /**
   * Tienda: no leer `product_ids` de promociones con código (nunca se publican). F19: `false` (los necesita el
   * evaluador).
   */
  omitCouponProducts: boolean;
  limit: number;
}

interface RawCandidate {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  kind: string;
  value: string;
  starts_at: Date;
  ends_at: Date;
  dine_in_only: boolean;
  active: boolean;
  branch_ids: string[];
  product_ids: string[];
  has_products: boolean;
  slots: { weekday: number; startsAt: string; endsAt: string }[];
}

const toSlot = (s: { weekday: number; startsAt: string; endsAt: string }): ScheduleSlot => ({
  weekday: Number(s.weekday),
  startsAt: formatClock(parsePgTime(s.startsAt)),
  endsAt: formatClock(parsePgTime(s.endsAt)),
});

/**
 * Único punto de acceso a datos de promociones. `promotion_weekdays` se lee y escribe con SQL parametrizado
 * (`::text` / `::time`): una `time` con '24:00:00' no es segura con los métodos tipados de Prisma (como en 0006).
 * El resto usa el cliente tipado. Una consulta por lectura; sin N+1.
 */
@Injectable()
export class PromotionsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** READ COMMITTED explícito; `lock_timeout` local: la espera vence como 55P03 (=> 503 `PROMOTIONS_BUSY`). */
  transaction<T>(fn: (tx: PromotionTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
        return fn(tx);
      },
      {
        timeout: 15_000,
        maxWait: 5_000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  async findBranchStatus(
    id: string,
    tx?: PromotionTx,
  ): Promise<{ id: string; active: boolean } | null> {
    return (tx ?? this.prisma).branch.findUnique({
      where: { id },
      select: { id: true, active: true },
    });
  }

  /** Sucursales existentes entre `ids` (una consulta). */
  async findBranches(
    ids: readonly string[],
    tx?: PromotionTx,
  ): Promise<{ id: string; name: string }[]> {
    if (ids.length === 0) return [];
    return (tx ?? this.prisma).branch.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
  }

  /** Ids de productos existentes entre `ids` (una consulta). */
  async findExistingProductIds(ids: readonly string[], tx?: PromotionTx): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await (tx ?? this.prisma).product.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async findProductBasics(ids: readonly string[]): Promise<ProductBasics[]> {
    if (ids.length === 0) return [];
    return this.prisma.product.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true, active: true, categoryId: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  /** Bloquea la fila hasta el fin de la transacción (serializa PATCH concurrentes); `false` si no existe. */
  async lockPromotion(tx: PromotionTx, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM app.promotions WHERE id = ${id}::uuid FOR UPDATE`;
    return rows.length > 0;
  }

  /**
   * Promociones con sus sucursales, tramos y (opcional) productos. Orden no garantizado: el llamador reordena.
   * `products` solo se llena con `withProducts`; `productCount` siempre.
   */
  async findRecords(
    ids: readonly string[],
    opts: { withProducts: boolean },
    tx?: PromotionTx,
  ): Promise<PromotionRecord[]> {
    if (ids.length === 0) return [];
    const db = tx ?? this.prisma;
    const list = [...ids];
    const [rows, weekdays, products] = await Promise.all([
      db.promotion.findMany({
        where: { id: { in: list } },
        include: {
          branches: { select: { branch: { select: { id: true, name: true } } } },
          _count: { select: { products: true } },
        },
      }),
      db.$queryRaw<{ promotion_id: string; weekday: number; starts_at: string; ends_at: string }[]>`
        SELECT promotion_id::text AS promotion_id, weekday::int AS weekday,
               starts_at::text AS starts_at, ends_at::text AS ends_at
          FROM app.promotion_weekdays
         WHERE promotion_id = ANY(${list}::uuid[])
         ORDER BY weekday, starts_at`,
      opts.withProducts
        ? db.promotionProduct.findMany({
            where: { promotionId: { in: list } },
            select: {
              promotionId: true,
              product: { select: { id: true, name: true, slug: true } },
            },
          })
        : Promise.resolve([]),
    ]);
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      kind: r.kind as PromotionKind,
      value: r.value.toFixed(2),
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      dineInOnly: r.dineInOnly,
      active: r.active,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      branches: r.branches
        .map((b) => b.branch)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      products: products
        .filter((p) => p.promotionId === r.id)
        .map((p) => p.product)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      productCount: r._count.products,
      schedule: weekdays
        .filter((w) => w.promotion_id === r.id)
        .map((w) => toSlot({ weekday: w.weekday, startsAt: w.starts_at, endsAt: w.ends_at })),
    }));
  }

  async createPromotion(tx: PromotionTx, data: NewPromotion, now: Date): Promise<string> {
    const created = await tx.promotion.create({
      data: {
        code: data.code,
        name: data.name,
        description: data.description,
        kind: data.kind,
        value: data.value,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        dineInOnly: data.dineInOnly,
        active: data.active,
        createdAt: now,
        updatedAt: now,
        branches: { create: data.branchIds.map((branchId) => ({ branchId })) },
        products: { create: data.productIds.map((productId) => ({ productId })) },
      },
      select: { id: true },
    });
    await this.insertSchedule(tx, created.id, data.schedule);
    return created.id;
  }

  /** Aplica los cambios y sube `version` en 1 (el llamador ya tiene la fila bloqueada). */
  async savePromotion(
    tx: PromotionTx,
    id: string,
    scalars: PromotionScalars,
    lists: PromotionLists,
    now: Date,
  ): Promise<void> {
    await tx.promotion.update({
      where: { id },
      data: {
        ...(scalars.code !== undefined ? { code: scalars.code } : {}),
        ...(scalars.name !== undefined ? { name: scalars.name } : {}),
        ...(scalars.description !== undefined ? { description: scalars.description } : {}),
        ...(scalars.kind !== undefined ? { kind: scalars.kind } : {}),
        ...(scalars.value !== undefined ? { value: scalars.value } : {}),
        ...(scalars.startsAt !== undefined ? { startsAt: scalars.startsAt } : {}),
        ...(scalars.endsAt !== undefined ? { endsAt: scalars.endsAt } : {}),
        ...(scalars.dineInOnly !== undefined ? { dineInOnly: scalars.dineInOnly } : {}),
        ...(scalars.active !== undefined ? { active: scalars.active } : {}),
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (lists.branchIds) {
      await tx.promotionBranch.deleteMany({ where: { promotionId: id } });
      if (lists.branchIds.length > 0) {
        await tx.promotionBranch.createMany({
          data: lists.branchIds.map((branchId) => ({ promotionId: id, branchId })),
        });
      }
    }
    if (lists.productIds) {
      await tx.promotionProduct.deleteMany({ where: { promotionId: id } });
      if (lists.productIds.length > 0) {
        await tx.promotionProduct.createMany({
          data: lists.productIds.map((productId) => ({ promotionId: id, productId })),
        });
      }
    }
    if (lists.schedule) {
      await tx.$executeRaw`DELETE FROM app.promotion_weekdays WHERE promotion_id = ${id}::uuid`;
      await this.insertSchedule(tx, id, lists.schedule);
    }
  }

  private async insertSchedule(
    tx: PromotionTx,
    id: string,
    schedule: readonly ScheduleSlot[],
  ): Promise<void> {
    if (schedule.length === 0) return;
    await tx.$executeRaw`
      INSERT INTO app.promotion_weekdays (promotion_id, weekday, starts_at, ends_at)
      SELECT ${id}::uuid, t.w::smallint, t.s::time, t.e::time
        FROM unnest(${schedule.map((s) => String(s.weekday))}::text[], ${schedule.map((s) => s.startsAt)}::text[], ${schedule.map((s) => s.endsAt)}::text[])
          AS t(w, s, e)`;
  }

  /** Página de ids (orden pedido, `id` desempata) + total. Búsqueda con patrón ya escapado (comodines literales). */
  async findPage(f: PromotionPageFilter): Promise<{ ids: string[]; total: number }> {
    if (f.scopeBranchIds !== null && f.scopeBranchIds.length === 0) return { ids: [], total: 0 };
    const conditions: Prisma.Sql[] = [];
    const appliesTo = (branchIds: readonly string[]): Prisma.Sql =>
      Prisma.sql`(NOT EXISTS (SELECT 1 FROM app.promotion_branches pb0 WHERE pb0.promotion_id = p.id)
        OR EXISTS (SELECT 1 FROM app.promotion_branches pb1
                    WHERE pb1.promotion_id = p.id AND pb1.branch_id = ANY(${[...branchIds]}::uuid[])))`;
    if (f.scopeBranchIds !== null) conditions.push(appliesTo(f.scopeBranchIds));
    if (f.branchId !== undefined) conditions.push(appliesTo([f.branchId]));
    if (f.kind !== undefined) conditions.push(Prisma.sql`p.kind = ${f.kind}`);
    if (f.status === 'active') conditions.push(Prisma.sql`p.active`);
    if (f.status === 'inactive') conditions.push(Prisma.sql`NOT p.active`);
    if (f.status === 'scheduled')
      conditions.push(Prisma.sql`p.active AND p.starts_at > ${f.now}::timestamptz`);
    if (f.status === 'running')
      conditions.push(
        Prisma.sql`p.active AND p.starts_at <= ${f.now}::timestamptz AND p.ends_at > ${f.now}::timestamptz`,
      );
    if (f.status === 'expired')
      conditions.push(Prisma.sql`p.active AND p.ends_at <= ${f.now}::timestamptz`);
    if (f.from !== undefined) conditions.push(Prisma.sql`p.ends_at > ${f.from}::timestamptz`);
    if (f.to !== undefined) conditions.push(Prisma.sql`p.starts_at < ${f.to}::timestamptz`);
    if (f.pattern) {
      const like = (column: string) => Prisma.sql`${folded(column)} LIKE ${f.pattern}::text`;
      conditions.push(
        Prisma.sql`(${Prisma.join(['p.name', "coalesce(p.code, '')"].map(like), ' OR ')})`,
      );
    }
    const where =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const column = Prisma.raw(SORT_COLUMNS[f.sort]);
    const direction = Prisma.raw(f.order === 'asc' ? 'ASC' : 'DESC');
    const offset = (f.page - 1) * f.pageSize;
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id::text AS id FROM app.promotions p ${where}
         ORDER BY ${column} ${direction}, p.id ASC
         LIMIT ${f.pageSize}::int OFFSET ${offset}::int`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM app.promotions p ${where}`,
    ]);
    return { ids: rows.map((r) => r.id), total: count[0]?.total ?? 0 };
  }

  /**
   * Candidatas activas de una sucursal (propias y «todas») con sus sucursales, productos y tramos, en UNA consulta.
   * Orden `starts_at, id`; `limit` acota la lectura.
   */
  async findCandidates(q: CandidateQuery): Promise<StoreCandidateRecord[]> {
    const codes =
      q.codes === 'all'
        ? Prisma.empty
        : q.codes.coupon === null
          ? Prisma.sql`AND p.code IS NULL`
          : Prisma.sql`AND (p.code IS NULL OR p.code = ${q.codes.coupon}::text)`;
    // F19: el cupón pedido va PRIMERO, de modo que un recorte por tope jamás lo descarte.
    const order =
      q.codes === 'all'
        ? Prisma.sql`p.starts_at ASC, p.id ASC`
        : Prisma.sql`(p.code IS NULL) ASC, p.starts_at ASC, p.id ASC`;
    const rows = await this.prisma.$queryRaw<RawCandidate[]>`
      SELECT p.id::text AS id, p.code, p.name, p.description, p.kind, p.value::text AS value,
             p.starts_at, p.ends_at, p.dine_in_only, p.active,
             COALESCE((SELECT json_agg(pb.branch_id::text ORDER BY pb.branch_id)
                         FROM app.promotion_branches pb WHERE pb.promotion_id = p.id), '[]'::json) AS branch_ids,
             CASE WHEN ${q.omitCouponProducts}::boolean AND p.code IS NOT NULL THEN '[]'::json
                  ELSE COALESCE((SELECT json_agg(pp.product_id::text ORDER BY pp.product_id)
                                   FROM app.promotion_products pp WHERE pp.promotion_id = p.id), '[]'::json) END AS product_ids,
             EXISTS (SELECT 1 FROM app.promotion_products px WHERE px.promotion_id = p.id) AS has_products,
             COALESCE((SELECT json_agg(json_build_object('weekday', w.weekday::int, 'startsAt', w.starts_at::text,
                                                         'endsAt', w.ends_at::text) ORDER BY w.weekday, w.starts_at)
                         FROM app.promotion_weekdays w WHERE w.promotion_id = p.id), '[]'::json) AS slots
        FROM app.promotions p
       WHERE p.active
         AND p.starts_at <= ${q.startsBefore}::timestamptz
         AND p.ends_at > ${q.endsAfter}::timestamptz
         AND (NOT EXISTS (SELECT 1 FROM app.promotion_branches b0 WHERE b0.promotion_id = p.id)
              OR EXISTS (SELECT 1 FROM app.promotion_branches b1
                          WHERE b1.promotion_id = p.id AND b1.branch_id = ${q.branchId}::uuid))
         ${codes}
       ORDER BY ${order}
       LIMIT ${q.limit}::int`;
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      kind: r.kind as PromotionKind,
      value: r.value,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      dineInOnly: r.dine_in_only,
      active: r.active,
      branchIds: r.branch_ids,
      productIds: r.product_ids,
      hasProducts: r.has_products,
      schedule: r.slots.map(toSlot),
    }));
  }
}
