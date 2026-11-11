import type { Order, OrderAddress, OrderLine, OrderStatusEvent } from '@/lib/data-access/models';
import { addDaysISO, dayOfWeekOf, fromLocal, minutesToHM } from '@/lib/time';
import { BRANCH_SEEDS } from '../fixtures/branches';
import { PRODUCT_SEEDS } from '../fixtures/products';
import { COURIER_RIDER_NAMES, REJECTION_REASONS, RIDER_SEEDS } from '../fixtures/staff';
import { DELIVERY_TIER_SEEDS } from '../fixtures/store';
import { event, round2, tierFor, totals } from '../domain';
import { intBetween, pick, rngFor, weighted, type Rng } from './random';

/**
 * Generador determinista del historial (60 días, como `genDay()` del backoffice) a partir de la
 * semilla "fecha|sucursal|n". Los días pasados NO se guardan en el store: se regeneran igual en
 * cada llamada. Usa los precios del catálogo canónico sembrado.
 *
 * Volumen por sucursal y día = base × factor del día × ruido (0.88–1.12):
 *   base: sucursal-1 38 · sucursal-2 34 · sucursal-3 28; vie/sáb ×1.25, dom ×1.12, lun ×0.86.
 * Hoy: solo los pedidos "de antes" (12:00–13:07; 32/28/22 con 1/1/0 rechazados). Los vivos de hoy
 * son los sembrados en el store.
 */
export const HISTORY_DAYS = 60;

const BASE: Record<string, number> = { 'sucursal-1': 38, 'sucursal-2': 34, 'sucursal-3': 28 };
const TODAY_EARLY: Record<string, { delivered: number; cancelled: number }> = {
  'sucursal-1': { delivered: 31, cancelled: 1 },
  'sucursal-2': { delivered: 27, cancelled: 1 },
  'sucursal-3': { delivered: 22, cancelled: 0 },
};
const HISTORY_BRANCHES = Object.keys(BASE);
/** Último número de pedido generado para "hoy" (los sembrados vivos siguen en 307044+). */
const TODAY_SEQ_END = 7043;
const HOUR_WEIGHTS = [0.05, 0.1, 0.12, 0.08, 0.05, 0.06, 0.1, 0.15, 0.13, 0.1, 0.06];

/** Pesos de popularidad (PW del backoffice) trasladados con el mapeo de productos. */
const PRODUCT_WEIGHTS: Record<string, number> = {
  'platanito-roll': 9,
  'california-roll': 8.2,
  'cayibel-roll': 7.4,
  'salomon-roll': 7,
  'dynamita-roll': 6.1,
  'acevichado-roll': 5.3,
  'la-suegra-roll': 5,
  'mulato-roll': 4.2,
  dumplings: 4,
  'joselito-roll': 3.1,
  'alaska-roll': 3,
  'poporopos-cangrejo': 2.6,
  'loco-ribs': 3,
  'te-lipton': 3.5,
  'licuado-sandia': 2.4,
  gaseosas: 2,
  'helados-asiaticos': 2.2,
  'licuado-melon': 1.8,
};
const WEIGHTED_PRODUCTS = PRODUCT_SEEDS.map((p) => ({
  value: p,
  weight: PRODUCT_WEIGHTS[p.id] ?? 1,
}));

const FIRST = [
  'Andrea',
  'José',
  'María',
  'Diego',
  'Lucía',
  'Carlos',
  'Gabriela',
  'Rodrigo',
  'Sofía',
  'Javier',
  'Valeria',
  'Fernando',
  'Paola',
  'Daniela',
  'Mónica',
  'Estuardo',
  'Ana',
  'Jorge',
  'Kevin',
  'Ximena',
  'Pablo',
  'Mariana',
  'Luis',
  'Camila',
];
const LAST = [
  'Morales',
  'Ruiz',
  'López',
  'Castillo',
  'Herrera',
  'Méndez',
  'Pineda',
  'Estrada',
  'Barrios',
  'Orellana',
  'Cifuentes',
  'Ajú',
  'Galindo',
  'Monterroso',
  'Rivera',
  'Paz',
  'Solís',
  'Ixcot',
  'Hernández',
  'García',
  'Pérez',
  'Rodas',
  'Juárez',
  'Samayoa',
];
const gt = (zone: string, line: string): OrderAddress => ({
  department: 'Guatemala',
  municipality: 'Guatemala',
  zone,
  line,
  references: '',
});
/** Direcciones por sucursal, todas dentro de su cobertura canónica. */
const ADDRESSES: Record<string, OrderAddress[]> = {
  'sucursal-1': [
    gt('9', 'Avenida Reforma 8-60, Zona 9'),
    gt('9', '7a avenida 14-44, Zona 9'),
    gt('1', '5a calle 2-30, Zona 1'),
    gt('13', 'Avenida Las Américas 9-08, Zona 13'),
    gt('10', '12 calle 1-25, Zona 10'),
    gt('4', 'Vía 6 4-21, Zona 4'),
  ],
  'sucursal-2': [
    gt('10', '4a avenida 15-70, Zona 10'),
    gt('10', '15 calle 3-20, Zona 10'),
    gt('9', '6a avenida 9-18, Zona 9'),
    gt('10', '20 calle 25-55, Zona 10'),
    gt('14', 'Avenida La Reforma 14-50, Zona 14'),
    gt('15', '2a calle 23-80, Zona 15'),
  ],
  'sucursal-3': [
    gt('11', 'Calzada Roosevelt 22-43, Zona 11'),
    gt('7', 'Calzada San Juan 14-06, Zona 7'),
    gt('12', 'Avenida Petapa 32-10, Zona 12'),
    gt('8', '28 calle 6-50, Zona 8'),
    {
      department: 'Guatemala',
      municipality: 'Mixco',
      zone: '',
      line: 'Lomas de Portugal, 3a calle 5-20',
      references: '',
    },
    gt('13', 'Colonia Aurora, 2a calle 23-80, Zona 13'),
  ],
};
const NOTES = ['Sin wasabi', 'Salsa aparte', 'Sin cebollín', 'Extra jengibre'];
const SURCHARGES = [0, 0, 0, 0, 0, 0, 0, 2.5, 4, 6.5];
const OFFSETS = { accepted: 2, preparing: 5, ready: 16, on_the_way: 24, delivered: 42 };

