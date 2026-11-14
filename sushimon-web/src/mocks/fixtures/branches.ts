import type { CoverageRule, DeliveryTierId } from '@/lib/data-access/models';

/**
 * Sucursales conciliadas entre prototipos:
 * - id, área (es/en), estado activo/"próximamente" y COBERTURA: de la tienda (sucursal-1…5).
 * - zona, dirección, horario, teléfono y radio: del backoffice (s1…s3), conciliadas por nombre
 *   ("Sucursal 1" ↔ s1, etc.). sucursal-4 y sucursal-5 quedan "próximamente" (coming_soon).
 * El horario y los cierres (F08) viven en `fixtures/schedule.ts`; la disponibilidad la calcula el handler con el reloj.
 */
/**
 * Sucursal del mock. Mezcla DOS dominios que no deben confundirse:
 * - F07 (contrato real: `AdminBranch`/`PublicBranch`): `id`, `code`, `name`, `address`, `phone` ('' = sin teléfono),
 *   `latitude`/`longitude`, `active`, `createdAt`.
 * - SIMULADO (F09/F33, sin contrato): `area`, `zoneLabel`, `radiusKm`, `coverage`, `coverageLabels`. `status` es la vista
 *   operativa de `active` (`active` → 'active'; si no, 'coming_soon'). F08 (horario, cierres, «abierta ahora») ya es
 *   contrato y NO vive aquí.
 */
export interface BranchSeed {
  id: string;
  /** F07: identificador de negocio (slug, minúsculas, inmutable). */
  code: string;
  /** F07: sin valores ficticios; null hasta que alguien los capture. */
  latitude: number | null;
  longitude: number | null;
  /** F07: estado administrativo. */
  active: boolean;
  /** F07: fecha de alta (ISO). */
  createdAt: string;
  /** id equivalente en el prototipo del backoffice (trazabilidad). */
  legacyBackofficeId: string | null;
  name: string;
  area: { es: string; en: string };
  zoneLabel: string;
  address: string;
  phone: string;
  radiusKm: number;
  status: 'active' | 'coming_soon';
  coverage: CoverageRule[];
  coverageLabels: string[];
}

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

type RawBranchSeed = Omit<BranchSeed, 'code' | 'latitude' | 'longitude' | 'active' | 'createdAt'>;

const RAW_BRANCH_SEEDS: RawBranchSeed[] = [
  {
    id: 'sucursal-1',
    legacyBackofficeId: 's1',
    name: 'Sucursal 1',
    area: { es: 'Zona 4, Cuatro Grados Norte', en: 'Zone 4, Cuatro Grados Norte' },
    zoneLabel: 'Zona 4 · Cuatro Grados Norte',
    address: 'Vía 5, Zona 4, Cuatro Grados Norte, Ciudad de Guatemala',
    phone: '+502 2331-4410',
    radiusKm: 5,
    status: 'active',
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
    radiusKm: 4,
    status: 'active',
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
    radiusKm: 6,
    status: 'active',
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
    radiusKm: 0,
    status: 'coming_soon',
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
    radiusKm: 0,
    status: 'coming_soon',
    coverage: [],
    coverageLabels: [],
  },
];

/** Alta fija de las sucursales sembradas (determinista). */
export const BRANCH_SEED_CREATED_AT = '2026-01-15T18:00:00.000Z';

/** Sembradas: el `code` es el id actual; sin coordenadas (no se inventan) y `active` según el estado del prototipo. */
export const BRANCH_SEEDS: BranchSeed[] = RAW_BRANCH_SEEDS.map((b) => ({
  ...b,
  code: b.id,
  latitude: null,
  longitude: null,
  active: b.status === 'active',
  createdAt: BRANCH_SEED_CREATED_AT,
}));
