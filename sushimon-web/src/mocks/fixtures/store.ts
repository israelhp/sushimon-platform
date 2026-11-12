import type {
  BranchHours,
  Category,
  Department,
  DeliveryTier,
  StoreConfig,
} from '@/lib/data-access/models';

/**
 * Configuración de la tienda, categorías, niveles de envío y divisiones territoriales.
 * Valores extraídos de la tienda pública (docs/ui/extracted/store/bundle.pretty.js): objeto de
 * configuración, lista de categorías, tarifas/ETAs por nivel y lista departamento → municipio.
 */

const day = (d: number, open: string, close: string): BranchHours => ({
  day: d,
  open,
  close,
  closed: false,
});

/** Horario general de la marca (lun–jue 12–20, vie–sáb 12–22, dom 12–18). */
export const STORE_WEEKLY_HOURS: BranchHours[] = [
  day(0, '12:00', '18:00'),
  day(1, '12:00', '20:00'),
  day(2, '12:00', '20:00'),
  day(3, '12:00', '20:00'),
  day(4, '12:00', '20:00'),
  day(5, '12:00', '22:00'),
  day(6, '12:00', '22:00'),
];

export const DELIVERY_TIER_SEEDS: DeliveryTier[] = [
  { id: 'near', fee: 15, etaMinMinutes: 30, etaMaxMinutes: 40 },
  { id: 'mid', fee: 20, etaMinMinutes: 35, etaMaxMinutes: 50 },
  { id: 'extended', fee: 25, etaMinMinutes: 45, etaMaxMinutes: 60 },
  { id: 'far', fee: 30, etaMinMinutes: 55, etaMaxMinutes: 75 },
];

export const DEPARTMENTS: Department[] = [
  {
    department: 'Guatemala',
    municipalities: [
      { name: 'Guatemala', zones: 25 },
      { name: 'Mixco', zones: 0 },
      { name: 'Villa Nueva', zones: 0 },
      { name: 'Santa Catarina Pinula', zones: 0 },
      { name: 'San Miguel Petapa', zones: 0 },
      { name: 'Fraijanes', zones: 0 },
      { name: 'Chinautla', zones: 0 },
      { name: 'San José Pinula', zones: 0 },
    ],
  },
  {
    department: 'Sacatepéquez',
    municipalities: [
      { name: 'Antigua Guatemala', zones: 0 },
      { name: 'Jocotenango', zones: 0 },
    ],
  },
  { department: 'Escuintla', municipalities: [{ name: 'Escuintla', zones: 0 }] },
];

export const NONEXISTENT_ZONES = [20, 22, 23];

/** StoreConfig sin `serverTime` (lo agrega el handler con el reloj). */
export const STORE_CONFIG_SEED: Omit<StoreConfig, 'serverTime'> = {
  name: 'MON SUSHI',
  tagline: 'El lugar de los MONcheros',
  currency: 'GTQ',
  timezone: 'America/Guatemala',
  whatsappOrdersNumber: '50239999431',
  phoneDisplay: '3999-9431',
  phoneHref: 'tel:+50239999431',
  instagramHandle: '@monsushigt',
  instagramUrl: 'https://www.instagram.com/monsushigt/',
  locationLabel: 'Zona 4, Cuatro Grados Norte, Ciudad de Guatemala',
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Cuatro+Grados+Norte+Zona+4+Guatemala',
  wazeUrl:
    'https://waze.com/ul?q=Cuatro%20Grados%20Norte%2C%20Zona%204%2C%20Guatemala&navigate=yes',
  openingHours: [
    { key: 'monThu', open: '12:00', close: '20:00' },
    { key: 'friSat', open: '12:00', close: '22:00' },
    { key: 'sun', open: '12:00', close: '18:00' },
  ],
  weeklyHours: STORE_WEEKLY_HOURS,
  schedule: { stepMinutes: 30, lastOrderBeforeClose: 30, minLeadMinutes: 45, days: 7 },
  deliveryTiers: DELIVERY_TIER_SEEDS,
  departments: DEPARTMENTS,
  nonexistentZones: NONEXISTENT_ZONES,
};

/**
 * Categorías canónicas (las de la tienda). "all" es solo una pestaña de UI y no se incluye;
 * "happy" es un acceso a la promoción Happy Hour (kind = happy_hour), sin productos.
 * Nombres en inglés tomados de los mensajes de la tienda; jpLabel/illustration de su menú.
 */
export const CATEGORY_SEEDS: Category[] = [
  {
    id: 'entradas',
    name: 'Entradas',
    nameEn: 'Starters',
    sortOrder: 1,
    visible: true,
    kind: 'products',
    jpLabel: '前菜',
    illustration: 'dumpling',
  },
  {
    id: 'monchis',
    name: 'Monchis',
    nameEn: 'Monchis',
    sortOrder: 2,
    visible: true,
    kind: 'products',
    jpLabel: 'おつまみ',
    illustration: 'burger',
  },
  {
    id: 'rolls',
    name: 'Sushi Rolls',
    nameEn: 'Sushi Rolls',
    sortOrder: 3,
    visible: true,
    kind: 'products',
    jpLabel: '巻き寿司',
    illustration: 'roll',
  },
  {
    id: 'espirituosas',
    name: 'Bebidas espirituosas',
    nameEn: 'Spirits & beer',
    sortOrder: 4,
    visible: true,
    kind: 'products',
    jpLabel: 'お酒',
    illustration: 'sake',
  },
  {
    id: 'relax',
    name: 'Bebidas relax',
    nameEn: 'Soft drinks',
    sortOrder: 5,
    visible: true,
    kind: 'products',
    jpLabel: 'ソフトドリンク',
    illustration: 'shake',
  },
  {
    id: 'postres',
    name: 'Postres',
    nameEn: 'Desserts',
    sortOrder: 6,
    visible: true,
    kind: 'products',
    jpLabel: 'デザート',
    illustration: 'icecream',
  },
  {
    id: 'happy',
    name: 'Happy Hour',
    nameEn: 'Happy Hour',
    sortOrder: 7,
    visible: true,
    kind: 'happy_hour',
  },
];
