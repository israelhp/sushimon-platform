import type { AuthContext as AuthContextResponse } from '@/services/auth';
import type {
  CreateCustomerAddressRequest,
  Customer,
  CustomerAddressResponse,
  MeResponse,
  StoredAddress,
  UpdateCustomerAddressRequest,
} from '@/lib/data-access/models';
import { DEPARTMENT_SEEDS, MUNICIPALITY_SEEDS, municipalityByName } from '../fixtures/geography';
import { fail, failCode, requiresZone } from '../domain';
import { settleReviews } from './orders';
import { body, now, requireCustomer, str, type Handler, type Req } from './shared';
import { authStaffContext } from './staff';

/** Identidad simulada (UUID fijo y determinista, como en /v1/auth/context). */
const AUTH_USER_ID = '00000000-0000-4000-8000-00000000d3a0';

/**
 * Cuenta del cliente (`/v1/me/*`), equivalente al adaptador local `monsushi-account-v1` del
 * prototipo: máx. 10 direcciones, sin duplicados, la primera queda como predeterminada.
 */
const MAX_ADDRESSES = 10;

const addressKey = (a: Pick<StoredAddress, 'line' | 'municipality' | 'zone'>) =>
  `${a.line.trim().replace(/\s+/g, ' ').toLowerCase()}|${a.municipality}|${a.zone}`;

/**
 * GET /v1/auth/context — réplica MOCK del contexto de identidad que calcula el servidor a partir del
 * JWT y de la base de datos. Aquí sale de la sesión de demostración. Los UUID son fijos (deterministas).
 */
export const getAuthContext: Handler = (req): AuthContextResponse => {
  const { customer, staff } = req.context.session;
  if (!customer && !staff) fail(401, 'No autenticado');
  const email = (staff?.email ?? customer?.email ?? '').toLowerCase();
  // El contexto sale del store (permisos vigentes), no de la sesión: un empleado desactivado ya no entra.
  const record = staff ? req.store.staff.find((u) => u.id === staff.userId) : undefined;
  const staffContext = record?.active ? authStaffContext(req, record) : null;
  return {
    authUserId: AUTH_USER_ID,
    email,
    provider: 'google-demo',
    isCustomer: Boolean(customer),
    // Réplica de demostración: el personal simulado se trata como aal2 (no hay Supabase ni MFA reales).
    aal: staffContext ? 'aal2' : 'aal1',
    staffAuthorized: Boolean(staffContext),
    mfaRequired: false,
    access: staffContext ? 'GRANTED' : 'NOT_STAFF',
    staff: staffContext,
    backofficeAccess: Boolean(staffContext),
  };
};

const CUSTOMER_ID = '00000000-0000-4000-8000-00000000c001';
const CUSTOMER_CREATED_AT = '2026-01-15T12:00:00.000Z';

/** Forma del perfil de cliente que devuelve la API real (F04 · contrato MeResponse). */
function meResponse(profile: Customer): MeResponse {
  return {
    authUserId: AUTH_USER_ID,
    email: profile.email || null,
    customer: {
      id: CUSTOMER_ID,
      fullName: profile.fullName,
      email: profile.email || null,
      phone: profile.phone || null,
      createdAt: CUSTOMER_CREATED_AT,
    },
    isStaff: false,
  };
}

/** Campos que F04 permite editar. Cualquier otro (correo, identidad, roles…) responde 400, como la API real. */
const EDITABLE_PROFILE_FIELDS = new Set(['fullName', 'phone']);

/** Réplica de la política de teléfono de la API: Guatemala → +502XXXXXXXX; internacional E.164; vacío = null. */
function normalizeMockPhone(raw: unknown): string | null | 'invalid' {
  if (raw === null) return null;
  const compact = str(raw)
    .trim()
    .replace(/[\s\-().]/g, '');
  if (!compact) return null;
  const gt = /^(?:\+?502)?(\d{8})$/.exec(compact);
  if (gt) return `+502${gt[1]}`;
  if (/^\+502/.test(compact)) return 'invalid';
  const intl = /^\+([1-9]\d{7,14})$/.exec(compact);
  return intl ? `+${intl[1]}` : 'invalid';
}

/** GET /v1/me */
export const getMe: Handler = (req) => meResponse(requireCustomer(req).profile);

