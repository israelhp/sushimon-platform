import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { folded } from '../products/products.repository.js';
import type {
  BranchProductRow,
  BranchStatus,
  MatrixFilter,
  MatrixRow,
  ProductBranchRow,
  ProductFacts,
  ResolveRow,
} from './branch-products.types.js';

export type BranchProductTx = Prisma.TransactionClient;

interface RawState {
  price_override: string | null;
  available: boolean;
  updated_at: Date;
}

const toRow = (r: RawState): BranchProductRow => ({
  priceOverride: r.price_override,
  available: r.available,
  updatedAt: r.updated_at,
});

/** Único punto de acceso a datos de `app.branch_products`: SQL parametrizado, una consulta por lectura. */
@Injectable()
export class BranchProductsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** READ COMMITTED explícito; `lock_timeout` local: la espera es corta y vence como 55P03 (=> 503 `BRANCH_PRODUCTS_BUSY`). */
  transaction<T>(fn: (tx: BranchProductTx) => Promise<T>): Promise<T> {
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

  async findBranchStatus(id: string, tx?: BranchProductTx): Promise<BranchStatus | null> {
    return (tx ?? this.prisma).branch.findUnique({
      where: { id },
      select: { id: true, active: true },
    });
  }

  async findProduct(id: string, tx?: BranchProductTx): Promise<ProductFacts | null> {
    const row = await (tx ?? this.prisma).product.findUnique({
      where: { id },
      select: { id: true, basePrice: true, active: true, categoryId: true },
    });
    return row ? { ...row, basePrice: row.basePrice.toFixed(2) } : null;
  }

  /**
   * Lee la fila vigente BLOQUEÁNDOLA (`FOR NO KEY UPDATE`, solo existe dentro de la transacción de escritura): el estado
   * previo usado para decidir no-op y para los valores `old` de la auditoría no puede cambiar hasta el COMMIT. Sin
   * deadlock: cada transacción toca UNA sola fila (PK) y siempre en el mismo orden (lock y luego upsert de esa fila). Si
   * la fila no existe no bloquea nada: dos altas simultáneas se resuelven con `ON CONFLICT`.
   */
  async findRow(
    tx: BranchProductTx,
    branchId: string,
    productId: string,
  ): Promise<BranchProductRow | null> {
    const rows = await tx.$queryRaw<RawState[]>`
      SELECT price_override::text AS price_override, available, updated_at
        FROM app.branch_products
       WHERE branch_id = ${branchId}::uuid AND product_id = ${productId}::uuid
         FOR NO KEY UPDATE`;
    return rows[0] ? toRow(rows[0]) : null;
  }

  /** Upsert que toca SOLO `price_override` (y `updated_at`): un PUT y un PATCH concurrentes no se pisan. */
  async upsertPrice(
    tx: BranchProductTx,
    branchId: string,
    productId: string,
    price: string | null,
    now: Date,
  ): Promise<BranchProductRow> {
    const rows = await tx.$queryRaw<RawState[]>`
      INSERT INTO app.branch_products (branch_id, product_id, price_override, created_at, updated_at)
      VALUES (${branchId}::uuid, ${productId}::uuid, ${price}::numeric(12,2), ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT (branch_id, product_id)
      DO UPDATE SET price_override = EXCLUDED.price_override, updated_at = EXCLUDED.updated_at
      RETURNING price_override::text AS price_override, available, updated_at`;
    return toRow(rows[0] as RawState);
  }

  /** Upsert que toca SOLO `available` (y `updated_at`). */
  async upsertAvailability(
    tx: BranchProductTx,
    branchId: string,
    productId: string,
    available: boolean,
    now: Date,
  ): Promise<BranchProductRow> {
    const rows = await tx.$queryRaw<RawState[]>`
      INSERT INTO app.branch_products (branch_id, product_id, available, created_at, updated_at)
      VALUES (${branchId}::uuid, ${productId}::uuid, ${available}, ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT (branch_id, product_id)
      DO UPDATE SET available = EXCLUDED.available, updated_at = EXCLUDED.updated_at
      RETURNING price_override::text AS price_override, available, updated_at`;
    return toRow(rows[0] as RawState);
  }

  /** Borra la fila SOLO si volvió al estado por defecto (D2). Devuelve si se borró. */
  async deleteIfDefault(
    tx: BranchProductTx,
    branchId: string,
    productId: string,
  ): Promise<boolean> {
    const count = await tx.$executeRaw`
      DELETE FROM app.branch_products
       WHERE branch_id = ${branchId}::uuid AND product_id = ${productId}::uuid
         AND price_override IS NULL AND available`;
    return count > 0;
  }

  /** Matriz por sucursal: página + total. Orden `name, id`; búsqueda con patrón ya escapado. */
  async findMatrix(
    branchId: string,
    filter: MatrixFilter,
  ): Promise<{ rows: MatrixRow[]; total: number }> {
    const conditions: Prisma.Sql[] = [];
    if (filter.categoryId !== undefined)
      conditions.push(Prisma.sql`p.category_id = ${filter.categoryId}::uuid`);
    if (filter.available !== undefined)
      conditions.push(Prisma.sql`coalesce(bp.available, true) = ${filter.available}`);
    if (filter.hasOverride !== undefined) {
      conditions.push(
        filter.hasOverride
          ? Prisma.sql`bp.price_override IS NOT NULL`
          : Prisma.sql`bp.price_override IS NULL`,
      );
    }
    if (filter.pattern) {
      const like = (column: string) => Prisma.sql`${folded(column)} LIKE ${filter.pattern}::text`;
      conditions.push(
        Prisma.sql`(${Prisma.join(['p.name', 'p.slug', "coalesce(p.sku, '')"].map(like), ' OR ')})`,
      );
    }
    const where =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const from = Prisma.sql`FROM app.products p
      LEFT JOIN app.branch_products bp ON bp.product_id = p.id AND bp.branch_id = ${branchId}::uuid`;
    const offset = (filter.page - 1) * filter.pageSize;
    interface Raw {
      id: string;
      sku: string | null;
      slug: string;
      name: string;
      category_id: string;
      active: boolean;
      base_price: string;
      price_override: string | null;
      available: boolean;
      updated_at: Date | null;
    }
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<Raw[]>`
        SELECT p.id, p.sku, p.slug, p.name, p.category_id, p.active, p.base_price::text AS base_price,
               bp.price_override::text AS price_override, coalesce(bp.available, true) AS available,
               bp.updated_at
          ${from} ${where}
         ORDER BY p.name ASC, p.id ASC
         LIMIT ${filter.pageSize}::int OFFSET ${offset}::int`,
      this.prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total ${from} ${where}`,
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        slug: r.slug,
        name: r.name,
        categoryId: r.category_id,
        active: r.active,
        basePrice: r.base_price,
        priceOverride: r.price_override,
        available: r.available,
        updatedAt: r.updated_at,
      })),
      total: count[0]?.total ?? 0,
    };
  }

  /** Sucursales (todas o solo `branchIds`) con la fila de este producto, orden `name, id`. UNA consulta. */
  async findProductBranches(
    productId: string,
    branchIds: readonly string[] | null,
  ): Promise<ProductBranchRow[]> {
    if (branchIds !== null && branchIds.length === 0) return [];
    const scope =
      branchIds === null ? Prisma.empty : Prisma.sql`WHERE b.id = ANY(${[...branchIds]}::uuid[])`;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        code: string;
        name: string;
        active: boolean;
        price_override: string | null;
        available: boolean;
        updated_at: Date | null;
      }[]
    >`
      SELECT b.id, b.code, b.name, b.active, bp.price_override::text AS price_override,
             coalesce(bp.available, true) AS available, bp.updated_at
        FROM app.branches b
        LEFT JOIN app.branch_products bp ON bp.branch_id = b.id AND bp.product_id = ${productId}::uuid
        ${scope}
       ORDER BY b.name ASC, b.id ASC`;
    return rows.map((r) => ({
      branchId: r.id,
      code: r.code,
      name: r.name,
      active: r.active,
      priceOverride: r.price_override,
      available: r.available,
      updatedAt: r.updated_at,
    }));
  }

  /** Precio efectivo y disponibilidad de varios productos en UNA consulta (ids inexistentes no aparecen). */
  async resolveMany(branchId: string, productIds: readonly string[]): Promise<ResolveRow[]> {
    if (productIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        active: boolean;
        category_id: string;
        base_price: string;
        price: string;
        available: boolean;
      }[]
    >`
      SELECT p.id, p.active, p.category_id, p.base_price::text AS base_price,
             coalesce(bp.price_override, p.base_price)::text AS price,
             coalesce(bp.available, true) AS available
        FROM app.products p
        LEFT JOIN app.branch_products bp ON bp.product_id = p.id AND bp.branch_id = ${branchId}::uuid
       WHERE p.id = ANY(${[...productIds]}::uuid[])`;
    return rows.map((r) => ({
      id: r.id,
      active: r.active,
      categoryId: r.category_id,
      basePrice: r.base_price,
      price: r.price,
      available: r.available,
    }));
  }
}
