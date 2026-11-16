import { formatClock, parsePgTime } from '../branch-schedule/business-time.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { LinkedPromotion } from './banners.types.js';

interface RawLinked {
  id: string;
  name: string;
  active: boolean;
  starts_at: Date;
  ends_at: Date;
  branch_ids: string[];
  slots: { weekday: number; startsAt: string; endsAt: string }[];
}

/** Solo lo que se necesita de un cliente de Prisma (raíz o transacción). */
export type RawReader = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * Datos de TIEMPO de las promociones vinculadas (spec D7/D11): una consulta acotada a los ids de los banners candidatos
 * (<= 100), con sucursales y tramos. NUNCA lee ni devuelve `code`, `kind`, `value` ni productos: el banner no puede
 * filtrarlos. La vigencia la decide `promotion-schedule.ts` (funciones puras de F15), sin importar `PromotionsModule`.
 * `time` se lee con `::text` (una `time` con '24:00:00' no es segura con los métodos tipados de Prisma, como en 0006).
 */
export async function loadLinkedPromotions(
  db: RawReader,
  ids: readonly string[],
): Promise<Map<string, LinkedPromotion>> {
  const out = new Map<string, LinkedPromotion>();
  if (ids.length === 0) return out;
  const rows = await db.$queryRaw<RawLinked[]>`
    SELECT p.id::text AS id, p.name, p.active, p.starts_at, p.ends_at,
           COALESCE((SELECT json_agg(pb.branch_id::text ORDER BY pb.branch_id)
                       FROM app.promotion_branches pb WHERE pb.promotion_id = p.id), '[]'::json) AS branch_ids,
           COALESCE((SELECT json_agg(json_build_object('weekday', w.weekday::int, 'startsAt', w.starts_at::text,
                                                       'endsAt', w.ends_at::text) ORDER BY w.weekday, w.starts_at)
                       FROM app.promotion_weekdays w WHERE w.promotion_id = p.id), '[]'::json) AS slots
      FROM app.promotions p
     WHERE p.id = ANY(${[...ids]}::uuid[])`;
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      name: r.name,
      active: r.active,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      branchIds: r.branch_ids,
      schedule: r.slots.map((s) => ({
        weekday: Number(s.weekday),
        startsAt: formatClock(parsePgTime(s.startsAt)),
        endsAt: formatClock(parsePgTime(s.endsAt)),
      })),
    });
  }
  return out;
}