/** PATCH /v1/me — solo { fullName?, phone? }; omitido = sin cambios; phone null/vacío = borrar. */
export const updateMe: Handler = (req) => {
  const account = requireCustomer(req);
  const b = body<{ fullName: string; phone: string | null }>(req);
  for (const key of Object.keys(b)) {
    if (!EDITABLE_PROFILE_FIELDS.has(key)) fail(400, `Campo no permitido: ${key}`);
  }
  const next = { ...account.profile };
  if (b.fullName !== undefined) {
    const name = str(b.fullName).replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 120) fail(400, 'Escribe tu nombre completo');
    next.fullName = name;
  }
  if (b.phone !== undefined) {
    const phone = normalizeMockPhone(b.phone);
    if (phone === 'invalid') fail(400, 'Teléfono inválido');
    next.phone = phone ?? '';
  }
  account.profile = next;
  return meResponse(next);
};

/** GET /v1/me/storefront — contexto agregado; sin contadores de F05, F06 ni F23 (secciones pendientes). */
export const getStorefront: Handler = (req) => {
  const { profile } = requireCustomer(req);
  return {
    authUserId: AUTH_USER_ID,
    email: profile.email || null,
    provider: 'google-demo',
    avatarUrl: null,
    customer: meResponse(profile).customer,
    isStaff: false,
    pendingSections: ['favorites', 'orders'],
  };
};

/** Etiqueta de texto de la API ↔ enum de UI (mismo criterio que `services/account.ts`). */
const PRESET_TEXT: Record<string, StoredAddress['label']> = { Casa: 'home', Trabajo: 'work' };
const TEXT_OF: Record<StoredAddress['label'], string> = {
  home: 'Casa',
  work: 'Trabajo',
  other: '',
};

function labelFromText(text: string): Pick<StoredAddress, 'label' | 'customLabel'> {
  const preset = PRESET_TEXT[text];
  return preset ? { label: preset, customLabel: '' } : { label: 'other', customLabel: text };
}

function labelToText(a: Pick<StoredAddress, 'label' | 'customLabel'>): string {
  return a.label === 'other' ? a.customLabel : TEXT_OF[a.label];
}

/** Municipio y departamento del catálogo mock a partir del id (como `GET /v1/locations/*`). */
function placeOf(municipalityId: string) {
  const municipality = MUNICIPALITY_SEEDS.find((m) => m.id === municipalityId);
  const department = municipality
    ? DEPARTMENT_SEEDS.find((d) => d.id === municipality.departmentId)
    : undefined;
  return municipality && department ? { municipality, department } : null;
}

const MAX_CITY_ZONE = 25;
const MAX_FREE_ZONE = 60;

/**
 * Zona de la dirección en la forma de la API. Internamente el mock guarda el NÚMERO como texto («10») para la ciudad de
 * Guatemala (así lo consumen checkout y pedidos); en la API es «Zona 10». Fuera de la ciudad es texto libre. Una dirección
 * antigua de la ciudad sin zona sale con `zone = null` (no se migra).
 */
function zoneForApi(a: Pick<StoredAddress, 'department' | 'municipality' | 'zone'>): string | null {
  if (!a.zone) return null;
  return requiresZone(a) && /^\d+$/.test(a.zone) ? `Zona ${Number(a.zone)}` : a.zone;
}

/**
 * Regla de zona de F05 (ADR-0014 §13, decisión C2). Ciudad de Guatemala: obligatoria, «Zona N» con N entero 1..25
 * (normaliza `zona 05` → `Zona 5`) ⇒ 400 `ZONE_REQUIRED` / `ZONE_INVALID` con `violations[0].path = zone`. Resto: opcional,
 * texto libre ≤ 60 (se recortan y colapsan espacios). No se valida contra las zonas de cobertura (F09) ni contra
 * `nonexistentZones`. Devuelve el valor INTERNO (número como texto en la ciudad).
 */
