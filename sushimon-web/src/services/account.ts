import type { DataClient } from '@/lib/data-access/types';
import type {
  Address,
  AddressInput,
  Customer,
  CustomerAddressResponse,
  CustomerStorefrontContext,
  MeResponse,
  DraftOrder,
  UpdateCustomerProfileRequest,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/** Cuenta del cliente. Requiere sesión de cliente (simulada en la Etapa 1). */

/** Campos que F04 permite editar: nombre y teléfono. El correo es de la identidad y no se envía. */
export type CustomerUpdate = UpdateCustomerProfileRequest;

/** Aplana el perfil del contrato al modelo de UI (`Customer`). La predeterminada NO viene de /v1/me (F05). */
export function toCustomer(me: MeResponse): Customer {
  return {
    email: me.email ?? me.customer.email ?? '',
    fullName: me.customer.fullName,
    phone: me.customer.phone ?? '',
    defaultAddressId: null,
  };
}

export const getMe = async (client: DataClient): Promise<Customer> =>
  toCustomer(await client.get<MeResponse>(paths.me()));

export const updateMe = async (client: DataClient, input: CustomerUpdate): Promise<Customer> =>
  toCustomer(await client.patch<MeResponse>(paths.me(), input));

/** F04 (contrato): contexto agregado de Mi cuenta, una sola solicitud. */
export const getCustomerStorefront = (client: DataClient) =>
  client.get<CustomerStorefrontContext>(paths.myStorefront());

// ── F05: direcciones ──────────────────────────────────────────────────────────────────────────
// La API guarda la etiqueta como TEXTO ("Casa", "Trabajo" o el nombre propio). La UI usa un enum para
// los iconos y las traducciones: las dos etiquetas predefinidas se reconocen por su texto en español.

const PRESET_TEXT = { home: 'Casa', work: 'Trabajo' } as const;
const OTHER_DEFAULT_TEXT = 'Otra';

/** Texto que se guarda en la API para una etiqueta de UI. */
export function labelText(input: Pick<AddressInput, 'label' | 'customLabel'>): string {
  if (input.label === 'home') return PRESET_TEXT.home;
  if (input.label === 'work') return PRESET_TEXT.work;
  return input.customLabel?.trim() || OTHER_DEFAULT_TEXT;
}

/** Enum y texto propio a partir de la etiqueta guardada. */
export function labelFromText(text: string): Pick<Address, 'label' | 'customLabel'> {
  if (text === PRESET_TEXT.home) return { label: 'home', customLabel: '' };
  if (text === PRESET_TEXT.work) return { label: 'work', customLabel: '' };
  return { label: 'other', customLabel: text };
}

// Zona (ADR-0014 §13, decisión C2): en la ciudad de Guatemala la API usa «Zona N» (N de 1 a 25); la UI (checkout, pedido,
// cobertura) trabaja con el NÚMERO como texto («10»). La conversión vive solo aquí. En los demás municipios la zona es
// texto libre (≤ 60) y pasa tal cual.

const isCity = (department: string, municipality: string) =>
  department === 'Guatemala' && municipality === 'Guatemala';

/** `«Zona 10»` (API) → `«10»` (UI) solo en la ciudad de Guatemala; cualquier otro valor se conserva. */
export function zoneFromApi(zone: string | null, department: string, municipality: string): string {
  if (!zone) return '';
  const match = /^zona (\d{1,3})$/i.exec(zone.trim());
  return match && isCity(department, municipality) ? String(Number(match[1])) : zone;
}

/**
 * `«10»` (UI) → `«Zona 10»` (API). Sin lugar conocido (edición parcial) un número solo se entiende como zona de la ciudad.
 * Vacío = `null` (la API responde `ZONE_REQUIRED` en la ciudad). Lo que no es un número se envía tal cual: el servidor
 * decide (`ZONE_INVALID`).
 */
export function zoneToApi(zone: string, department?: string, municipality?: string): string | null {
  const text = zone.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const city =
    department === undefined || municipality === undefined || isCity(department, municipality);
  return city && /^\d{1,3}$/.test(text) ? `Zona ${Number(text)}` : text;
}

/** Respuesta de la API → vista de la UI. */
export function toAddress(r: CustomerAddressResponse): Address {
  return {
    id: r.id,
    isDefault: r.isDefault,
    ...labelFromText(r.label),
    municipalityId: r.municipality.id,
    department: r.department.name,
    municipality: r.municipality.name,
    zone: zoneFromApi(r.zone, r.department.name, r.municipality.name),
    line: r.addressLine,
    references: r.referenceNote ?? '',
    createdAt: r.createdAt,
  };
}

/** Campos del formulario → cuerpo de creación (`CreateCustomerAddressRequest`). */
export function toCreateRequest(input: AddressInput) {
  return {
    label: labelText(input),
    municipalityId: input.municipalityId,
    zone: zoneToApi(input.zone, input.department, input.municipality),
    addressLine: input.line.trim(),
    referenceNote: input.references?.trim() ? input.references.trim() : null,
  };
}

/** Campos parciales → cuerpo de edición (`UpdateCustomerAddressRequest`); solo los presentes. */
export function toUpdateRequest(input: Partial<AddressInput>) {
  const body: Record<string, unknown> = {};
  if (input.label !== undefined)
    body['label'] = labelText({ label: input.label, customLabel: input.customLabel });
  if (input.municipalityId !== undefined) body['municipalityId'] = input.municipalityId;
  if (input.zone !== undefined) {
    body['zone'] = zoneToApi(input.zone, input.department, input.municipality);
  }
  if (input.line !== undefined) body['addressLine'] = input.line.trim();
  if (input.references !== undefined) {
    body['referenceNote'] = input.references.trim() ? input.references.trim() : null;
  }
  return body;
}

/** GET /v1/me/addresses → `{ items }`, predeterminada primero (la API ya ordena). */
export const listAddresses = async (client: DataClient): Promise<Address[]> => {
  const res = await client.get<{ items: CustomerAddressResponse[] }>(paths.myAddresses());
  return res.items.map(toAddress);
};

export const createAddress = async (client: DataClient, input: AddressInput): Promise<Address> =>
  toAddress(
    await client.post<CustomerAddressResponse>(paths.myAddresses(), toCreateRequest(input)),
  );

export const updateAddress = async (
  client: DataClient,
  id: string,
  input: Partial<AddressInput>,
): Promise<Address> =>
  toAddress(
    await client.patch<CustomerAddressResponse>(paths.myAddress(id), toUpdateRequest(input)),
  );

export const deleteAddress = (client: DataClient, id: string) =>
  client.delete<void>(paths.myAddress(id));

/** PATCH /v1/me/addresses/{id}/default. La API no admite «ninguna predeterminada» explícita. */
export const setDefaultAddress = async (client: DataClient, id: string): Promise<Address> =>
  toAddress(await client.patch<CustomerAddressResponse>(paths.myAddressDefault(id)));

/**
 * 🎭 Solo mock: pedidos BORRADOR (`DraftOrder`) del cliente de demostración (`/v1/demo/me/orders`). Los usan Inicio («último
 * pedido»), la consulta de invitado y las incidencias SIMULADAS; en `http` no existe (404). El historial REAL (F23) es
 * `listMyOrders` de `services/orders` sobre `GET /v1/me/orders`.
 */
export const listMyDraftOrders = (client: DataClient) =>
  client.get<DraftOrder[]>(paths.demoMyDraftOrders());
