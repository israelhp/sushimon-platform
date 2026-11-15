import type { AdminDeliveryZone } from '@/lib/data-access/models';
import { coverageZoneOf, zoneKeyOf, zoneLabelOf } from '@/lib/delivery-zone';
import { DEPARTMENT_SEEDS, MUNICIPALITY_SEEDS, municipalityByName } from './geography';

/**
 * Zonas propias y configuración de entrega SEMBRADAS (F09). Son datos de DEMOSTRACIÓN del restaurante: tarifas por
 * zona (`baseFee`, string decimal) sin «niveles» ni ETA. La migración real no siembra zonas ni habilita nada
 * (`ownDeliveryZonesEnabled=false` por defecto): aquí las sucursales 1–3 nacen con entrega propia ENCENDIDA para que la
 * demo (tienda, checkout, pedidos sembrados) tenga cobertura confirmada; PedidosYa sigue SIN verificarse (`UNKNOWN`).
 * Las sucursales 4 y 5 no tienen fila (= valores por defecto de la API).
 */
interface ZoneSpec {
  branchId: string;
  /** Municipio del departamento de Guatemala. */
  municipality: string;
  /** Etiqueta de zona (`Zona 10`); null = cobertura general del municipio. */
  label: string | null;
  baseFee: string;
}

const city = (branchId: string, baseFee: string, numbers: number[]): ZoneSpec[] =>
  numbers.map((n) => ({
    branchId,
    municipality: 'Guatemala',
    label: zoneLabelOf(n),
    baseFee,
  }));
const whole = (branchId: string, municipality: string, baseFee: string): ZoneSpec => ({
  branchId,
  municipality,
  label: null,
  baseFee,
});

const ZONE_SPECS: ZoneSpec[] = [
  ...city('sucursal-1', '15.00', [1, 4, 5, 9, 10, 13]),
  ...city('sucursal-1', '20.00', [2, 3, 7, 8, 11, 12, 14, 15]),
  ...city('sucursal-1', '25.00', [6, 16, 17, 18, 21]),
  ...city('sucursal-1', '30.00', [19, 24, 25]),
  whole('sucursal-1', 'Mixco', '25.00'),
  whole('sucursal-1', 'Santa Catarina Pinula', '25.00'),
  whole('sucursal-1', 'Villa Nueva', '30.00'),
  ...city('sucursal-2', '15.00', [10, 14, 15, 16]),
  ...city('sucursal-2', '20.00', [1, 4, 5, 9, 13]),
  ...city('sucursal-2', '25.00', [2, 3, 8, 11, 12, 17]),
  ...city('sucursal-2', '30.00', [6, 18, 21]),
  whole('sucursal-2', 'Santa Catarina Pinula', '20.00'),
  whole('sucursal-2', 'Fraijanes', '30.00'),
  ...city('sucursal-3', '15.00', [7, 8, 11, 12]),
  ...city('sucursal-3', '20.00', [1, 2, 3, 9, 13, 19, 21]),
  ...city('sucursal-3', '25.00', [4, 5, 10, 14, 24, 25]),
  whole('sucursal-3', 'Mixco', '15.00'),
  whole('sucursal-3', 'Villa Nueva', '20.00'),
  whole('sucursal-3', 'San Miguel Petapa', '25.00'),
];

export const DELIVERY_ZONE_SEED_AT = '2026-02-01T15:00:00.000Z';

export const DELIVERY_ZONE_SEEDS: AdminDeliveryZone[] = ZONE_SPECS.map((spec, i) => {
  const municipality = municipalityByName('Guatemala', spec.municipality);
  const department = DEPARTMENT_SEEDS.find((d) => d.id === municipality?.departmentId);
  if (!municipality || !department) throw new Error(`Municipio desconocido: ${spec.municipality}`);
  return {
    id: `zona-${String(i + 1).padStart(4, '0')}`,
    branchId: spec.branchId,
    municipalityId: municipality.id,
    municipalityName: municipality.name,
    departmentId: department.id,
    departmentName: department.name,
    zoneLabel: spec.label,
    baseFee: spec.baseFee,
    currency: 'GTQ',
    active: true,
    version: 1,
    createdAt: DELIVERY_ZONE_SEED_AT,
    updatedAt: DELIVERY_ZONE_SEED_AT,
  };
});

export interface DeliverySettingsRecord {
  ownDeliveryZonesEnabled: boolean;
  pedidosyaEnabled: boolean;
  updatedAt: string;
}

/** Fila por sucursal; AUSENTE = valores por defecto de la API (`own=false`, `pedidosya=true`, `isDefault=true`). */
export const DELIVERY_SETTINGS_SEEDS: Record<string, DeliverySettingsRecord> = Object.fromEntries(
  ['sucursal-1', 'sucursal-2', 'sucursal-3'].map((id) => [
    id,
    { ownDeliveryZonesEnabled: true, pedidosyaEnabled: true, updatedAt: DELIVERY_ZONE_SEED_AT },
  ]),
);

/** Valores por defecto (un único lugar, como en la API). */
export const DEFAULT_DELIVERY_SETTINGS = { ownDeliveryZonesEnabled: false, pedidosyaEnabled: true };

/**
 * Tarifa SEMBRADA de una dirección (nombre de municipio + zona numérica) para el historial y los pedidos de demostración:
 * misma prioridad que el servidor (zona específica > general). Devuelve el `baseFee` como número SOLO para totales de
 * demostración (los pedidos históricos son instantáneas); la cobertura de la tienda va por `checkDeliveryCoverage`.
 */
export function seedDeliveryFee(
  branchId: string,
  address: { department?: string; municipality: string; zone: string },
): number | null {
  const municipality = municipalityByName(address.department ?? 'Guatemala', address.municipality);
  if (!municipality) return null;
  const key = zoneKeyOf(coverageZoneOf(address.zone));
  const rows = DELIVERY_ZONE_SEEDS.filter(
    (z) => z.branchId === branchId && z.municipalityId === municipality.id && z.active,
  );
  const hit =
    (key ? rows.find((z) => zoneKeyOf(z.zoneLabel) === key) : undefined) ??
    rows.find((z) => z.zoneLabel === null);
  return hit ? Number(hit.baseFee) : null;
}

export { MUNICIPALITY_SEEDS };