function resolveZone(city: boolean, raw: string | null | undefined): string {
  const text = (typeof raw === 'string' ? raw : '').normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!city) {
    if (text.length > MAX_FREE_ZONE) {
      failCode(400, 'ADDRESS_INVALID', `La zona admite hasta ${MAX_FREE_ZONE} caracteres`, [
        { path: 'zone', code: 'ADDRESS_INVALID', message: 'Zona demasiado larga' },
      ]);
    }
    return text;
  }
  if (!text) {
    failCode(400, 'ZONE_REQUIRED', 'La zona es obligatoria en la ciudad de Guatemala', [
      { path: 'zone', code: 'ZONE_REQUIRED', message: 'Indica la zona (Zona 1 a Zona 25)' },
    ]);
  }
  const match = /^zona (\d{1,3})$/i.exec(text);
  const n = match ? Number(match[1]) : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_CITY_ZONE) {
    failCode(400, 'ZONE_INVALID', 'La zona debe tener el formato «Zona N», con N de 1 a 25', [
      { path: 'zone', code: 'ZONE_INVALID', message: 'Zona inválida (Zona 1 a Zona 25)' },
    ]);
  }
  return String(n);
}

/** Forma de la API (`CustomerAddress`) a partir de la dirección interna del mock. */
function toAddressResponse(a: StoredAddress, defaultId: string | null): CustomerAddressResponse {
  const municipality = municipalityByName(a.department, a.municipality);
  const department = DEPARTMENT_SEEDS.find((d) => d.name === a.department);
  return {
    id: a.id,
    label: labelToText(a),
    department: { id: department?.id ?? '', name: a.department },
    municipality: { id: municipality?.id ?? '', name: a.municipality },
    zone: zoneForApi(a),
    addressLine: a.line,
    referenceNote: a.references || null,
    latitude: null,
    longitude: null,
    isDefault: a.id === defaultId,
    createdAt: a.createdAt,
  };
}

/** Valida y normaliza con las mismas reglas de checkout; el municipio se resuelve por id. */
function resolveFields(
  req: Req,
  b: {
    municipalityId?: string;
    zone?: string | null;
    addressLine?: string;
    referenceNote?: string | null;
  },
  current?: StoredAddress,
) {
  const place = b.municipalityId !== undefined ? placeOf(b.municipalityId) : null;
  if (b.municipalityId !== undefined && !place) {
    failCode(400, 'MUNICIPALITY_NOT_FOUND', 'Municipio inexistente', [
      { path: 'municipalityId', code: 'MUNICIPALITY_NOT_FOUND', message: 'Municipio inexistente' },
    ]);
  }
  const department = place ? place.department.name : (current?.department ?? '');
  const municipality = place ? place.municipality.name : (current?.municipality ?? '');
  if (!department || !municipality) {
    failCode(400, 'ADDRESS_INVALID', 'Departamento y municipio son obligatorios');
  }
  // PATCH: la regla se evalúa sobre el resultado FUSIONADO (una dirección antigua de la ciudad sin zona debe traer `zone`).
  const zone = resolveZone(
    requiresZone({ department, municipality }),
    b.zone !== undefined ? b.zone : current ? zoneForApi(current) : null,
  );
  const line = (b.addressLine !== undefined ? b.addressLine : (current?.line ?? '')).trim();
  if (line.length < 5) failCode(400, 'ADDRESS_INVALID', 'La dirección es muy corta');
  const references = (
    b.referenceNote !== undefined ? (b.referenceNote ?? '') : (current?.references ?? '')
  ).trim();
  return { department, municipality, zone, line, references };
}

const ownAddresses = (req: Req) => requireCustomer(req);

/** GET /v1/me/addresses → `{ items }`, predeterminada primero y luego por antigüedad. */
export const listAddresses: Handler = (req): { items: CustomerAddressResponse[] } => {
  const { addresses, profile } = ownAddresses(req);
  const sorted = [...addresses].sort((a, b) =>
    a.id === profile.defaultAddressId
      ? -1
      : b.id === profile.defaultAddressId
        ? 1
        : a.createdAt.localeCompare(b.createdAt),
  );
  return { items: sorted.map((a) => toAddressResponse(a, profile.defaultAddressId)) };
};

/** GET /v1/me/addresses/:id — ajena o inexistente = 404 (sin enumeración). */
export const getAddress: Handler = (req): CustomerAddressResponse => {
  const { addresses, profile } = ownAddresses(req);
  const found = addresses.find((a) => a.id === req.params.id);
  if (!found) failCode(404, 'ADDRESS_NOT_FOUND', 'Dirección no encontrada');
  return toAddressResponse(found, profile.defaultAddressId);
};

