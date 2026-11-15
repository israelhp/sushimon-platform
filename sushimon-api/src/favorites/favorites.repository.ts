import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

/** Espera máxima por el candado del cliente (como branch-schedule) y límites de la transacción de alta. */
const LOCK_TIMEOUT = '2s';
const WRITE_TX_OPTIONS = { maxWait: 2_000, timeout: 5_000 };

export type AddOutcome = 'CREATED' | 'EXISTS' | 'LIMIT';

export interface FavoriteRow {
  productId: string;
  createdAt: Date;
}

/**
 * Acceso a `app.customer_favorites` (F06). Selects mínimos, siempre acotados por `customer_id` (el del JWT, resuelto
 * por el servicio) y sin consultas por fila. Orden fijo `created_at DESC, product_id ASC` (índice de listado).
 */
@Injectable()
export class FavoritesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Hasta `limit` favoritos (id y fecha), más recientes primero. */
  list(customerId: string, limit: number): Promise<FavoriteRow[]> {
    return this.prisma.customerFavorite.findMany({
      where: { customerId },
      select: { productId: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { productId: 'asc' }],
      take: limit,
    });
  }

  /** Solo ids (hasta `limit`), más recientes primero. */
  async listProductIds(customerId: string, limit: number): Promise<string[]> {
    const rows = await this.prisma.customerFavorite.findMany({
      where: { customerId },
      select: { productId: true },
      orderBy: [{ createdAt: 'desc' }, { productId: 'asc' }],
      take: limit,
    });
    return rows.map((r) => r.productId);
  }

  /** Idempotente: borra solo si el par pertenece al cliente. */
  async remove(customerId: string, productId: string): Promise<void> {
    await this.prisma.customerFavorite.deleteMany({ where: { customerId, productId } });
  }

  /**
   * Alta con tope EXACTO bajo concurrencia (D10), en una transacción: (a) `FOR NO KEY UPDATE` sobre la fila del
   * cliente serializa las altas del mismo cliente sin bloquear la FK de otros inserts; (b) cuenta; (c) con cupo,
   * `INSERT … ON CONFLICT DO NOTHING`; (d) sin cupo, el par ya existente es éxito y el nuevo es `LIMIT`.
   */
  add(customerId: string, productId: string, limit: number): Promise<AddOutcome> {
    return this.prisma.$transaction(async (tx) => {
      // Espera de candado corta: una ráfaga del mismo cliente no debe agotar el pool (55P03 => 503 FAVORITES_BUSY).
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
      const locked = await tx.$queryRaw<{ one: number }[]>`
        SELECT 1 AS one FROM app.customers WHERE id = ${customerId}::uuid FOR NO KEY UPDATE`;
      if (locked.length === 0) throw new Error('Fila de cliente inexistente al marcar favorito');

      const count = await tx.customerFavorite.count({ where: { customerId } });
      if (count < limit) {
        const { count: inserted } = await tx.customerFavorite.createMany({
          data: [{ customerId, productId }],
          skipDuplicates: true,
        });
        return inserted === 1 ? 'CREATED' : 'EXISTS';
      }
      const existing = await tx.customerFavorite.findUnique({
        where: { customerId_productId: { customerId, productId } },
        select: { productId: true },
      });
      return existing ? 'EXISTS' : 'LIMIT';
    }, WRITE_TX_OPTIONS);
  }
}
