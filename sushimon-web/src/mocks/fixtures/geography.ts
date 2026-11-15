import type { Department, Municipality } from '@/lib/data-access/models';

/**
 * Semilla geográfica del mock, COHERENTE con la migración 0007 (spec 008 D9): los 22 departamentos de Guatemala y SOLO
 * los 17 municipios del departamento de Guatemala (lista aportada por el negocio; cotejar con el INE). Los municipios
 * de los otros 21 departamentos están PENDIENTES de fuente oficial: sus listas devuelven `[]`, igual que la API real.
 * Los ids del mock son legibles (`dep-…`, `mun-…`): en la API real son UUID por entorno y nada los fija.
 */
const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const DEPARTMENT_NAMES = [
  'Alta Verapaz',
  'Baja Verapaz',
  'Chimaltenango',
  'Chiquimula',
  'El Progreso',
  'Escuintla',
  'Guatemala',
  'Huehuetenango',
  'Izabal',
  'Jalapa',
  'Jutiapa',
  'Petén',
  'Quetzaltenango',
  'Quiché',
  'Retalhuleu',
  'Sacatepéquez',
  'San Marcos',
  'Santa Rosa',
  'Sololá',
  'Suchitepéquez',
  'Totonicapán',
  'Zacapa',
] as const;

const GUATEMALA_MUNICIPALITY_NAMES = [
  'Guatemala',
  'Santa Catarina Pinula',
  'San José Pinula',
  'San José del Golfo',
  'Palencia',
  'Chinautla',
  'San Pedro Ayampuc',
  'Mixco',
  'San Pedro Sacatepéquez',
  'San Juan Sacatepéquez',
  'San Raymundo',
  'Chuarrancho',
  'Fraijanes',
  'Amatitlán',
  'Villa Nueva',
  'Villa Canales',
  'San Miguel Petapa',
] as const;

export const DEPARTMENT_SEEDS: readonly Department[] = DEPARTMENT_NAMES.map((name) => ({
  id: `dep-${slug(name)}`,
  name,
}));

export const GUATEMALA_DEPARTMENT_ID = 'dep-guatemala';

export const MUNICIPALITY_SEEDS: readonly Municipality[] = GUATEMALA_MUNICIPALITY_NAMES.map(
  (name) => ({
    id: `mun-guatemala-${slug(name)}`,
    departmentId: GUATEMALA_DEPARTMENT_ID,
    name,
  }),
);

const collator = new Intl.Collator('es', { sensitivity: 'base' });
/** Orden de la API: `Intl.Collator('es', { sensitivity: 'base' })` con desempate por id. */
export const byLocationName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  collator.compare(a.name, b.name) || a.id.localeCompare(b.id);

export const municipalityByName = (department: string, municipality: string) => {
  const dep = DEPARTMENT_SEEDS.find((d) => d.name === department);
  return dep
    ? MUNICIPALITY_SEEDS.find((m) => m.departmentId === dep.id && m.name === municipality)
    : undefined;
};
