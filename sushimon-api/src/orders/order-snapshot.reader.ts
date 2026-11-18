import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

/** Nombres vigentes que se COPIAN al snapshot del pedido (los importes salen de la recotización, no de aquí). */
export interface SnapshotNames {
  products: Map<string, string>;
  modifiers: Map<string, string>;
  promotions: Map<string, string>;
}

/**
 * Lectura de nombres de snapshot por LOTE (F20, spec 021 §3.9): exactamente 3 consultas (`findMany … in`), en paralelo y
 * ANTES de la transacción, sin N+1 con 30 líneas. Solo nombres: ningún precio ni importe del catálogo se usa para el
 * pedido (la autoridad es la recotización, ADR-0026 D2).
 */
@Injectable()
export class OrderSnapshotReader {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async read(input: {
    productIds: readonly string[];
    modifierIds: readonly string[];
    promotionIds: readonly string[];
  }): Promise<SnapshotNames> {
    const [products, modifiers, promotions] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: [...input.productIds] } },
        select: { id: true, name: true },
      }),
      input.modifierIds.length === 0
        ? Promise.resolve([] as { id: string; name: string }[])
        : this.prisma.modifier.findMany({
            where: { id: { in: [...input.modifierIds] } },
            select: { id: true, name: true },
          }),
      input.promotionIds.length === 0
        ? Promise.resolve([] as { id: string; name: string }[])
        : this.prisma.promotion.findMany({
            where: { id: { in: [...input.promotionIds] } },
            select: { id: true, name: true },
          }),
    ]);
    const toMap = (rows: { id: string; name: string }[]) =>
      new Map(rows.map((r) => [r.id, r.name]));
    return {
      products: toMap(products),
      modifiers: toMap(modifiers),
      promotions: toMap(promotions),
    };
  }
}
