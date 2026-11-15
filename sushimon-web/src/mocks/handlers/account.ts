import type { AuthContext as AuthContextResponse } from '@/services/auth';
import type { Address, AddressInput, Customer, MeResponse } from '@/lib/data-access/models';
import { assertAddress, fail } from '../domain';
import { settleReviews } from './orders';
import { body, now, oneOf, requireCustomer, str, type Handler, type Req } from './shared';
import { authStaffContext } from './staff';

/** Identidad simulada (UUID fijo y determinista, como en /v1/auth/context). */
const AUTH_USER_ID = '00000000-0000-4000-8000-00000000d3a0';

/**
 * Cuenta del cliente (`/v1/me/*`), equivalente al adaptador local `monsushi-account-v1` del
 * prototipo: máx. 10 direcciones, sin duplicados, la primera queda como predeterminada.
 */
const MAX_ADDRESSES = 10;

const addressKey = (a: Pick<Address, 'line' | 'municipality' | 'zone'>) =>
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
function meResponse(profile: Customer): MeResponse & { defaultAddressId: string | null } {
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
    // Extensión de SIMULACIÓN: la dirección predeterminada es de F05 y aún no está en el contrato de F04.
    defaultAddressId: profile.defaultAddressId,
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
    pendingSections: ['addresses', 'favorites', 'orders'],
  };
};

/**
 * PUT /v1/demo/me/default-address — SIMULACIÓN de F05 (no existe en la API real todavía).
 * Se mantiene fuera de PATCH /v1/me para que F04 no acepte campos de direcciones.
 */
export const setDemoDefaultAddress: Handler = (req) => {
  const account = requireCustomer(req);
  const b = body<{ addressId: string | null }>(req);
  if (b.addressId !== null && !account.addresses.some((a) => a.id === b.addressId)) {
    fail(404, 'Dirección no encontrada');
  }
  account.profile = { ...account.profile, defaultAddressId: b.addressId ?? null };
  return { defaultAddressId: account.profile.defaultAddressId };
};

function parseAddress(req: Req, input: Partial<AddressInput>) {
  const label = oneOf(input.label, ['home', 'work', 'other'] as const, 'label');
  const a = assertAddress(req.store, input);
  return {
    label,
    customLabel: label === 'other' ? str(input.customLabel).trim().slice(0, 40) : '',
    ...a,
    line: a.line.slice(0, 200),
    references: a.references.slice(0, 200),
  };
}

/** GET /v1/me/addresses — predeterminada primero, luego por antigüedad. */
export const listAddresses: Handler = (req): Address[] => {
  const { addresses, profile } = requireCustomer(req);
  return [...addresses].sort((a, b) =>
    a.id === profile.defaultAddressId
      ? -1
      : b.id === profile.defaultAddressId
        ? 1
        : a.createdAt.localeCompare(b.createdAt),
  );
};

/** POST /v1/me/addresses */
export const createAddress: Handler = (req): Address => {
  const account = requireCustomer(req);
  const data = parseAddress(req, body<AddressInput>(req));
  if (account.addresses.length >= MAX_ADDRESSES) fail(409, 'Máximo 10 direcciones');
  if (account.addresses.some((a) => addressKey(a) === addressKey(data))) {
    fail(409, 'Ya tienes esa dirección guardada');
  }
  const address: Address = {
    ...data,
    id: `addr-${req.store.sequences.address++}`,
    createdAt: now(req).toISOString(),
  };
  account.addresses.push(address);
  if (!account.profile.defaultAddressId) account.profile.defaultAddressId = address.id;
  return address;
};

/** PATCH /v1/me/addresses/:id */
export const updateAddress: Handler = (req): Address => {
  const account = requireCustomer(req);
  const index = account.addresses.findIndex((a) => a.id === req.params.id);
  const current = account.addresses[index];
  if (!current) fail(404, 'Dirección no encontrada');
  const data = parseAddress(req, { ...current, ...body<AddressInput>(req) });
  if (account.addresses.some((a) => a.id !== current.id && addressKey(a) === addressKey(data))) {
    fail(409, 'Ya tienes esa dirección guardada');
  }
  const updated = { ...current, ...data };
  account.addresses[index] = updated;
  return updated;
};

/** DELETE /v1/me/addresses/:id → 204 */
export const deleteAddress: Handler = (req) => {
  const account = requireCustomer(req);
  if (!account.addresses.some((a) => a.id === req.params.id)) fail(404, 'Dirección no encontrada');
  account.addresses = account.addresses.filter((a) => a.id !== req.params.id);
  if (account.profile.defaultAddressId === req.params.id) account.profile.defaultAddressId = null;
  return undefined;
};

/** GET /v1/me/orders — pedidos del cliente (por correo), más recientes primero. */
export const listMyOrders: Handler = (req) => {
  const { profile } = requireCustomer(req);
  const email = req.context.session.customer?.email.trim().toLowerCase() ?? profile.email;
  const orders = req.store.orders
    .filter((o) => o.customer.email.trim().toLowerCase() === email)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  settleReviews(req, orders);
  return orders;
};