function dayFactor(dow: number) {
  return dow === 5 || dow === 6 ? 1.25 : dow === 0 ? 1.12 : dow === 1 ? 0.86 : 1;
}

function countFor(dateISO: string, branchId: string, isToday: boolean) {
  if (isToday) {
    const t = TODAY_EARLY[branchId];
    return t ? t.delivered + t.cancelled : 0;
  }
  const r = rngFor(`count|${dateISO}|${branchId}`)();
  return Math.round((BASE[branchId] ?? 0) * dayFactor(dayOfWeekOf(dateISO)) * (0.88 + 0.24 * r));
}

function dayTotal(dateISO: string, today: string) {
  return HISTORY_BRANCHES.reduce((n, b) => n + countFor(dateISO, b, dateISO === today), 0);
}

/** Primer día con historial disponible. */
export function historyMinDate(today: string): string {
  return addDaysISO(today, -(HISTORY_DAYS - 1));
}

/** Último número de la secuencia del día (como seqEnd del prototipo). */
function seqEnd(dateISO: string, today: string): number {
  let end = TODAY_SEQ_END;
  for (let d = today; d > dateISO; d = addDaysISO(d, -1)) end -= dayTotal(d, today);
  return end;
}

function localMinuteOfOrder(rng: Rng, isToday: boolean) {
  if (isToday) return 720 + Math.floor(rng() * 68);
  let x = rng();
  let h = 0;
  for (; h < 10; h++) {
    x -= HOUR_WEIGHTS[h] ?? 0;
    if (x <= 0) break;
  }
  return (12 + h) * 60 + Math.floor(rng() * 60);
}

const cache = new Map<string, Order[]>();

/**
 * Pedidos generados de un día (`YYYY-MM-DD`) respecto de `today`. Fuera de los 60 días → [].
 * Resultado congelado en caché: los consumidores deben clonarlo antes de mutarlo.
 */
