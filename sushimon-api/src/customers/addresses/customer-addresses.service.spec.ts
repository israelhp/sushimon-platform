import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../auth/auth.types.js';
import { CustomerAddressesService } from './customer-addresses.service.js';

/**
 * Pruebas de servicio con un Prisma en memoria (sin red). Cubren propiedad, límite, duplicados, predeterminada y
 * reasignación al borrar. La concurrencia real y el índice único parcial se prueban contra PostgreSQL en
 * test/customer-addresses.int-spec.ts (requiere DATABASE_URL_TEST).
 */

const CUSTOMER = 'c0000000-0000-4000-8000-00000000000a';
const OTHER = 'c0000000-0000-4000-8000-00000000000b';
const MUNI = '11111111-1111-4111-8111-111111111111';
const MUNI_2 = '22222222-2222-4222-8222-222222222222';
const DEPT = { id: 'd0000000-0000-4000-8000-000000000001', name: 'Guatemala' };

const principal = (customerId: string): Principal => ({
  authUserId: `auth-${customerId}`,
  email: 'x@sushimon.test',
  provider: 'google',
  googleOAuth: true,
  aal: 'aal1',
  displayName: 'Persona',
  avatarUrl: null,
});

interface Row {
  id: string;
  customerId: string;
  municipalityId: string;
  label: string;
  zone: string | null;
  addressLine: string;
  referenceNote: string | null;
  latitude: { toNumber(): number } | null;
  longitude: { toNumber(): number } | null;
  isDefault: boolean;
  createdAt: Date;
}

let clock = 0;
function fakeDb(initial: Row[] = []) {
  const rows: Row[] = [...initial];
  const withMunicipality = (r: Row) => ({
    ...r,
    municipality: { id: r.municipalityId, name: 'Mixco', department: DEPT },
  });
  const matches = (r: Row, where: Record<string, unknown> = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'NOT') return !matches(r, v as Record<string, unknown>);
      return (r as unknown as Record<string, unknown>)[k] === v;
    });
  // Respeta orderBy como Prisma: lista de { campo: 'asc' | 'desc' }, aplicada en orden.
  const sorted = (list: Row[], orderBy?: Array<Record<string, 'asc' | 'desc'>>) => {
    if (!orderBy) return list;
    const val = (r: Row, k: string) => {
      const v = (r as unknown as Record<string, unknown>)[k];
      return v instanceof Date ? v.getTime() : (v as string | number | boolean);
    };
    return [...list].sort((a, b) => {
      for (const clause of orderBy) {
        const [k, dir] = Object.entries(clause)[0]!;
        const va = val(a, k);
        const vb = val(b, k);
        if (va === vb) continue;
        const cmp = va > vb ? 1 : -1;
        return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  };
  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([])),
    municipality: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === MUNI || where.id === MUNI_2 ? { id: where.id } : null),
      ),
    },
    customerAddress: {
      findMany: vi.fn(
        ({
          where,
          orderBy,
        }: {
          where: Record<string, unknown>;
          orderBy?: Array<Record<string, 'asc' | 'desc'>>;
        }) =>
          Promise.resolve(
            sorted(
              rows.filter((r) => matches(r, where)),
              orderBy,
            ).map(withMunicipality),
          ),
      ),
      findFirst: vi.fn(
        ({
          where,
          orderBy,
        }: {
          where: Record<string, unknown>;
          orderBy?: Array<Record<string, 'asc' | 'desc'>>;
        }) => {
          const found = sorted(
            rows.filter((r) => matches(r, where)),
            orderBy,
          )[0];
          return Promise.resolve(found ? withMunicipality(found) : null);
        },
      ),
      findUniqueOrThrow: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(withMunicipality(rows.find((r) => r.id === where.id)!)),
      ),
      create: vi.fn(({ data }: { data: Partial<Row> }) => {
        const row: Row = {
          id: randomUUID(),
          customerId: data.customerId!,
          municipalityId: data.municipalityId!,
          label: data.label!,
          zone: data.zone ?? null,
          addressLine: data.addressLine!,
          referenceNote: data.referenceNote ?? null,
          latitude: null,
          longitude: null,
          isDefault: data.isDefault ?? false,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)),
        };
        rows.push(row);
        return Promise.resolve(withMunicipality(row));
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return Promise.resolve(withMunicipality(row));
      }),
      updateMany: vi.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
          const affected = rows.filter((r) => matches(r, where));
          affected.forEach((r) => Object.assign(r, data));
          return Promise.resolve({ count: affected.length });
        },
      ),
      delete: vi.fn(({ where }: { where: { id: string } }) => {
        const idx = rows.findIndex((r) => r.id === where.id);
        const [removed] = rows.splice(idx, 1);
        return Promise.resolve(removed);
      }),
    },
  };
  const prisma = {
    customerAddress: tx.customerAddress,
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => Promise.resolve(fn(tx))),
  };
  return { prisma, rows, tx };
}