/** POST /v1/me/addresses — límite de 10 y duplicado (línea + municipio + zona). */
export const createAddress: Handler = (req): CustomerAddressResponse => {
  const account = ownAddresses(req);
  const b = body<CreateCustomerAddressRequest>(req);
  if (typeof b.label !== 'string' || !b.label.trim())
    failCode(400, 'ADDRESS_INVALID', 'Etiqueta obligatoria');
  const data = resolveFields(req, b);
  const label = labelFromText(b.label.trim().slice(0, 40));
  if (account.addresses.length >= MAX_ADDRESSES) {
    failCode(409, 'ADDRESS_LIMIT_REACHED', `Podés guardar hasta ${MAX_ADDRESSES} direcciones.`);
  }
  const stored: StoredAddress = {
    ...label,
    ...data,
    line: data.line.slice(0, 200),
    references: data.references.slice(0, 200),
    id: `addr-${req.store.sequences.address++}`,
    createdAt: now(req).toISOString(),
  };
  if (account.addresses.some((a) => addressKey(a) === addressKey(stored))) {
    failCode(409, 'ADDRESS_DUPLICATE', 'Ya tenés esta dirección guardada.');
  }
  account.addresses.push(stored);
  if (!account.profile.defaultAddressId || b.isDefault === true) {
    account.profile = { ...account.profile, defaultAddressId: stored.id };
  }
  return toAddressResponse(stored, account.profile.defaultAddressId);
};

/** PATCH /v1/me/addresses/:id — parcial; no cambia propietario ni predeterminada. */
export const updateAddress: Handler = (req): CustomerAddressResponse => {
  const account = ownAddresses(req);
  const index = account.addresses.findIndex((a) => a.id === req.params.id);
  const current = account.addresses[index];
  if (!current) failCode(404, 'ADDRESS_NOT_FOUND', 'Dirección no encontrada');
  const b = body<UpdateCustomerAddressRequest>(req);
  const data = resolveFields(req, b, current);
  const label =
    b.label !== undefined
      ? labelFromText(b.label.trim().slice(0, 40))
      : {
          label: current.label,
          customLabel: current.customLabel,
        };
  const updated: StoredAddress = {
    ...current,
    ...label,
    ...data,
    line: data.line.slice(0, 200),
    references: data.references.slice(0, 200),
  };
  if (account.addresses.some((a) => a.id !== current.id && addressKey(a) === addressKey(updated))) {
    failCode(409, 'ADDRESS_DUPLICATE', 'Ya tenés esta dirección guardada.');
  }
  account.addresses[index] = updated;
  return toAddressResponse(updated, account.profile.defaultAddressId);
};

/** DELETE /v1/me/addresses/:id → 204. Si era la predeterminada, reasigna la más antigua restante. */
export const deleteAddress: Handler = (req) => {
  const account = ownAddresses(req);
  const target = account.addresses.find((a) => a.id === req.params.id);
  if (!target) failCode(404, 'ADDRESS_NOT_FOUND', 'Dirección no encontrada');
  account.addresses = account.addresses.filter((a) => a.id !== req.params.id);
  if (account.profile.defaultAddressId === req.params.id) {
    const next = [...account.addresses].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    account.profile = { ...account.profile, defaultAddressId: next?.id ?? null };
  }
  return undefined;
};

/** PATCH /v1/me/addresses/:id/default — transaccional e idempotente. */
export const setMyDefaultAddress: Handler = (req): CustomerAddressResponse => {
  const account = ownAddresses(req);
  const address = account.addresses.find((a) => a.id === req.params.id);
  if (!address) failCode(404, 'ADDRESS_NOT_FOUND', 'Dirección no encontrada');
  account.profile = { ...account.profile, defaultAddressId: address.id };
  return toAddressResponse(address, address.id);
};

/**
 * GET /v1/demo/me/orders — SOLO mock: pedidos BORRADOR del cliente (por correo), más recientes primero. El historial real
 * (`GET /v1/me/orders`, forma `MyOrderPage`) es `order-history.ts`.
 */
export const listMyDraftOrders: Handler = (req) => {
  const { profile } = requireCustomer(req);
  const email = req.context.session.customer?.email.trim().toLowerCase() ?? profile.email;
  const orders = req.store.orders
    .filter((o) => o.customer.email.trim().toLowerCase() === email)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  settleReviews(req, orders);
  return orders;
};
