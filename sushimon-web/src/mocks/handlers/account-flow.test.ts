import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import * as account from '@/services/account';
import * as favorites from '@/services/favorites';
import * as orders from '@/services/orders';
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
    expect(await status(orders.listMyOrders(h.client))).toBe(401);
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
    const page = await orders.listMyOrders(h.client);
    expect(page.items.map((o) => o.displayNumber)).toEqual([
      'MON-490217',
      'MON-482193',
      'MON-479850',
    ]);
    // Los borradores simulados (Inicio e incidencias) siguen en su propia ruta de demostración.
    const drafts = await account.listMyDraftOrders(h.client);
    expect(drafts.map((o) => o.id)).toEqual(['MON-490217', 'MON-482193', 'MON-479850']);
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

describe('F05 · zona de la dirección (ADR-0014 §13, decisión C2)', () => {
  /** Cuerpo del contrato (`CreateCustomerAddressRequest`) sin pasar por el mapeo del servicio. */
  const raw = (zone: string | null | undefined, over: Record<string, unknown> = {}) => ({
    label: 'Casa',
    municipalityId: GUATEMALA_ID,
    addressLine: '2a calle 23-80, Vista Hermosa',
    ...(zone === undefined ? {} : { zone }),
    ...over,
  });
  const post = (h: ReturnType<typeof createHarness>, body: unknown) =>
    h.client.post<{ id: string; zone: string | null }>('/v1/me/addresses', body);
  const failure = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      if (e instanceof ApiError) return e;
      throw e;
    }
    throw new Error('se esperaba un error');
  };
  const mixcoId = municipalityByName('Guatemala', 'Mixco')!.id;

  it('ciudad de Guatemala: la zona es obligatoria (ZONE_REQUIRED) con violations[0].path = zone', async () => {
    const h = createHarness();
    h.asCustomer();
    for (const zone of [undefined, null, '', '   ']) {
      const err = await failure(post(h, raw(zone)));
      expect(err.status).toBe(400);
      expect(err.businessCode).toBe('ZONE_REQUIRED');
      expect(err.violations?.[0]).toMatchObject({ path: 'zone', code: 'ZONE_REQUIRED' });
    }
  });

  it('formato o rango inválidos: ZONE_INVALID (incluye «10» sin la palabra Zona)', async () => {
    const h = createHarness();
    h.asCustomer();
    for (const zone of ['10', 'Zona 0', 'Zona 26', 'Zona 1.5', 'Zona', 'Zona diez', 'zona -3']) {
      const err = await failure(post(h, raw(zone)));
      expect(err.businessCode, zone).toBe('ZONE_INVALID');
      expect(err.violations?.[0]?.path).toBe('zone');
    }
  });

  it('normaliza «zona 05» → «Zona 5», « Zona  10 » → «Zona 10» y acepta 20, 22 y 23', async () => {
    const h = createHarness();
    h.asCustomer();
    expect((await post(h, raw('zona 05'))).zone).toBe('Zona 5');
    expect((await post(h, raw(' Zona  10 ', { addressLine: 'Otra calle 1-23' }))).zone).toBe(
      'Zona 10',
    );
    expect((await post(h, raw('ZONA 20', { addressLine: 'Calle veinte 20-20' }))).zone).toBe(
      'Zona 20',
    );
  });

  it('otros municipios: opcional y texto libre ≤ 60 (se recorta y colapsa espacios)', async () => {
    const h = createHarness();
    h.asCustomer();
    const base = { municipalityId: mixcoId };
    expect((await post(h, raw(undefined, base))).zone).toBeNull();
    expect((await post(h, raw('', { ...base, addressLine: 'Calle 2 2-22' }))).zone).toBeNull();
    expect(
      (await post(h, raw('  Colonia   Lomas  ', { ...base, addressLine: 'Calle 3 3-33' }))).zone,
    ).toBe('Colonia Lomas');
    expect(
      (await post(h, raw('x'.repeat(60), { ...base, addressLine: 'Calle 4 4-44' }))).zone,
    ).toHaveLength(60);
    const long = await failure(post(h, raw('x'.repeat(61), { ...base, addressLine: 'Calle 5' })));
    expect(long).toMatchObject({ status: 400, businessCode: 'ADDRESS_INVALID' });
    expect(long.violations?.[0]?.path).toBe('zone');
  });

  it('el servicio traduce «N» de la UI a «Zona N» y de vuelta (round trip)', async () => {
    const h = createHarness();
    h.asCustomer();
    const saved = await account.createAddress(h.client, address);
    expect(saved.zone).toBe('15');
    expect(
      (await h.client.get<{ items: { zone: string | null }[] }>('/v1/me/addresses')).items.map(
        (a) => a.zone,
      ),
    ).toContain('Zona 15');
    // Las direcciones sembradas (zona «10»/«4») también salen como «Zona N» en la API.
    const items = (
      await h.client.get<{ items: { id: string; zone: string | null }[] }>('/v1/me/addresses')
    ).items;
    expect(items.find((a) => a.id === 'demo-trabajo')?.zone).toBe('Zona 4');
  });

  it('PATCH evalúa la regla sobre el resultado fusionado: una dirección antigua sin zona debe traerla', async () => {
    const h = createHarness();
    h.asCustomer();
    // Dirección antigua de la ciudad guardada antes de la regla (no se migra).
    h.store.accounts['cliente@ejemplo.com']!.addresses.find((a) => a.id === 'demo-trabajo')!.zone =
      '';
    const listed = await h.client.get<{ items: { id: string; zone: string | null }[] }>(
      '/v1/me/addresses',
    );
    expect(listed.items.find((a) => a.id === 'demo-trabajo')?.zone).toBeNull();
    // Editar solo la referencia sigue sin zona ⇒ ZONE_REQUIRED.
    const err = await failure(
      h.client.patch('/v1/me/addresses/demo-trabajo', { referenceNote: 'Nueva nota' }),
    );
    expect(err.businessCode).toBe('ZONE_REQUIRED');
    // Con zona (formato API) se guarda.
    const ok = await h.client.patch<{ zone: string | null }>('/v1/me/addresses/demo-trabajo', {
      zone: 'zona 04',
    });
    expect(ok.zone).toBe('Zona 4');
    // Sin zona tampoco hace falta repetirla en ediciones posteriores.
    expect(
      (
        await h.client.patch<{ zone: string | null }>('/v1/me/addresses/demo-trabajo', {
          referenceNote: 'Otra',
        })
      ).zone,
    ).toBe('Zona 4');
    // Pasar de la ciudad a otro municipio conserva la zona como texto libre.
    const moved = await h.client.patch<{ zone: string | null }>('/v1/me/addresses/demo-trabajo', {
      municipalityId: mixcoId,
    });
    expect(moved.zone).toBe('Zona 4');
    expect(
      await status(h.client.patch('/v1/me/addresses/demo-trabajo', { zone: 'x'.repeat(61) })),
    ).toBe(400);
  });
});
