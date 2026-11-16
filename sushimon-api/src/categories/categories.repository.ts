import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  CategoryNode,
  CategoryPatch,
  CategoryRow,
  NewCategoryData,
} from './categories.types.js';

export type CategoryTx = Prisma.TransactionClient;

const NODE_SELECT = {
  id: true,
  parentId: true,
  slug: true,
  name: true,
  description: true,
  sortOrder: true,
  active: true,
} satisfies Prisma.CategorySelect;

const ROW_SELECT = {
  ...NODE_SELECT,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

const ORDER = [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }] as const;

/** Único punto de acceso a datos de categorías: una consulta por lectura, selects mínimos. */
@Injectable()
export class CategoriesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Tope de la transacción (500 filas máx.) y de espera por conexión; el lock de jerarquía espera como mucho 3 s. */
  transaction<T>(fn: (tx: CategoryTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 15_000, maxWait: 5_000 });
  }

  /**
   * Bloqueo transaccional de jerarquía (clave 1100110, la MISMA del trigger de 0011). Debe ser lo PRIMERO que hace
   * la transacción, antes de leer para validar; se libera solo al COMMIT/ROLLBACK. READ COMMITTED (por defecto).
   */
  async lockHierarchy(tx: CategoryTx): Promise<void> {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1100110)`;
  }

  /** Árbol público: SOLO lo necesario para armarlo (sin marcas de tiempo). Una consulta. */
  findAllNodes(): Promise<CategoryNode[]> {
    return this.prisma.category.findMany({ select: NODE_SELECT, orderBy: [...ORDER] });
  }

  findAllRows(tx?: CategoryTx): Promise<CategoryRow[]> {
    return (tx ?? this.prisma).category.findMany({ select: ROW_SELECT, orderBy: [...ORDER] });
  }

  insert(tx: CategoryTx, data: NewCategoryData): Promise<CategoryRow> {
    return tx.category.create({ data, select: ROW_SELECT });
  }

  update(tx: CategoryTx, id: string, data: CategoryPatch): Promise<CategoryRow> {
    return tx.category.update({ where: { id }, data, select: ROW_SELECT });
  }
}