export function generateDayOrders(dateISO: string, today: string): Order[] {
  if (dateISO > today || dateISO < historyMinDate(today)) return [];
  const key = `${dateISO}|${today}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const isToday = dateISO === today;
  type Draft = { minute: number; build: (id: string, n: number) => Order };
  const drafts: Draft[] = [];

  HISTORY_BRANCHES.forEach((branchId) => {
    const branch = BRANCH_SEEDS.find((b) => b.id === branchId);
    if (!branch) return;
    const count = countFor(dateISO, branchId, isToday);
    for (let j = 0; j < count; j++) {
      const rng = rngFor(`order|${dateISO}|${branchId}|${j}`);
      const minute = localMinuteOfOrder(rng, isToday);
      const cancelled = isToday ? j < (TODAY_EARLY[branchId]?.cancelled ?? 0) : rng() < 0.025;
      const delivery = rng() < 0.25;
      const nItems = intBetween(rng, 1, 3);
      const lines: OrderLine[] = [];
      for (let q = 0; q < nItems; q++) {
        const p = weighted(rng, WEIGHTED_PRODUCTS);
        const quantity = rng() < 0.25 ? 2 : 1;
        if (lines.some((l) => l.productId === p.id)) continue;
        lines.push({
          productId: p.id,
          name: p.name,
          quantity,
          note: '',
          unitPrice: p.price,
          subtotal: p.price * quantity,
        });
      }
      if (rng() < 0.08 && lines[0]) lines[0].note = pick(rng, NOTES);
      const name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
      const phone = `+502 ${intBetween(rng, 3, 5)}${intBetween(rng, 100, 999)}-${intBetween(rng, 1000, 9999)}`;
      const address = delivery ? pick(rng, ADDRESSES[branchId] ?? []) : null;
      const tier = address ? tierFor(branch, address.municipality, address.zone) : null;
      const fee = tier ? (DELIVERY_TIER_SEEDS.find((t) => t.id === tier)?.fee ?? 0) : 0;
      const reason = cancelled ? pick(rng, REJECTION_REASONS) : null;
      const note = rng() < 0.1 ? 'Por favor llamar al llegar.' : '';
      const payCard = rng() < 0.5;
      const ownRoll = rng();
      const durationRoll = rng();

      drafts.push({
        minute,
        build: (id, n) => {
          const created = fromLocal(dateISO, minutesToHM(minute));
          const at = (offset: number) => new Date(created.getTime() + offset * 60_000);
          const history: OrderStatusEvent[] = [event(created, 'order', 'received')];
          if (cancelled) {
            history.push(event(at(3), 'order', 'rejected', { reason }));
          } else {
            history.push(event(at(OFFSETS.accepted), 'order', 'accepted'));
            history.push(event(at(OFFSETS.preparing), 'order', 'preparing'));
            history.push(event(at(OFFSETS.ready), 'order', 'ready'));
          }
          let deliveryInfo: Order['delivery'] = null;
          let deliveredAt = at(OFFSETS.delivered);
          if (!cancelled && delivery) {
            const own = RIDER_SEEDS.filter((r) => r.branchId === branchId);
            const useOwn = ownRoll < 0.3 && own.length > 0;
            const duration = useOwn ? 25 + ((n * 5) % 26) : 30 + Math.floor(durationRoll * 31);
            deliveredAt = at(duration);
            const requested = at(useOwn ? 15 : 13 + (n % 6));
            const rider = useOwn ? own[n % own.length] : null;
            deliveryInfo = {
              provider: useOwn ? 'own' : 'pedidosya',
              status: 'delivered',
              riderId: rider?.id ?? null,
              riderName: rider
                ? `${rider.name} · moto`
                : (COURIER_RIDER_NAMES[n % COURIER_RIDER_NAMES.length] ?? null),
              reference: useOwn ? null : `PY-GT-77${10000 + ((n * 37) % 89999)}`,
              cost: useOwn ? null : round2(fee + (SURCHARGES[(n * 3) % 10] ?? 0)),
              requestedAt: requested.toISOString(),
              etaAt: deliveredAt.toISOString(),
              deliveredAt: deliveredAt.toISOString(),
              simulated: true,
            };
            history.push(
              event(requested, 'delivery', 'searching', { detail: deliveryInfo.reference }),
            );
            history.push(event(at(OFFSETS.on_the_way), 'order', 'on_the_way'));
          }
          if (!cancelled) history.push(event(deliveredAt, 'order', 'delivered'));
          const t = totals(lines, fee);
          return {
            id,
            createdAt: created.toISOString(),
            updatedAt: history[history.length - 1]?.at ?? created.toISOString(),
            branchId,
            fulfillment: delivery ? 'delivery' : 'pickup',
            schedule: { kind: 'now' },
            customer: {
              name,
              phone,
              email: `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(' ', '.')}@ejemplo.com`,
            },
            address,
            lines,
            ...t,
            currency: 'GTQ',
            note,
            deliveryTier: tier,
            status: cancelled ? 'rejected' : 'delivered',
            rejectionReason: reason,
            payment: {
              method: payCard ? 'card' : 'cash',
              status: cancelled && !payCard ? 'pending' : 'approved',
              amount: t.total,
              reference: payCard ? `NNT-DEMO-${10000 + ((n * 53) % 89999)}` : null,
              cardBrand: payCard ? 'Visa' : null,
              cardLast4: payCard ? '4242' : null,
              simulated: true,
              processedAt: payCard
                ? at(1).toISOString()
                : cancelled
                  ? null
                  : deliveredAt.toISOString(),
            },
            delivery: deliveryInfo,
            history,
            incidents: [],
          };
        },
      });
    }
  });

  drafts.sort((a, b) => a.minute - b.minute);
  const end = seqEnd(dateISO, today);
  const list = drafts.map((d, i) => {
    const n = end - drafts.length + 1 + i;
    return d.build(`MON-3${String(n).padStart(5, '0')}`, n);
  });
  const frozen = Object.freeze(list) as Order[];
  cache.set(key, frozen);
  return frozen;
}

/** Días (`YYYY-MM-DD`) entre from y to (inclusive), recortados a los 60 disponibles. */
export function clampRange(from: string, to: string, today: string) {
  let a = from;
  let b = to;
  if (b < a) [a, b] = [b, a];
  const min = historyMinDate(today);
  const clipped = a < min || b > today;
  if (a < min) a = min;
  if (b > today) b = today;
  const days: string[] = [];
  for (let d = a; d <= b && days.length < HISTORY_DAYS; d = addDaysISO(d, 1)) days.push(d);
  return { days, clipped, min, from: a, to: b };
}