function setup(initial: Row[] = []) {
  const db = fakeDb(initial);
  const identity = {
    ensureCustomer: vi.fn((p: Principal) =>
      Promise.resolve({
        id: p.authUserId.replace('auth-', ''),
        fullName: 'P',
        email: null,
        phone: null,
        createdAt: new Date(),
      }),
    ),
  };
  const audit = {
    record: vi.fn<(tx: unknown, event: Record<string, unknown>) => Promise<void>>(() =>
      Promise.resolve(),
    ),
  };
  const service = new CustomerAddressesService(
    db.prisma as never,
    identity as never,
    audit as never,
  );
  return { service, db, audit };
}

const baseInput = {
  label: 'Casa',
  municipalityId: MUNI,
  addressLine: 'Calle Real 1',
  zone: 'Zona 10',
  referenceNote: 'Portón negro',
};

function stored(over: Partial<Row> = {}): Row {
  clock += 1;
  return {
    id: randomUUID(),
    customerId: CUSTOMER,
    municipalityId: MUNI,
    label: 'Casa',
    zone: 'Zona 10',
    addressLine: `Calle ${clock}`,
    referenceNote: null,
    latitude: null,
    longitude: null,
    isDefault: false,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, clock)),
    ...over,
  };
}

describe('CustomerAddressesService.create', () => {
  it('la primera dirección queda predeterminada aunque no se pida', async () => {
    const { service } = setup();
    const created = await service.create(principal(CUSTOMER), { ...baseInput, isDefault: false });
    expect(created.isDefault).toBe(true);
    expect(created.department).toEqual(DEPT);
  });

  it('una segunda dirección no reemplaza la predeterminada salvo que se pida', async () => {
    const first = stored({ isDefault: true });
    const { service, db } = setup([first]);
    const created = await service.create(principal(CUSTOMER), {
      ...baseInput,
      addressLine: 'Otra 2',
    });
    expect(created.isDefault).toBe(false);
    expect(db.rows.find((r) => r.id === first.id)!.isDefault).toBe(true);
  });

  it('isDefault: true reemplaza la predeterminada anterior (una sola por cliente)', async () => {
    const first = stored({ isDefault: true });
    const { service, db } = setup([first]);
    await service.create(principal(CUSTOMER), {
      ...baseInput,
      addressLine: 'Otra 2',
      isDefault: true,
    });
    const defaults = db.rows.filter((r) => r.customerId === CUSTOMER && r.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.addressLine).toBe('Otra 2');
  });

  it('rechaza la undécima dirección con ADDRESS_LIMIT_REACHED (409)', async () => {
    const full = Array.from({ length: 10 }, () => stored());
    const { service } = setup(full);
    await expect(
      service.create(principal(CUSTOMER), { ...baseInput, addressLine: 'Nueva' }),
    ).rejects.toMatchObject({ status: 409, response: { code: 'ADDRESS_LIMIT_REACHED' } });
  });

  it('rechaza un duplicado (misma línea normalizada, municipio y zona) aunque cambie la referencia', async () => {
    const existing = stored({ addressLine: 'Calle Real 1', zone: 'Zona 10' });
    const { service } = setup([existing]);
    await expect(
      service.create(principal(CUSTOMER), {
        ...baseInput,
        addressLine: '  calle   REAL 1 ',
        referenceNote: 'otra referencia',
      }),
    ).rejects.toMatchObject({ status: 409, response: { code: 'ADDRESS_DUPLICATE' } });
  });

  it('permite la misma línea en otro municipio', async () => {
    const existing = stored({ addressLine: 'Calle Real 1' });
    const { service } = setup([existing]);
    await expect(
      service.create(principal(CUSTOMER), { ...baseInput, municipalityId: MUNI_2 }),
    ).resolves.toMatchObject({ addressLine: 'Calle Real 1' });
  });

  it('rechaza un municipio inexistente (400, violation MUNICIPALITY_NOT_FOUND)', async () => {
    const { service } = setup();
    const err = await service
      .create(principal(CUSTOMER), { ...baseInput, municipalityId: randomUUID() })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { response: { code: string } }).response.code).toBe('MUNICIPALITY_NOT_FOUND');
    expect((err as { status: number }).status).toBe(400);
  });

  it('rechaza coordenadas de una sola componente', async () => {
    const { service } = setup();
    await expect(
      service.create(principal(CUSTOMER), { ...baseInput, latitude: 14.6, longitude: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no guarda cobertura ni tarifa: solo los campos de la dirección', async () => {
    const { service, db } = setup();
    await service.create(principal(CUSTOMER), baseInput);
    expect(Object.keys(db.rows[0]!).sort()).toEqual(
      [
        'addressLine',
        'createdAt',
        'customerId',
        'id',
        'isDefault',
        'label',
        'latitude',
        'longitude',
        'municipalityId',
        'referenceNote',
        'zone',
      ].sort(),
    );
  });
});

describe('CustomerAddressesService: propiedad (IDOR)', () => {
  it('get, update, setDefault y remove de una dirección ajena responden 404', async () => {
    const ajena = stored({ customerId: OTHER, isDefault: true });
    const { service, db } = setup([ajena]);
    const yo = principal(CUSTOMER);
    await expect(service.get(yo, ajena.id)).rejects.toMatchObject({
      status: 404,
      response: { code: 'ADDRESS_NOT_FOUND' },
    });
    await expect(service.update(yo, ajena.id, { label: 'Hack' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.setDefault(yo, ajena.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.remove(yo, ajena.id)).rejects.toMatchObject({ status: 404 });
    // Nada cambió en la dirección ajena.
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ label: 'Casa', customerId: OTHER, isDefault: true });
  });

  it('list devuelve solo las direcciones del cliente autenticado', async () => {
    const mine = stored();
    const ajena = stored({ customerId: OTHER });
    const { service } = setup([mine, ajena]);
    const { items } = await service.list(principal(CUSTOMER));
    expect(items.map((i) => i.id)).toEqual([mine.id]);
  });

  it('list sin direcciones devuelve colección vacía', async () => {
    const { service } = setup();
    await expect(service.list(principal(CUSTOMER))).resolves.toEqual({ items: [] });
  });
});

describe('CustomerAddressesService.update', () => {
  it('cambiar la etiqueta no toca la predeterminada ni el propietario', async () => {
    const a = stored({ isDefault: true });
    const { service } = setup([a]);
    const updated = await service.update(principal(CUSTOMER), a.id, { label: 'Trabajo' });
    expect(updated).toMatchObject({ label: 'Trabajo', isDefault: true });
  });

  it('un PATCH sin campos no escribe y devuelve la dirección', async () => {
    const a = stored();
    const { service, db } = setup([a]);
    const res = await service.update(principal(CUSTOMER), a.id, {});
    expect(res.id).toBe(a.id);
    expect(db.tx.customerAddress.update).not.toHaveBeenCalled();
  });

  it('no permite que la edición cree un duplicado de otra dirección del cliente', async () => {
    const a = stored({ addressLine: 'Uno' });
    const b = stored({ addressLine: 'Dos' });
    const { service } = setup([a, b]);
    await expect(
      service.update(principal(CUSTOMER), b.id, { addressLine: 'uno' }),
    ).rejects.toMatchObject({ response: { code: 'ADDRESS_DUPLICATE' } });
  });

  it('registra solo los nombres de los campos cambiados en auditoría (sin contenido)', async () => {
    const a = stored();
    const { service, audit } = setup([a]);
    await service.update(principal(CUSTOMER), a.id, { label: 'Trabajo' });
    const event = audit.record.mock.calls[0]![1] as { newValues: Record<string, unknown> };
    expect(event.newValues['changedFields']).toEqual(['label']);
    expect(JSON.stringify(event)).not.toContain(a.addressLine);
  });
});

describe('CustomerAddressesService.setDefault', () => {
  it('cambia la predeterminada y deja una sola', async () => {
    const a = stored({ isDefault: true });
    const b = stored();
    const { service, db } = setup([a, b]);
    await service.setDefault(principal(CUSTOMER), b.id);
    expect(db.rows.filter((r) => r.isDefault).map((r) => r.id)).toEqual([b.id]);
  });

  it('es idempotente: si ya es predeterminada no escribe', async () => {
    const a = stored({ isDefault: true });
    const { service, db } = setup([a]);
    await service.setDefault(principal(CUSTOMER), a.id);
    expect(db.tx.customerAddress.update).not.toHaveBeenCalled();
    expect(db.rows[0]!.isDefault).toBe(true);
  });
});

describe('CustomerAddressesService.remove', () => {
  it('borrar una dirección no predeterminada no cambia la predeterminada', async () => {
    const a = stored({ isDefault: true });
    const b = stored();
    const { service, db } = setup([a, b]);
    await service.remove(principal(CUSTOMER), b.id);
    expect(db.rows.map((r) => r.id)).toEqual([a.id]);
    expect(db.rows[0]!.isDefault).toBe(true);
  });

  it('borrar la predeterminada reasigna la más antigua restante (determinista)', async () => {
    const def = stored({ isDefault: true });
    const older = stored();
    const newer = stored();
    const { service, db } = setup([def, newer, older]);
    await service.remove(principal(CUSTOMER), def.id);
    // `older` se creó antes que `newer` (reloj creciente): la regla elige la más antigua restante.
    expect(older.createdAt.getTime()).toBeLessThan(newer.createdAt.getTime());
    expect(db.rows.filter((r) => r.isDefault).map((r) => r.id)).toEqual([older.id]);
  });

  it('borrar la última dirección deja al cliente sin predeterminada', async () => {
    const a = stored({ isDefault: true });
    const { service, db } = setup([a]);
    await service.remove(principal(CUSTOMER), a.id);
    expect(db.rows).toHaveLength(0);
  });
});
