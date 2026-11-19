import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { MyOrderRow, MyOrdersFilter } from './my-orders.types.js';

interface MyOrderDbRow {
  id: string;
  order_number: bigint;
  status: string;
  branch_id: string;
  branch_name: string;
  fulfillment_type: string;
  delivery_provider: string | null;
  total: string;
  payment_method_preference: string | null;
  placed_at: Date;
  updated_at: Date;
  item_count: number;
  placed_at_key: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Historial del cliente (F23, spec 024 §6): UNA sentencia parametrizada con `$queryRaw` (nada del cliente se interpola). El
 * propietario se aplica EN SQL por join a `customers.auth_user_id` (un usuario sin fila de cliente o un pedido de invitado,
 * `customer_id` NULL, nunca coinciden). Se prueba contra PostgreSQL real en `test/order-history.int-spec.ts`.
 */
@Injectable()
export class MyOrdersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Una página (`limit + 1` filas para saber si hay más; sin conteo total). */
  async list(filter: MyOrdersFilter): Promise<MyOrderRow[]> {
    // Un `sub` que no sea UUID nunca coincide con un cliente (y evita un 22P02 de la BD).
    if (!UUID.test(filter.authUserId)) return [];
    // `customer_id IS NOT NULL` hace elegible el índice PARCIAL `orders_customer_placed_idx` (0018); el join ya lo implica.
    const where: Prisma.Sql[] = [Prisma.sql`o.customer_id IS NOT NULL`];
    if (filter.status) where.push(Prisma.sql`o.status = ANY(${[...filter.status]}::text[])`);
    if (filter.branchId) where.push(Prisma.sql`o.branch_id = ${filter.branchId}::uuid`);
    if (filter.from)
      where.push(Prisma.sql`o.placed_at >= ${filter.from.toISOString()}::timestamptz`);
    if (filter.to) where.push(Prisma.sql`o.placed_at < ${filter.to.toISOString()}::timestamptz`);
    if (filter.cursor) {
      where.push(
        Prisma.sql`(o.placed_at, o.id) < (${filter.cursor.placedAtKey}::timestamptz, ${filter.cursor.id}::uuid)`,
      );
    }
    const extra =
      where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<MyOrderDbRow[]>(Prisma.sql`
      SELECT o.id, o.order_number, o.status, o.branch_id, b.name AS branch_name,
             o.fulfillment_type, o.delivery_provider, o.total::text AS total, o.payment_method_preference,
             o.placed_at, o.updated_at,
             COALESCE((SELECT sum(i.quantity) FROM app.order_items i WHERE i.order_id = o.id), 0)::int AS item_count,
             to_char(o.placed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS placed_at_key
        FROM app.orders o
        JOIN app.customers c ON c.id = o.customer_id AND c.auth_user_id = ${filter.authUserId}::uuid
        JOIN app.branches b ON b.id = o.branch_id
        ${extra}
       ORDER BY o.placed_at DESC, o.id DESC
       LIMIT ${filter.limit + 1}`);
    return rows.map((r) => ({
      id: r.id,
      orderNumber: BigInt(r.order_number),
      status: r.status,
      branchId: r.branch_id,
      branchName: r.branch_name,
      fulfillmentType: r.fulfillment_type,
      deliveryProvider: r.delivery_provider,
      total: r.total,
      paymentMethodPreference: r.payment_method_preference,
      placedAt: r.placed_at,
      updatedAt: r.updated_at,
      itemCount: Number(r.item_count),
      placedAtKey: r.placed_at_key,
    }));
  }
}
