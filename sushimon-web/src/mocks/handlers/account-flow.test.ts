import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import * as account from '@/services/account';
import * as favorites from '@/services/favorites';
import { municipalityByName } from '../fixtures/geography';
import { createHarness } from '../testing';

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e.status;
    throw e;
  }
  return 200;
}

const GUATEMALA_ID = municipalityByName('Guatemala', 'Guatemala')!.id;

/** Entrada de formulario (UI). El servicio la convierte al contrato `CreateCustomerAddressRequest`. */
const address = {
  label: 'other' as const,
  customLabel: 'Casa de mamá',
  municipalityId: GUATEMALA_ID,
  department: 'Guatemala',
  municipality: 'Guatemala',
  zone: '15',
  line: '2a calle 23-80, Vista Hermosa',
  references: 'Casa azul',
};

describe('cuenta del cliente (/v1/me)', () => {
  it('sin sesión → 401', async () => {
    const h = createHarness();
    expect(await status(account.getMe(h.client))).toBe(401);
    expect(await status(account.listMyOrders(h.client))).toBe(401);
  });

  it('cuenta demo sembrada: perfil, 2 direcciones (predeterminada = demo-casa), 2 favoritos y 3 pedidos', async () => {
    const h = createHarness();
    h.asCustomer();
    expect(await account.getMe(h.client)).toMatchObject({ fullName: 'Cliente Demo' });
    const addresses = await account.listAddresses(h.client);
    expect(addresses.map((a) => a.id)).toEqual(['demo-casa', 'demo-trabajo']);
    expect(addresses.find((a) => a.isDefault)?.id).toBe('demo-casa');
    expect((await favorites.listMyFavoriteIds(h.client)).favoriteProductIds).toEqual([
      'platanito-roll',
      'calientito-roll',
    ]);
    const orders = await account.listMyOrders(h.client);
    expect(orders.map((o) => o.id)).toEqual(['MON-490217', 'MON-482193', 'MON-479850']);
  });

  it('cuenta nueva empieza vacía y la primera dirección queda predeterminada', async () => {
    const h = createHarness();
    h.asCustomer('invitado.nuevo@ejemplo.com');
    expect(await account.getMe(h.client)).toMatchObject({ phone: '' });
    expect(await account.listAddresses(h.client)).toEqual([]);
    const first = await account.createAddress(h.client, address);
    expect(first.isDefault).toBe(true);
    expect((await account.listAddresses(h.client)).find((a) => a.isDefault)?.id).toBe(first.id);
  });

  it('la API guarda la etiqueta como texto y la UI la reconstruye (enum + texto propio)', async () => {
    const h = createHarness();
    h.asCustomer('invitado.nuevo@ejemplo.com');
    const casa = await account.createAddress(h.client, {
      ...address,
      label: 'home',
      customLabel: '',
    });
    expect(casa).toMatchObject({ label: 'home', customLabel: '', municipalityId: GUATEMALA_ID });
    const propia = await account.createAddress(h.client, { ...address, line: 'Otra 9' });
    expect(propia).toMatchObject({ label: 'other', customLabel: 'Casa de mamá' });
  });

  it('direcciones: duplicado 409, predeterminada, edición y borrado', async () => {
    const h = createHarness();
    h.asCustomer();
    const a = await account.createAddress(h.client, address);
    expect(a).toMatchObject({ id: 'addr-1', customLabel: 'Casa de mamá', zone: '15' });
    expect(await status(account.createAddress(h.client, address))).toBe(409);
    expect(await status(account.createAddress(h.client, { ...address, zone: '' }))).toBe(400);
    await account.setDefaultAddress(h.client, a.id);
    expect((await account.listAddresses(h.client))[0]?.id).toBe(a.id);
    const edited = await account.updateAddress(h.client, a.id, { references: 'Portón verde' });
    expect(edited.references).toBe('Portón verde');
    expect(await account.deleteAddress(h.client, a.id)).toBeUndefined();
    expect(await status(account.deleteAddress(h.client, a.id))).toBe(404);
    expect(await status(account.setDefaultAddress(h.client, 'zzz'))).toBe(404);
  });

  it('borrar la predeterminada reasigna la más antigua restante', async () => {
    const h = createHarness();
    h.asCustomer('invitado.nuevo@ejemplo.com');
    const first = await account.createAddress(h.client, address);
    const second = await account.createAddress(h.client, { ...address, line: 'Segunda 1 zona' });
    expect(second.isDefault).toBe(false);
    await account.deleteAddress(h.client, first.id);
    const rest = await account.listAddresses(h.client);
    expect(rest.map((x) => x.id)).toEqual([second.id]);
    expect(rest[0]?.isDefault).toBe(true);
  });

  it('máximo 10 direcciones', async () => {
    const h = createHarness();
    h.asCustomer('invitado.nuevo@ejemplo.com');
    for (let i = 1; i <= 10; i++) {
      await account.createAddress(h.client, { ...address, line: `Calle ${i} casa ${i}` });
    }
    expect(await status(account.createAddress(h.client, { ...address, line: 'Calle 11 x' }))).toBe(
      409,
    );
  });

  it('un municipio inexistente responde 400', async () => {
    const h = createHarness();
    h.asCustomer();
    expect(
      await status(account.createAddress(h.client, { ...address, municipalityId: 'no-existe' })),
    ).toBe(400);
  });

  it('perfil', async () => {
    const h = createHarness();
    h.asCustomer();
    expect(await status(account.updateMe(h.client, { phone: '12' }))).toBe(400);
    // Normaliza a +502 como la API real (política de F04).
    expect((await account.updateMe(h.client, { phone: '5555-9999' })).phone).toBe('+50255559999');
    expect((await account.updateMe(h.client, { phone: null })).phone).toBe('');
  });

  it('F04: PATCH /v1/me rechaza correo, identidad y direcciones; conserva el nombre', async () => {
    const h = createHarness();
    h.asCustomer();
    const before = await account.getMe(h.client);
    expect(
      await status(h.client.patch('/v1/me', { email: 'otro@ejemplo.com' }) as Promise<unknown>),
    ).toBe(400);
    expect(
      await status(h.client.patch('/v1/me', { defaultAddressId: null }) as Promise<unknown>),
    ).toBe(400);
    expect(await status(account.updateMe(h.client, { fullName: '  ' }))).toBe(400);
    const after = await account.updateMe(h.client, { phone: '5555-1234' });
    expect(after.fullName).toBe(before.fullName);
    expect(after.email).toBe(before.email);
  });

  it('F04: contexto agregado sin contadores de F06/F23', async () => {
    const h = createHarness();
    h.asCustomer();
    const ctx = await h.client.get<{
      pendingSections: string[];
      customer: { fullName: string };
      avatarUrl: string | null;
    }>('/v1/me/storefront');
    expect(ctx.pendingSections).toEqual(['favorites', 'orders']);
    expect(ctx.customer.fullName).toBe('Cliente Demo');
    expect(ctx.avatarUrl).toBeNull();
  });
});
