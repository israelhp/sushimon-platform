import type { Address, AddressInput, Customer } from '@/lib/data-access/models';
import { assertAddress, fail, isValidEmail, isValidPhone } from '../domain';
import { settleReviews } from './orders';
import { body, now, oneOf, requireCustomer, str, type Handler, type Req } from './shared';

/**
 * Cuenta del cliente (`/v1/me/*`), equivalente al adaptador local `monsushi-account-v1` del
 * prototipo: máx. 10 direcciones, sin duplicados, la primera queda como predeterminada.
 */
const MAX_ADDRESSES = 10;

const addressKey = (a: Pick<Address, 'line' | 'municipality' | 'zone'>) =>
  `${a.line.trim().replace(/\s+/g, ' ').toLowerCase()}|${a.municipality}|${a.zone}`;

/** GET /v1/me */
export const getMe: Handler = (req): Customer => requireCustomer(req).profile;

/** PATCH /v1/me — { fullName?, phone?, email?, defaultAddressId? } */
export const updateMe: Handler = (req): Customer => {
  const account = requireCustomer(req);
  const b = body<Customer>(req);
  const next = { ...account.profile };
  if (b.fullName !== undefined) {
    if (str(b.fullName).trim().length < 3) fail(400, 'Escribe tu nombre completo');
    next.fullName = str(b.fullName).trim();
  }
  if (b.phone !== undefined) {
    if (!isValidPhone(str(b.phone))) fail(400, 'Teléfono inválido');
    next.phone = str(b.phone).trim();
  }
  if (b.email !== undefined) {
    if (!isValidEmail(str(b.email))) fail(400, 'Correo inválido');
    next.email = str(b.email).trim();
  }
  if (b.defaultAddressId !== undefined) {
    if (b.defaultAddressId !== null && !account.addresses.some((a) => a.id === b.defaultAddressId))
      fail(404, 'Dirección no encontrada');
    next.defaultAddressId = b.defaultAddressId;
  }
  account.profile = next;
  return next;
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

/** GET /v1/me/favorites → productId[] (más reciente primero) */
export const listFavorites: Handler = (req): string[] => requireCustomer(req).favorites;

/** PUT /v1/me/favorites/:productId */
export const addFavorite: Handler = (req): string[] => {
  const account = requireCustomer(req);
  const id = req.params.productId ?? '';
  if (!req.store.products.some((p) => p.id === id)) fail(404, 'Producto no encontrado');
  if (!account.favorites.includes(id)) account.favorites.unshift(id);
  return account.favorites;
};

/** DELETE /v1/me/favorites/:productId */
export const removeFavorite: Handler = (req): string[] => {
  const account = requireCustomer(req);
  account.favorites = account.favorites.filter((f) => f !== req.params.productId);
  return account.favorites;
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
