import type { HappyHourItem, Promotion } from '@/lib/data-access/models';

/**
 * Promociones del backoffice (PROMOS, 3) conciliadas con el Happy Hour de la tienda:
 * "Happy Hour 2x1" (lun–jue 15:00–18:00, hasta 2026-12-31) es la misma promoción que la tienda
 * muestra como Happy Hour, así que lleva sus 8 ítems, subtítulo y condiciones.
 * kind: 2x1 → '2x1', pct → 'percent', precio → 'fixed_price'. Días: ISO (1 = lunes).
 * `status` se calcula en el handler con el reloj.
 */
export const HAPPY_HOUR_ITEMS: HappyHourItem[] = [
  {
    id: 'papas-mon-locas',
    name: 'Papas Mon Locas',
    priceLabel: 'Q25',
    group: 'Entradas',
    illustration: 'fries',
  },
  {
    id: 'aguacate-crispy',
    name: 'Aguacate Crispy',
    priceLabel: 'Q25',
    group: 'Entradas',
    illustration: 'avocado',
  },
  { id: 'ebi-roll', name: 'Ebi Roll', priceLabel: 'Q39', group: 'Rolls', illustration: 'roll' },
  {
    id: 'juancho-roll',
    name: 'Juancho Roll',
    priceLabel: 'Q39',
    group: 'Rolls',
    illustration: 'roll',
  },
  {
    id: 'tempura-roll',
    name: 'Tempura Roll',
    priceLabel: 'Q39',
    group: 'Rolls',
    illustration: 'roll',
  },
  {
    id: 'hh-california-roll',
    name: 'California Roll',
    priceLabel: 'Q39',
    group: 'Rolls',
    illustration: 'roll',
  },
  { id: 'tuna-roll', name: 'Tuna Roll', priceLabel: 'Q39', group: 'Rolls', illustration: 'roll' },
  {
    id: 'cervezas-nacionales',
    name: 'Cervezas nacionales',
    nameEn: 'Local beers',
    priceLabel: '2 x Q50',
    group: 'Cervezas',
    illustration: 'beer',
  },
];

export type PromotionSeed = Omit<Promotion, 'status'>;

export const PROMOTION_SEEDS: PromotionSeed[] = [
  {
    id: 'happy-hour',
    name: 'Happy Hour 2x1',
    description: 'Lleva dos rollos clásicos y paga uno.',
    kind: '2x1',
    value: 0,
    daysOfWeek: [1, 2, 3, 4],
    startTime: '15:00',
    endTime: '18:00',
    validFrom: '2026-10-01',
    validTo: '2026-12-31',
    active: true,
    dineInOnly: true,
    subtitle: {
      es: 'Tu monchis favorito, a un precio que te encanta.',
      en: 'Your favorite monchis, at a price you’ll love.',
    },
    conditions: {
      es: 'Promoción vigente de lunes a jueves de 3:00 a 6:00 p. m. hasta el 31 de diciembre de 2026.',
      en: 'Promotion valid Monday to Thursday from 3:00 to 6:00 p.m. until December 31, 2026.',
    },
    items: HAPPY_HOUR_ITEMS,
  },
  {
    id: 'martes-tempura',
    name: 'Martes de tempura',
    description: '20 % de descuento en rollos y entradas tempura.',
    kind: 'percent',
    value: 20,
    daysOfWeek: [2],
    startTime: '12:00',
    endTime: '22:00',
    validFrom: '2026-10-01',
    validTo: '2026-11-30',
    active: true,
    dineInOnly: false,
    items: [],
  },
  {
    id: 'combo-mon-2',
    name: 'Combo Mon para 2',
    description: 'Platanito Roll + Cayibel Roll + 2 tés a precio especial.',
    kind: 'fixed_price',
    value: 199,
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    startTime: '12:00',
    endTime: '22:00',
    validFrom: '2026-11-01',
    validTo: '2026-11-30',
    active: false,
    dineInOnly: false,
    items: [],
  },
];
