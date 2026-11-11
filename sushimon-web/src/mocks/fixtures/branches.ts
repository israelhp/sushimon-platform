import type { BranchHours, CoverageRule, DeliveryTierId } from '@/lib/data-access/models';

/**
 * Sucursales conciliadas entre prototipos:
 * - id, área (es/en), estado activo/"próximamente" y COBERTURA: de la tienda (sucursal-1…5).
 * - zona, dirección, horario, teléfono y radio: del backoffice (s1…s3), conciliadas por nombre
 *   ("Sucursal 1" ↔ s1, etc.). sucursal-4 y sucursal-5 quedan "próximamente" (coming_soon).
 * `openNow` se calcula en el handler con el reloj.
 */
export interface BranchSeed {
  id: string;
  /** id equivalente en el prototipo del backoffice (trazabilidad). */
  legacyBackofficeId: string | null;
  name: string;
  area: { es: string; en: string };
  zoneLabel: string;
  address: string;
  phone: string;
  hoursLabel: string;
  hours: BranchHours[];
  radiusKm: number;
  status: 'active' | 'coming_soon';
  isOpen: boolean;
  coverage: CoverageRule[];
  coverageLabels: string[];
}

const everyDay = (open: string, close: string): BranchHours[] =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open, close, closed: false }));

const zones = (tier: DeliveryTierId, list: number[]): CoverageRule[] =>
  list.map((zone) => ({
    department: 'Guatemala',
    municipality: 'Guatemala',
    zone: String(zone),
    tier,
  }));

const whole = (municipality: string, tier: DeliveryTierId): CoverageRule => ({
  department: 'Guatemala',
  municipality,
  zone: null,
  tier,
});

export const BRANCH_SEEDS: BranchSeed[] = [
  {
    id: 'sucursal-1',
    legacyBackofficeId: 's1',
    name: 'Sucursal 1',
    area: { es: 'Zona 4, Cuatro Grados Norte', en: 'Zone 4, Cuatro Grados Norte' },
    zoneLabel: 'Zona 4 · Cuatro Grados Norte',
    address: 'Vía 5, Zona 4, Cuatro Grados Norte, Ciudad de Guatemala',
    phone: '+502 2331-4410',
    hoursLabel: 'Lun a dom · 12:00–22:00',
    hours: everyDay('12:00', '22:00'),
    radiusKm: 5,
    status: 'active',
    isOpen: true,
    coverage: [
      ...zones('near', [1, 4, 5, 9, 10, 13]),
      ...zones('mid', [2, 3, 7, 8, 11, 12, 14, 15]),
      ...zones('extended', [6, 16, 17, 18, 21]),
      ...zones('far', [19, 24, 25]),
      whole('Mixco', 'extended'),
      whole('Santa Catarina Pinula', 'extended'),
      whole('Villa Nueva', 'far'),
    ],
    coverageLabels: ['Zona 1', 'Zona 4', 'Zona 9', 'Zona 10', 'Zona 13'],
  },
  {
    id: 'sucursal-2',
    legacyBackofficeId: 's2',
    name: 'Sucursal 2',
    area: { es: 'Zona 10, Oakland', en: 'Zone 10, Oakland' },
    zoneLabel: 'Zona 10 · Oakland',
    address: 'Diagonal 6, Zona 10, Ciudad de Guatemala',
    phone: '+502 2367-8822',
    hoursLabel: 'Lun a dom · 12:00–23:00',
    hours: everyDay('12:00', '23:00'),
    radiusKm: 4,
    status: 'active',
    isOpen: true,
    coverage: [
      ...zones('near', [10, 14, 15, 16]),
      ...zones('mid', [1, 4, 5, 9, 13]),
      ...zones('extended', [2, 3, 8, 11, 12, 17]),
      ...zones('far', [6, 18, 21]),
      whole('Santa Catarina Pinula', 'mid'),
      whole('Fraijanes', 'far'),
    ],
    coverageLabels: ['Zona 9', 'Zona 10', 'Zona 14', 'Zona 15'],
  },
  {
    id: 'sucursal-3',
    legacyBackofficeId: 's3',
    name: 'Sucursal 3',
    area: { es: 'Zona 16, Cayalá', en: 'Zone 16, Cayalá' },
    zoneLabel: 'Zona 16 · Cayalá',
    address: 'Boulevard Rafael Landívar, Zona 16, Paseo Cayalá',
    phone: '+502 2493-1150',
    hoursLabel: 'Lun a dom · 12:00–22:00',
    hours: everyDay('12:00', '22:00'),
    radiusKm: 6,
    status: 'active',
    isOpen: true,
    coverage: [
      ...zones('near', [7, 8, 11, 12]),
      ...zones('mid', [1, 2, 3, 9, 13, 19, 21]),
      ...zones('extended', [4, 5, 10, 14, 24, 25]),
      whole('Mixco', 'near'),
      whole('Villa Nueva', 'mid'),
      whole('San Miguel Petapa', 'extended'),
    ],
    coverageLabels: ['Zona 15', 'Zona 16', 'Carretera a El Salvador'],
  },
  {
    id: 'sucursal-4',
    legacyBackofficeId: null,
    name: 'Sucursal 4',
    area: { es: 'Por definir', en: 'To be defined' },
    zoneLabel: 'Por definir',
    address: 'Por definir',
    phone: '',
    hoursLabel: 'Próximamente',
    hours: everyDay('12:00', '22:00'),
    radiusKm: 0,
    status: 'coming_soon',
    isOpen: false,
    coverage: [],
    coverageLabels: [],
  },
  {
    id: 'sucursal-5',
    legacyBackofficeId: null,
    name: 'Sucursal 5',
    area: { es: 'Por definir', en: 'To be defined' },
    zoneLabel: 'Por definir',
    address: 'Por definir',
    phone: '',
    hoursLabel: 'Próximamente',
    hours: everyDay('12:00', '22:00'),
    radiusKm: 0,
    status: 'coming_soon',
    isOpen: false,
    coverage: [],
    coverageLabels: [],
  },
];

/** Tope de sucursales (regla de UI; la regla de servidor está pendiente ❓). */
export const MAX_BRANCHES = 5;
