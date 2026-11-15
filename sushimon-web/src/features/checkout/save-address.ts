import type { Address, AddressInput, Municipality } from '@/lib/data-access/models';
import { MAX_ADDRESSES } from '@/features/account/validation';
import type { AddressForm } from './checkout-model';

/**
 * F05 · guardado opcional de la dirección del checkout (se decide al continuar desde el paso Entrega, no tras el pedido:
 * F20 aún no existe). Lógica pura: sin red ni estado.
 */

const norm = (s: string) => s.trim().toLowerCase();

/** ¿La dirección del borrador ya está entre las guardadas? (misma calle, municipio y zona) */
export function isAddressSaved(
  draft: Pick<AddressForm, 'line' | 'municipality' | 'zone'>,
  addresses: readonly Pick<Address, 'line' | 'municipality' | 'zone'>[],
): boolean {
  return addresses.some(
    (a) =>
      norm(a.line) === norm(draft.line) &&
      a.municipality === draft.municipality &&
      a.zone === draft.zone,
  );
}

/** Firma estable de la dirección: evita crear duplicados al ir y volver entre pasos. */
export function addressSignature(draft: AddressForm): string {
  return [draft.department, draft.municipality, draft.zone, norm(draft.line)].join('|');
}

export type SaveAddressDecision =
  | { action: 'skip' }
  | { action: 'full' }
  | { action: 'no-municipality' }
  | { action: 'save'; input: AddressInput };

export function decideSaveAddress(args: {
  delivery: boolean;
  signedIn: boolean;
  wantsSave: boolean;
  /** `draft.addressId === 'other'` (dirección escrita a mano, no una guardada elegida). */
  isOther: boolean;
  label: AddressInput['label'];
  draft: AddressForm;
  addresses: readonly Address[];
  municipalities: readonly Pick<Municipality, 'id' | 'name'>[];
  /** Firma ya guardada en esta sesión de checkout. */
  alreadySavedSignature: string | null;
}): SaveAddressDecision {
  const { draft, addresses } = args;
  if (!args.delivery || !args.signedIn || !args.wantsSave) return { action: 'skip' };
  if ((addresses.length > 0 && !args.isOther) || isAddressSaved(draft, addresses)) {
    return { action: 'skip' };
  }
  if (args.alreadySavedSignature === addressSignature(draft)) return { action: 'skip' };
  if (addresses.length >= MAX_ADDRESSES) return { action: 'full' };
  const municipalityId = args.municipalities.find((m) => m.name === draft.municipality)?.id;
  if (!municipalityId) return { action: 'no-municipality' };
  return {
    action: 'save',
    input: {
      label: args.label,
      customLabel: '',
      municipalityId,
      department: draft.department,
      municipality: draft.municipality,
      zone: draft.zone,
      line: draft.line.trim(),
      references: draft.references.trim(),
    },
  };
}
