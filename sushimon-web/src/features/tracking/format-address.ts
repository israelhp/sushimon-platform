import type { OrderAddress } from '@/lib/data-access/models';

/**
 * Dirección de entrega en una línea (como el prototipo): "6a avenida 10-50, Edificio Demo, zona 10,
 * Guatemala, Guatemala". `zoneLabel` recibe la zona (p. ej. "zona 10"); si no aplica se omite.
 */
export function formatOrderAddress(
  address: OrderAddress,
  zoneLabel: (zone: string) => string,
): string {
  const zone = address.zone.trim();
  const hasZone = zone !== '' && /\d/.test(zone);
  return [
    address.line.trim(),
    hasZone ? zoneLabel(zone) : '',
    address.municipality.trim(),
    address.department.trim(),
  ]
    .filter(Boolean)
    .join(', ');
}
