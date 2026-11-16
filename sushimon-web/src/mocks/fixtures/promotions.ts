import type {
  PromotionKind,
  PromotionScheduleSlot,
  PromotionScope,
} from '@/lib/data-access/models';

/**
 * Promociones del mock (F15, ADR-0021): reproducen `app.promotions` + `promotion_branches|products|weekdays`. Importes como CADENAS
 * decimales, instantes ISO con zona y horario semanal en hora local de `America/Guatemala` (día ISO 1–7; sin cruzar medianoche).
 * Ausencia de sucursales/productos NO significa «todas»: el alcance es explícito (`ALL | SELECTED`). `code = null` = automática;
 * con código = cupón (el código NUNCA sale por el endpoint público). `isHappyHour` no se guarda: se deriva de «automática con
 * horario semanal». Sin `2x1` ni «precio especial» (P15). Los ids del mock son legibles (no UUID) y los de productos coinciden con
 * los del catálogo sembrado.
 *
 * "Ahora" de la demo = miércoles 11 nov 2026, 14:25 en Guatemala: el Happy Hour (lun–jue 15:00–18:00) empieza hoy a las 15:00.
 */
export interface PromotionRecord {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  kind: PromotionKind;
  value: string;
  startsAt: string;
  endsAt: string;
  dineInOnly: boolean;
  active: boolean;
  branchScope: PromotionScope;
  /** Solo con `branchScope = 'SELECTED'`. */
  branchIds: string[];
  productScope: PromotionScope;
  /** Solo con `productScope = 'SELECTED'`. */
  productIds: string[];
  schedule: PromotionScheduleSlot[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

const CREATED = '2026-09-20T18:00:00.000Z';
const mon_thu = [1, 2, 3, 4].map((weekday): PromotionScheduleSlot => ({
  weekday,
  startsAt: '15:00',
  endsAt: '18:00',
}));

const base = {
  version: 1,
  createdAt: CREATED,
  updatedAt: CREATED,
  branchScope: 'ALL',
  branchIds: [],
  productScope: 'ALL',
  productIds: [],
  schedule: [],
  dineInOnly: false,
  active: true,
  code: null,
} as const satisfies Partial<PromotionRecord>;

export const PROMOTION_SEEDS: PromotionRecord[] = [
  {
    ...base,
    id: 'happy-hour',
    name: 'Happy Hour',
    description: 'Tu monchis favorito a precio especial, de lunes a jueves por la tarde.',
    kind: 'PERCENT',
    value: '25.00',
    startsAt: '2026-10-01T06:00:00.000Z',
    endsAt: '2027-01-01T06:00:00.000Z',
    dineInOnly: true,
    productScope: 'SELECTED',
    productIds: [
      'dumplings',
      'loco-ribs',
      'california-roll',
      'cayibel-roll',
      'platanito-roll',
      'moni-roll',
      'cerveza-nacional',
    ],
    schedule: mon_thu,
  },
  {
    ...base,
    id: 'fin-de-mes',
    name: 'Fin de mes: bebidas',
    description: '10 % de descuento en bebidas seleccionadas en las sucursales 1 y 2.',
    kind: 'PERCENT',
    value: '10.00',
    startsAt: '2026-11-01T06:00:00.000Z',
    endsAt: '2026-12-01T06:00:00.000Z',
    branchScope: 'SELECTED',
    branchIds: ['sucursal-1', 'sucursal-2'],
    productScope: 'SELECTED',
    productIds: ['gaseosas', 'agua-pura', 'te-lipton', 'licuado-melon'],
  },
  {
    ...base,
    id: 'bienvenida',
    code: 'BIENVENIDO10',
    name: 'Cupón de bienvenida',
    description: 'Tu primer pedido con descuento. Requiere código.',
    kind: 'PERCENT',
    value: '10.00',
    startsAt: '2026-11-01T06:00:00.000Z',
    endsAt: '2027-02-01T06:00:00.000Z',
  },
  {
    ...base,
    id: 'navidad-rolls',
    name: 'Navidad en rolls',
    description: '15 % de descuento en rolls seleccionados desde el 20 de noviembre.',
    kind: 'PERCENT',
    value: '15.00',
    startsAt: '2026-11-20T06:00:00.000Z',
    endsAt: '2027-01-01T06:00:00.000Z',
    productScope: 'SELECTED',
    productIds: ['acevichado-roll', 'california-roll', 'cayibel-roll', 'platanito-roll'],
  },
  {
    ...base,
    id: 'combo-mon-2',
    code: 'COMBOMON',
    name: 'Combo Mon para 2',
    description: 'Q20.00 menos por unidad en Platanito Roll y Cayibel Roll.',
    kind: 'FIXED_AMOUNT',
    value: '20.00',
    startsAt: '2026-11-01T06:00:00.000Z',
    endsAt: '2026-12-01T06:00:00.000Z',
    active: false,
    productScope: 'SELECTED',
    productIds: ['platanito-roll', 'cayibel-roll'],
  },
  {
    ...base,
    id: 'semana-cliente',
    name: 'Semana del cliente',
    description: '12 % de descuento en todo el menú.',
    kind: 'PERCENT',
    value: '12.00',
    startsAt: '2026-10-15T06:00:00.000Z',
    endsAt: '2026-11-01T06:00:00.000Z',
  },
];
