/**
 * Sucursales conciliadas entre prototipos:
 * - id, área (es/en), estado activo/"próximamente": de la tienda (sucursal-1…5).
 * - zona, dirección, horario, teléfono: del backoffice (s1…s3), conciliadas por nombre
 *   ("Sucursal 1" ↔ s1, etc.). sucursal-4 y sucursal-5 quedan "próximamente" (coming_soon).
 * El horario y los cierres (F08) viven en `fixtures/schedule.ts`; la disponibilidad la calcula el handler con el reloj.
 */
/**
 * Sucursal del mock. Mezcla DOS dominios que no deben confundirse:
 * - F07 (contrato real: `AdminBranch`/`PublicBranch`): `id`, `code`, `name`, `address`, `phone` ('' = sin teléfono),
 *   `latitude`/`longitude`, `active`, `createdAt`.
 * - SIMULADO (F33, sin contrato): `area`, `zoneLabel`. La cobertura (F09) vive en `fixtures/delivery.ts` y la API; el radio y
 *   los niveles se retiraron (ADR-0012). `status` es la vista
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
  status: 'active' | 'coming_soon';
}

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
    status: 'active',
  },
  {
    id: 'sucursal-2',
    legacyBackofficeId: 's2',
    name: 'Sucursal 2',
    area: { es: 'Zona 10, Oakland', en: 'Zone 10, Oakland' },
    zoneLabel: 'Zona 10 · Oakland',
    address: 'Diagonal 6, Zona 10, Ciudad de Guatemala',
    phone: '+502 2367-8822',
    status: 'active',
  },
  {
    id: 'sucursal-3',
    legacyBackofficeId: 's3',
    name: 'Sucursal 3',
    area: { es: 'Zona 16, Cayalá', en: 'Zone 16, Cayalá' },
    zoneLabel: 'Zona 16 · Cayalá',
    address: 'Boulevard Rafael Landívar, Zona 16, Paseo Cayalá',
    phone: '+502 2493-1150',
    status: 'active',
  },
  {
    id: 'sucursal-4',
    legacyBackofficeId: null,
    name: 'Sucursal 4',
    area: { es: 'Por definir', en: 'To be defined' },
    zoneLabel: 'Por definir',
    address: 'Por definir',
    phone: '',
    status: 'coming_soon',
  },
  {
    id: 'sucursal-5',
    legacyBackofficeId: null,
    name: 'Sucursal 5',
    area: { es: 'Por definir', en: 'To be defined' },
    zoneLabel: 'Por definir',
    address: 'Por definir',
    phone: '',
    status: 'coming_soon',
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
