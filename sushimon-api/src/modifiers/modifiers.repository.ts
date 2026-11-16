import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { SQL_ACCENTS_FROM, SQL_ACCENTS_TO } from '../products/product-policy.js';
import type {
  GroupPageFilter,
  GroupPatch,
  GroupRow,
  GroupSummaryRow,
  NewGroupData,
  NewOptionData,
  OfferRow,
  OptionPatch,
  OptionRow,
} from './modifiers.types.js';

export type ModifierTx = Prisma.TransactionClient;

const GROUP_SELECT = {
  id: true,
  name: true,
  minSelect: true,
  maxSelect: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ModifierGroupSelect;

const OPTION_SELECT = {
  id: true,
  groupId: true,
  name: true,
  extraPrice: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ModifierSelect;

type DbOption = Prisma.ModifierGetPayload<{ select: typeof OPTION_SELECT }>;

const toOption = (o: DbOption): OptionRow => ({ ...o, extraPrice: o.extraPrice.toFixed(2) });

interface RawSummary {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  option_count: number;
  active_option_count: number;
  product_count: number;
}

const rawToSummary = (r: RawSummary): GroupSummaryRow => ({
  id: r.id,
  name: r.name,
  minSelect: Number(r.min_select),
  maxSelect: Number(r.max_select),
  active: r.active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  optionCount: Number(r.option_count),
  activeOptionCount: Number(r.active_option_count),
  productCount: Number(r.product_count),
});

/** Columnas del grupo más los TRES conteos en la misma sentencia (sin N+1). */
const SUMMARY_COLUMNS = Prisma.sql`g.id, g.name, g.min_select, g.max_select, g.active, g.created_at, g.updated_at,
  coalesce(mo.option_count, 0)::int AS option_count,
  coalesce(mo.active_option_count, 0)::int AS active_option_count,
  (SELECT count(*)::int FROM app.product_modifier_groups l2 WHERE l2.group_id = g.id) AS product_count`;

const OPTION_COUNTS = Prisma.sql`LEFT JOIN LATERAL (
    SELECT count(*)::int AS option_count, (count(*) FILTER (WHERE m.active))::int AS active_option_count
      FROM app.modifiers m WHERE m.group_id = g.id) mo ON true`;

/** Único punto de acceso a datos de modificadores: una consulta por lectura, selects mínimos. */
@Injectable()
export class ModifiersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * READ COMMITTED explícito (los triggers de tope de 0013 lo exigen; no depender del valor por defecto). `lock_timeout` local: la espera por la fila bloqueada
   * es corta y vence como 55P03 (=> 503 `MODIFIERS_BUSY`).
   */
  transaction<T>(fn: (tx: ModifierTx) => Promise<T>): Promise<T> {
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

  /** Bloquea la fila del grupo (`FOR NO KEY UPDATE`: no choca con el KEY SHARE de las FK). `false` si no existe. */
  async lockGroup(tx: ModifierTx, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.modifier_groups WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    return rows.length > 0;
  }

  async lockProduct(tx: ModifierTx, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.products WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    return rows.length > 0;
  }

  async findGroupById(id: string, tx?: ModifierTx): Promise<GroupRow | null> {
    return (tx ?? this.prisma).modifierGroup.findUnique({ where: { id }, select: GROUP_SELECT });
  }

  /** Grupos por ids, ordenados por id (orden estable de lectura). */
  async findGroupsByIds(ids: readonly string[], tx?: ModifierTx): Promise<GroupRow[]> {
    if (ids.length === 0) return [];
    return (tx ?? this.prisma).modifierGroup.findMany({
      where: { id: { in: [...ids] } },
      select: GROUP_SELECT,
      orderBy: { id: 'asc' },
    });
  }

  async findOptionById(id: string, tx?: ModifierTx): Promise<OptionRow | null> {
    const row = await (tx ?? this.prisma).modifier.findUnique({
      where: { id },
      select: OPTION_SELECT,
    });
    return row ? toOption(row) : null;
  }

  /** Opciones de varios grupos en UNA consulta (orden: grupo, sort_order). */
  async findOptionsByGroupIds(groupIds: readonly string[], tx?: ModifierTx): Promise<OptionRow[]> {
    if (groupIds.length === 0) return [];
    const rows = await (tx ?? this.prisma).modifier.findMany({
      where: { groupId: { in: [...groupIds] } },
      select: OPTION_SELECT,
      orderBy: [{ groupId: 'asc' }, { sortOrder: 'asc' }],
    });
    return rows.map(toOption);
  }

  /** Una página (más su total) de grupos con sus conteos agregados en la MISMA sentencia. */
  async findGroupPage(
    filter: GroupPageFilter,
  ): Promise<{ rows: GroupSummaryRow[]; total: number }> {
    const conditions: Prisma.Sql[] = [];
    if (filter.active !== undefined) conditions.push(Prisma.sql`g.active = ${filter.active}`);
    if (filter.pattern) {
      conditions.push(
        Prisma.sql`lower(translate(g.name, ${SQL_ACCENTS_FROM}::text, ${SQL_ACCENTS_TO}::text)) LIKE ${filter.pattern}::text`,
      );
    }
    const where =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const offset = (filter.page - 1) * filter.pageSize;
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<RawSummary[]>`
        SELECT ${SUMMARY_COLUMNS}
          FROM app.modifier_groups g ${OPTION_COUNTS} ${where}
         ORDER BY g.name ASC, g.id ASC
         LIMIT ${filter.pageSize}::int OFFSET ${offset}::int`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM app.modifier_groups g ${where}`,
    ]);
    return { rows: rows.map(rawToSummary), total: count[0]?.total ?? 0 };
  }

  async findGroupSummary(id: string, tx?: ModifierTx): Promise<GroupSummaryRow | null> {
    const rows = await (tx ?? this.prisma).$queryRaw<RawSummary[]>`
      SELECT ${SUMMARY_COLUMNS}
        FROM app.modifier_groups g ${OPTION_COUNTS}
       WHERE g.id = ${id}::uuid`;
    const row = rows[0];
    return row ? rawToSummary(row) : null;
  }

  /**
   * Grupos asociados a un producto (orden de asociación) con conteos, en UNA consulta que además prueba la existencia
   * del producto: `null` si no existe; `[]` si no tiene grupos.
   */
  async findProductGroupSummaries(
    productId: string,
    tx?: ModifierTx,
  ): Promise<GroupSummaryRow[] | null> {
    const rows = await (tx ?? this.prisma).$queryRaw<(RawSummary | NullSummary)[]>`
      SELECT ${SUMMARY_COLUMNS}
        FROM app.products p
        LEFT JOIN app.product_modifier_groups l ON l.product_id = p.id
        LEFT JOIN app.modifier_groups g ON g.id = l.group_id
        ${OPTION_COUNTS}
       WHERE p.id = ${productId}::uuid
       ORDER BY l.sort_order ASC`;
    if (rows.length === 0) return null;
    return rows.filter((r): r is RawSummary => r.id !== null).map(rawToSummary);
  }

  /**
   * Ficha pública y validador: producto → grupos asociados → opciones, en UNA consulta (orden de asociación y de
   * `sort_order`). `null` si el producto no existe. No filtra activos: lo decide la policy.
   */
  async findOffer(productId: string, tx?: ModifierTx): Promise<OfferRow[] | null> {
    const rows = await (tx ?? this.prisma).$queryRaw<RawOffer[]>`
      SELECT g.id AS group_id, g.name AS group_name, g.min_select, g.max_select, g.active AS group_active,
             m.id AS modifier_id, m.name AS modifier_name, m.extra_price::text AS extra_price,
             m.active AS modifier_active
        FROM app.products p
        LEFT JOIN app.product_modifier_groups l ON l.product_id = p.id
        LEFT JOIN app.modifier_groups g ON g.id = l.group_id
        LEFT JOIN app.modifiers m ON m.group_id = g.id
       WHERE p.id = ${productId}::uuid
       ORDER BY l.sort_order ASC, m.sort_order ASC`;
    if (rows.length === 0) return null;
    return rows.map((r) => ({
      groupId: r.group_id,
      groupName: r.group_name,
      minSelect: r.min_select === null ? null : Number(r.min_select),
      maxSelect: r.max_select === null ? null : Number(r.max_select),
      groupActive: r.group_active,
      modifierId: r.modifier_id,
      modifierName: r.modifier_name,
      extraPrice: r.extra_price,
      modifierActive: r.modifier_active,
    }));
  }

  /** Asociaciones actuales del producto, en orden. */
  async findProductLinks(
    tx: ModifierTx,
    productId: string,
  ): Promise<{ groupId: string; sortOrder: number }[]> {
    return tx.productModifierGroup.findMany({
      where: { productId },
      select: { groupId: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  insertGroup(tx: ModifierTx, data: NewGroupData): Promise<GroupRow> {
    return tx.modifierGroup.create({ data, select: GROUP_SELECT });
  }

  updateGroup(tx: ModifierTx, id: string, data: GroupPatch): Promise<GroupRow> {
    return tx.modifierGroup.update({ where: { id }, data, select: GROUP_SELECT });
  }

  async insertOptions(tx: ModifierTx, items: readonly NewOptionData[]): Promise<OptionRow[]> {
    if (items.length === 0) return [];
    const rows = await tx.modifier.createManyAndReturn({
      data: items.map((i) => ({ ...i })),
      select: OPTION_SELECT,
    });
    return rows.map(toOption).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async updateOption(tx: ModifierTx, id: string, data: OptionPatch): Promise<OptionRow> {
    return toOption(await tx.modifier.update({ where: { id }, data, select: OPTION_SELECT }));
  }

  /**
   * Asigna `sort_order` 0..n-1 en una sola sentencia. La UNIQUE (group_id, sort_order) es DEFERRABLE INITIALLY
   * DEFERRED: el choque transitorio se evalúa al COMMIT. Sin upsert/ON CONFLICT.
   */
  async setOptionOrder(
    tx: ModifierTx,
    groupId: string,
    orderedIds: readonly string[],
  ): Promise<void> {
    const orders = orderedIds.map((_, i) => i);
    await tx.$executeRaw`
      UPDATE app.modifiers m SET sort_order = v.ord, updated_at = now()
        FROM unnest(${[...orderedIds]}::uuid[], ${orders}::int[]) AS v(id, ord)
       WHERE m.id = v.id AND m.group_id = ${groupId}::uuid`;
  }

  /**
   * Reemplaza TODA la lista del producto: DELETE y luego INSERT en la misma transacción (el trigger de tope exige
   * borrar antes de insertar; la UNIQUE de sort_order es DEFERRABLE). Sin upsert/ON CONFLICT.
   */
  async replaceProductLinks(
    tx: ModifierTx,
    productId: string,
    groupIds: readonly string[],
  ): Promise<void> {
    await tx.productModifierGroup.deleteMany({ where: { productId } });
    if (groupIds.length === 0) return;
    await tx.productModifierGroup.createMany({
      data: groupIds.map((groupId, sortOrder) => ({ productId, groupId, sortOrder })),
    });
  }
}

interface NullSummary {
  id: null;
}

interface RawOffer {
  group_id: string | null;
  group_name: string | null;
  min_select: number | null;
  max_select: number | null;
  group_active: boolean | null;
  modifier_id: string | null;
  modifier_name: string | null;
  extra_price: string | null;
  modifier_active: boolean | null;
}
