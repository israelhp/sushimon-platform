import type { Address } from '@/lib/data-access/models';

/** Nombre visible de una dirección ("Casa", "Trabajo" o el nombre propio de "Otra"). */
export function addressTitle(
  address: Pick<Address, 'label' | 'customLabel'>,
  labels: Record<Address['label'], string>,
): string {
  return (address.label === 'other' && address.customLabel.trim()) || labels[address.label];
}

/** "Línea, zona N, Municipio, Departamento" (la zona solo existe en la Ciudad de Guatemala). */
export function addressLine(
  address: Pick<Address, 'line' | 'zone' | 'municipality' | 'department'>,
  locale: string,
): string {
  const zone = address.zone ? `${locale === 'en' ? 'Zone' : 'zona'} ${address.zone}, ` : '';
  return `${address.line}, ${zone}${address.municipality}, ${address.department}`;
}
