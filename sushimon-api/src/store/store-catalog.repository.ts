import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { folded as foldedExpr } from '../products/products.repository.js';
import { SUMMARY_SOURCE_CHARS } from './store-policy.js';
import type { CardFilter, CardRow } from './store-catalog.types.js';

interface RawCard {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category_id: string;
  price: string;
  available: boolean | null;
  media_url: string | null;
  alt_text: string | null;
  total: number;
}

/**
 * Único punto de SQL de las tarjetas públicas del menú y de la búsqueda (F17). UNA consulta compuesta por lectura:
 * productos activos de las categorías visibles + `LEFT JOIN branch_products` de ESA sucursal (F13) + `LEFT JOIN
 * product_media` (imagen principal, `sort_order = 0`, único por la UNIQUE de F11) + `count(*) OVER()` para el total.
 * Todo parametrizado; el orden sale de una lista blanca y `id` desempata siempre. Nada administrativo (sin SKU).
 */
@Injectable()
export class StoreCatalogRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private conditions(f: CardFilter): Prisma.Sql[] {
    const out: Prisma.Sql[] = [
      Prisma.sql`p.active`,
      Prisma.sql`p.category_id = ANY(${[...f.categoryIds]}::uuid[])`,
    ];
    if (f.branchId !== null && f.availableOnly) out.push(Prisma.sql`coalesce(bp.available, true)`);
    if (f.search) {
      const like = (column: string) =>
        Prisma.sql`${foldedExpr(column)} LIKE ${f.search?.contains}::text`;
      // `left(…, 500)` acota el trabajo de plegado por fila (el resumen ya usa solo los primeros 400).
      const parts = [
        Prisma.sql`n.fname LIKE ${f.search?.contains}::text`,
        like("coalesce(left(p.description, 500), '')"),
      ];
      if (f.search.categoryIds.length > 0) {
        parts.push(Prisma.sql`p.category_id = ANY(${[...f.search.categoryIds]}::uuid[])`);
      }
      out.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`);
    }
    return out;
  }

  private from(f: CardFilter): Prisma.Sql {
    const branch =
      f.branchId === null
        ? Prisma.empty
        : Prisma.sql`LEFT JOIN app.branch_products bp ON bp.product_id = p.id AND bp.branch_id = ${f.branchId}::uuid`;
    // El nombre plegado se calcula UNA vez por fila y se reutiliza en el filtro y en el rango de relevancia.
    const lateral = f.search
      ? Prisma.sql`CROSS JOIN LATERAL (SELECT ${foldedExpr('p.name')} AS fname) n`
      : Prisma.empty;
    return Prisma.sql`FROM app.products p ${lateral} ${branch}`;
  }

  /** Tarjetas de la página y el total (`count(*) OVER()`); `total = null` si la página queda vacía (cuéntese aparte). */
  async findCards(f: CardFilter): Promise<{ rows: CardRow[]; total: number | null }> {
    if (f.categoryIds.length === 0) return { rows: [], total: 0 };
    const price =
      f.branchId === null
        ? Prisma.sql`p.base_price`
        : Prisma.sql`coalesce(bp.price_override, p.base_price)`;
    const available =
      f.branchId === null ? Prisma.sql`NULL::boolean` : Prisma.sql`coalesce(bp.available, true)`;
    const direction = Prisma.raw(f.order === 'desc' ? 'DESC' : 'ASC');
    let order: Prisma.Sql;
    if (f.sort === 'relevance' && f.search) {
      order = Prisma.sql`search_group ASC, p.name ASC, p.id ASC`;
    } else if (f.sort === 'name') {
      order = Prisma.sql`p.name ${direction}, p.id ASC`;
    } else if (f.sort === 'price') {
      order = Prisma.sql`${price} ${direction}, p.id ASC`;
    } else {
      order = Prisma.sql`array_position(${[...f.categoryIds]}::uuid[], p.category_id) ASC, p.name ASC, p.id ASC`;
    }
    const where = Prisma.sql`WHERE ${Prisma.join(this.conditions(f), ' AND ')}`;
    const group =
      f.sort === 'relevance' && f.search
        ? Prisma.sql`CASE WHEN n.fname LIKE ${f.search.prefix}::text THEN 0
                          WHEN n.fname LIKE ${f.search.contains}::text THEN 1 ELSE 2 END AS search_group,`
        : Prisma.empty;
    const rows = await this.prisma.$queryRaw<RawCard[]>`
      SELECT p.id, p.slug, p.name, left(p.description, ${SUMMARY_SOURCE_CHARS}::int) AS description,
             p.category_id, ${price}::text AS price, ${available} AS available,
             ${group} pm.media_url, pm.alt_text, count(*) OVER()::int AS total
        ${this.from(f)}
        LEFT JOIN app.product_media pm ON pm.product_id = p.id AND pm.sort_order = 0
        ${where}
       ORDER BY ${order}
       LIMIT ${f.limit}::int OFFSET ${f.offset}::int`;
    return {
      rows: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        categoryId: r.category_id,
        price: r.price,
        available: r.available,
        imageUrl: r.media_url,
        imageAlt: r.alt_text,
      })),
      total: rows[0]?.total ?? null,
    };
  }

  /** Total del filtro (solo cuando la página pedida está fuera de rango y no hubo filas que lo traigan). */
  async countCards(f: CardFilter): Promise<number> {
    if (f.categoryIds.length === 0) return 0;
    const where = Prisma.sql`WHERE ${Prisma.join(this.conditions(f), ' AND ')}`;
    const rows = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total ${this.from(f)} ${where}`;
    return rows[0]?.total ?? 0;
  }

  /** Productos visibles (activos en categorías visibles), disponibles o no: contador del pie del Inicio. */
  async countVisible(categoryIds: readonly string[]): Promise<number> {
    if (categoryIds.length === 0) return 0;
    const rows = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total FROM app.products p
       WHERE p.active AND p.category_id = ANY(${[...categoryIds]}::uuid[])`;
    return rows[0]?.total ?? 0;
  }
}
