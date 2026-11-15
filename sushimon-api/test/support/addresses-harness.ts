import { randomUUID } from 'node:crypto';
import type { Mock } from 'vitest';

/**
 * Prisma en memoria SOLO con lo que usa `CustomerAddressesService` + `IdentityService` del cliente (F05). El SQL real,
 * `FOR UPDATE` y el índice único parcial se prueban contra PostgreSQL en `customer-addresses.int-spec.ts`.
 */
export const MUNI = '11111111-1111-4111-8111-111111111111';
const DEPT = { id: 'd0000000-0000-4000-8000-000000000001', name: 'Guatemala' };

export interface AddressRow {
  id: string;
  customerId: string;
  municipalityId: string;
  label: string;
  zone: string | null;
  addressLine: string;
  referenceNote: string | null;
  latitude: null;
  longitude: null;
  isDefault: boolean;
  createdAt: Date;
}

export interface CustomerRow {
  id: string;
  authUserId: string;
  fullName: string;
  email: string | null;
  phone: null;
  createdAt: Date;
}

type Where = Record<string, unknown>;
type OrderBy = Array<Record<string, 'asc' | 'desc'>>;

export interface AddressesDb {
  customers: Map<string, CustomerRow>;
  rows: AddressRow[];
  audit: Record<string, unknown>[];
  customer: { create: Mock };
  [extra: string]: unknown;
}

export function fakeAddressesDb(): AddressesDb {
  const customers = new Map<string, CustomerRow>();
  const rows: AddressRow[] = [];
  const audit: Record<string, unknown>[] = [];
  let clock = 0;

  const withMunicipality = (r: AddressRow) => ({
    ...r,
    municipality: { id: r.municipalityId, name: 'Mixco', department: DEPT },
  });
  const matches = (r: AddressRow, where: Where = {}): boolean =>
    Object.entries(where).every(([k, v]) =>
      k === 'NOT' ? !matches(r, v as Where) : (r as unknown as Record<string, unknown>)[k] === v,
    );
  const sorted = (list: AddressRow[], orderBy?: OrderBy) => {
    if (!orderBy) return list;
    const val = (r: AddressRow, k: string) => {
      const v = (r as unknown as Record<string, unknown>)[k];
      return v instanceof Date ? v.getTime() : (v as string | number | boolean);
    };
    return [...list].sort((a, b) => {
      for (const clause of orderBy) {
        const [k, dir] = Object.entries(clause)[0] as [string, 'asc' | 'desc'];
        const va = val(a, k);
        const vb = val(b, k);
        if (va === vb) continue;
        const cmp = va > vb ? 1 : -1;
        return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  };

  const customerAddress = {
    findMany: vi.fn(({ where, orderBy }: { where: Where; orderBy?: OrderBy }) =>
      Promise.resolve(
        sorted(
          rows.filter((r) => matches(r, where)),
          orderBy,
        ).map(withMunicipality),
      ),
    ),
    findFirst: vi.fn(({ where, orderBy }: { where: Where; orderBy?: OrderBy }) => {
      const found = sorted(
        rows.filter((r) => matches(r, where)),
        orderBy,
      )[0];
      return Promise.resolve(found ? withMunicipality(found) : null);
    }),
    findUniqueOrThrow: vi.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(withMunicipality(rows.find((r) => r.id === where.id) as AddressRow)),
    ),
    create: vi.fn(({ data }: { data: Partial<AddressRow> }) => {
      const row: AddressRow = {
        id: randomUUID(),
        customerId: data.customerId as string,
        municipalityId: data.municipalityId as string,
        label: data.label as string,
        zone: data.zone ?? null,
        addressLine: data.addressLine as string,
        referenceNote: data.referenceNote ?? null,
        latitude: null,
        longitude: null,
        isDefault: data.isDefault ?? false,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)),
      };
      rows.push(row);
      return Promise.resolve(withMunicipality(row));
    }),
    update: vi.fn(({ where, data }: { where: { id: string }; data: Partial<AddressRow> }) => {
      const row = rows.find((r) => r.id === where.id) as AddressRow;
      Object.assign(row, data);
      return Promise.resolve(withMunicipality(row));
    }),
    updateMany: vi.fn(({ where, data }: { where: Where; data: Partial<AddressRow> }) => {
      const affected = rows.filter((r) => matches(r, where));
      affected.forEach((r) => Object.assign(r, data));
      return Promise.resolve({ count: affected.length });
    }),
    delete: vi.fn(({ where }: { where: { id: string } }) => {
      const idx = rows.findIndex((r) => r.id === where.id);
      return Promise.resolve(rows.splice(idx, 1)[0]);
    }),
  };
  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([])),
    municipality: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === MUNI ? { id: MUNI } : null),
      ),
    },
    customerAddress,
    auditEvent: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        audit.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  const db = {
    customers,
    rows,
    audit,
    customerAddress,
    customer: {
      findUnique: vi.fn(({ where }: { where: { authUserId: string } }) =>
        Promise.resolve(customers.get(where.authUserId) ?? null),
      ),
      create: vi.fn(
        ({ data }: { data: { authUserId: string; fullName: string; email: string | null } }) => {
          const created: CustomerRow = {
            id: randomUUID(),
            phone: null,
            createdAt: new Date(),
            ...data,
          };
          customers.set(data.authUserId, created);
          return Promise.resolve(created);
        },
      ),
      findUniqueOrThrow: vi.fn(),
    },
    staffUser: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => Promise.resolve(fn(tx))),
    $disconnect: () => Promise.resolve(),
  };
  return db;
}
