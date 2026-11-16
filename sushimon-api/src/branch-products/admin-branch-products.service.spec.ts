import { Logger } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { IdentityService } from '../identity/identity.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import {
  bid,
  bpid,
  fakeProduct,
  FakeBranchProductsRepo,
} from '../../test/support/fake-branch-products-repo.js';
import { CAT, productsHarness } from '../../test/support/products-harness.js';
import {
  globalStaff,
  mergeGrants,
  grantsOf,
  staffContext,
} from '../../test/support/staff-context.js';
import { AdminBranchProductsService } from './admin-branch-products.service.js';
import type { BranchProductsRepository } from './branch-products.repository.js';

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

const A = bid(1);
const B = bid(2);
const P1 = bpid(1);
const P2 = bpid(2);
const ALL = ['catalog.read', 'catalog.update', 'catalog.manage_availability'];
const admin = (): StaffContext => ({ ...globalStaff(ALL), staffId: 'staff-1' });
const scopedTo = (branches: string[], permissions = ALL): StaffContext =>
  staffContext(grantsOf(permissions, branches), { staffId: 'staff-2' });

interface Event {
  action: string;
  entityType: string;
  entityId: string;
  branchId?: string | null;
  actorId: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}

function setup() {
  const repo = new FakeBranchProductsRepo();
  repo.seedBranch(A, { name: 'Zona 10' });
  repo.seedBranch(B, { name: 'Antigua' });
  repo.seedProduct(fakeProduct(1, { name: 'Roll California', basePrice: '50.00', sku: 'RC-1' }));
  repo.seedProduct(fakeProduct(2, { name: 'Té', basePrice: '10.00', categoryId: CAT.calientes }));
  const { categoriesQuery } = productsHarness();
  const events: Event[] = [];
  const audit = {
    record: vi.fn((_tx: unknown, e: Event) => {
      events.push(e);
      return Promise.resolve();
    }),
  };
  const service = new AdminBranchProductsService(
    repo as unknown as BranchProductsRepository,
    audit,
    new AuthorizationService({} as IdentityService),
    categoriesQuery,
  );
  return { service, repo, events, audit };
}

const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
const status = (e: unknown) => (e as { status?: number }).status;

describe('setPricing', () => {
  it('fija el override: crea la fila, audita y devuelve el estado con precio efectivo', async () => {
    const { service, repo, events } = setup();
    const state = await service.setPricing(admin(), A, P1, { priceOverride: '45.50' });
    expect(state).toMatchObject({
      branchId: A,
      productId: P1,
      basePrice: '50.00',
      priceOverride: '45.50',
      effectivePrice: '45.50',
      available: true,
      offered: true,
    });
    expect(state.updatedAt).not.toBeNull();
    expect(repo.rowOf(A, P1)?.priceOverride).toBe('45.50');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'branch_product.price_set',
      entityType: 'branch_product',
      entityId: P1,
      branchId: A,
      actorId: 'staff-1',
      oldValues: { branchId: A, productId: P1, oldPrice: null },
      newValues: { branchId: A, productId: P1, newPrice: '45.50' },
    });
  });

  it('no afecta a otra sucursal ni al precio base', async () => {
    const { service, repo } = setup();
    await service.setPricing(admin(), A, P1, { priceOverride: '45.50' });
    expect(repo.rowOf(B, P1)).toBeUndefined();
    expect(repo.products.get(P1)?.basePrice).toBe('50.00');
  });

  it('null con available=true elimina la fila (D2) y audita price_cleared', async () => {
    const { service, repo, events } = setup();
    repo.seedRow(A, P1, { priceOverride: '45.50' });
    const state = await service.setPricing(admin(), A, P1, { priceOverride: null });
    expect(repo.rowOf(A, P1)).toBeUndefined();
    expect(state).toMatchObject({
      priceOverride: null,
      effectivePrice: '50.00',
      available: true,
      updatedAt: null,
    });
    expect(events.map((e) => e.action)).toEqual(['branch_product.price_cleared']);
    expect(events[0]?.oldValues).toMatchObject({ oldPrice: '45.50' });
  });

  it('null con available=false conserva la fila (solo quita el override)', async () => {
    const { service, repo } = setup();
    repo.seedRow(A, P1, { priceOverride: '45.50', available: false });
    const state = await service.setPricing(admin(), A, P1, { priceOverride: null });
    expect(repo.rowOf(A, P1)).toMatchObject({ priceOverride: null, available: false });
    expect(state).toMatchObject({ available: false, offered: false, priceOverride: null });
  });

  it('idempotente: mismo override o borrar sin fila => sin escritura ni auditoría', async () => {
    const { service, repo, events } = setup();
    repo.seedRow(A, P1, { priceOverride: '45.50' });
    const same = await service.setPricing(admin(), A, P1, { priceOverride: '45.50' });
    expect(same.priceOverride).toBe('45.50');
    const none = await service.setPricing(admin(), A, P2, { priceOverride: null });
    expect(none).toMatchObject({ priceOverride: null, updatedAt: null });
    expect(repo.count('upsertPrice')).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('override igual al base se conserva (no se normaliza)', async () => {
    const { service, repo } = setup();
    await service.setPricing(admin(), A, P1, { priceOverride: '50.00' });
    expect(repo.rowOf(A, P1)?.priceOverride).toBe('50.00');
  });

  it('"0.00" => 422 BRANCH_PRICE_INVALID sin escribir; forma inválida => 400', async () => {
    const { service, repo, events } = setup();
    const zero = await failure(service.setPricing(admin(), A, P1, { priceOverride: '0.00' }));
    expect([status(zero), code(zero)]).toEqual([422, 'BRANCH_PRICE_INVALID']);
    for (const bad of [85, '85', '1000000.00', undefined]) {
      expect(
        status(await failure(service.setPricing(admin(), A, P1, { priceOverride: bad }))),
      ).toBe(400);
    }
    expect(repo.rows.size).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('orden de comprobaciones: forma 400 > alcance 404 > producto 404 > regla 422', async () => {
    const { service } = setup();
    const outOfScope = scopedTo([B]);
    expect(
      status(await failure(service.setPricing(outOfScope, A, P1, { priceOverride: 85 }))),
    ).toBe(400);
    const e1 = await failure(
      service.setPricing(outOfScope, A, 'x-missing', { priceOverride: '0.00' }),
    );
    expect([status(e1), code(e1)]).toEqual([404, 'BRANCH_NOT_FOUND']);
    const e2 = await failure(service.setPricing(admin(), A, bpid(99), { priceOverride: '0.00' }));
    expect([status(e2), code(e2)]).toEqual([404, 'PRODUCT_NOT_FOUND']);
  });

  it('sucursal inexistente (alcance global) y ajena (alcance acotado) dan el MISMO 404', async () => {
    const { service } = setup();
    const missing = await failure(
      service.setPricing(admin(), bid(99), P1, { priceOverride: '1.00' }),
    );
    const foreign = await failure(
      service.setPricing(scopedTo([B]), A, P1, { priceOverride: '1.00' }),
    );
    expect(status(missing)).toBe(404);
    expect(code(missing)).toBe('BRANCH_NOT_FOUND');
    expect(code(foreign)).toBe('BRANCH_NOT_FOUND');
    expect((missing as Error).message).toBe((foreign as Error).message);
  });

  it('productos inactivos u ocultos admiten precio (offered=false)', async () => {
    const { service } = setup();
    const hidden = await service.setPricing(admin(), A, P2, { priceOverride: '12.00' });
    expect(hidden).toMatchObject({ priceOverride: '12.00', offered: false });
  });

  it('PUT y PATCH concurrentes se mezclan sin pisarse (merge por columna)', async () => {
    const { service, repo } = setup();
    // Entre la lectura de la fila y el upsert de precio, otro actor marca agotado.
    repo.afterFindRow = () => {
      repo.afterFindRow = null;
      repo.seedRow(A, P1, { available: false });
    };
    const state = await service.setPricing(admin(), A, P1, { priceOverride: '45.00' });
    expect(repo.rowOf(A, P1)).toMatchObject({ priceOverride: '45.00', available: false });
    expect(state).toMatchObject({ priceOverride: '45.00', available: false });
  });

  it('lee la fila vigente (bloqueándola) ANTES de decidir y de escribir; el old de auditoría sale de esa lectura', async () => {
    const { service, repo, events } = setup();
    repo.seedRow(A, P1, { priceOverride: '45.00' });
    await service.setPricing(admin(), A, P1, { priceOverride: '40.00' });
    const order = repo.calls.filter((c) =>
      ['findRow', 'upsertPrice', 'deleteIfDefault'].includes(c),
    );
    expect(order).toEqual(['findRow', 'upsertPrice']);
    expect(repo.calls.indexOf('transaction')).toBeLessThan(repo.calls.indexOf('findRow'));
    expect(events[0]?.oldValues).toMatchObject({ oldPrice: '45.00' });
    // una sola fila por transacción (PK): ninguna otra lectura/escritura de filas => sin ciclos de bloqueo posibles
    expect(repo.count('findRow')).toBe(1);
    expect(repo.count('upsertPrice')).toBe(1);
  });

  it('timeout/bloqueo => 503 BRANCH_PRODUCTS_BUSY', async () => {
    const { service, repo } = setup();
    repo.failTransactionWith = { code: 'P2028' };
    const e = await failure(service.setPricing(admin(), A, P1, { priceOverride: '1.00' }));
    expect([status(e), code(e)]).toEqual([503, 'BRANCH_PRODUCTS_BUSY']);
  });

  it('un fallo de auditoría revierte la escritura (misma transacción)', async () => {
    const { service, repo, audit } = setup();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await failure(service.setPricing(admin(), A, P1, { priceOverride: '1.00' }));
    expect(repo.rowOf(A, P1)).toBeUndefined();
  });
});

describe('setAvailability', () => {
  it('agotar crea la fila, conserva el override y audita', async () => {
    const { service, repo, events } = setup();
    repo.seedRow(A, P1, { priceOverride: '45.00' });
    const state = await service.setAvailability(admin(), P1, { branchId: A, available: false });
    expect(repo.rowOf(A, P1)).toMatchObject({ priceOverride: '45.00', available: false });
    expect(state).toMatchObject({ available: false, offered: false, priceOverride: '45.00' });
    expect(events[0]).toMatchObject({
      action: 'branch_product.availability_changed',
      branchId: A,
      oldValues: { branchId: A, productId: P1, oldAvailable: true },
      newValues: { branchId: A, productId: P1, newAvailable: false },
    });
  });

  it('volver a disponible sin override elimina la fila; con override la conserva', async () => {
    const { service, repo } = setup();
    repo.seedRow(A, P1, { available: false });
    repo.seedRow(A, P2, { available: false, priceOverride: '9.00' });
    await service.setAvailability(admin(), P1, { branchId: A, available: true });
    await service.setAvailability(admin(), P2, { branchId: A, available: true });
    expect(repo.rowOf(A, P1)).toBeUndefined();
    expect(repo.rowOf(A, P2)).toMatchObject({ priceOverride: '9.00', available: true });
  });

  it('idempotente: sin cambio no escribe ni audita', async () => {
    const { service, repo, events } = setup();
    const state = await service.setAvailability(admin(), P1, { branchId: A, available: true });
    expect(state).toMatchObject({ available: true, updatedAt: null });
    repo.seedRow(B, P1, { available: false });
    await service.setAvailability(admin(), P1, { branchId: B, available: false });
    expect(repo.count('upsertAvailability')).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('alcance: manager de A no toca B (404 BRANCH_NOT_FOUND); producto inexistente 404', async () => {
    const { service, repo } = setup();
    const manager = scopedTo([A], ['catalog.read', 'catalog.manage_availability']);
    const foreign = await failure(
      service.setAvailability(manager, P1, { branchId: B, available: false }),
    );
    expect([status(foreign), code(foreign)]).toEqual([404, 'BRANCH_NOT_FOUND']);
    expect(repo.rowOf(B, P1)).toBeUndefined();
    const missing = await failure(
      service.setAvailability(manager, bpid(99), { branchId: A, available: false }),
    );
    expect([status(missing), code(missing)]).toEqual([404, 'PRODUCT_NOT_FOUND']);
    const ok = await service.setAvailability(manager, P1, { branchId: A, available: false });
    expect(ok.available).toBe(false);
  });

  it('el permiso se evalúa por sucursal: manage_availability en A y en B solo read', async () => {
    const { service } = setup();
    const staff = staffContext(
      mergeGrants(grantsOf(['catalog.manage_availability'], [A]), grantsOf(['catalog.read'], [B])),
    );
    const denied = await failure(
      service.setAvailability(staff, P1, { branchId: B, available: false }),
    );
    expect(code(denied)).toBe('BRANCH_NOT_FOUND');
  });
});

describe('listForBranch', () => {
  it('lista todos los productos (activos e inactivos) con estado y orden estable', async () => {
    const { service, repo } = setup();
    repo.seedRow(A, P1, { priceOverride: '45.00', available: false });
    const page = await service.listForBranch(admin(), A, { page: 1, pageSize: 20 });
    expect(page).toMatchObject({ branchId: A, page: 1, pageSize: 20, total: 2 });
    expect(page.items.map((i) => i.name)).toEqual(['Roll California', 'Té']);
    expect(page.items[0]).toMatchObject({
      priceOverride: '45.00',
      effectivePrice: '45.00',
      available: false,
      offered: false,
      publiclyVisible: true,
      sku: 'RC-1',
    });
    expect(page.items[1]).toMatchObject({
      active: true,
      publiclyVisible: false,
      offered: false,
      category: { id: CAT.calientes, effectivelyVisible: false },
    });
    expect(repo.count('findMatrix')).toBe(1);
  });

  it('filtros: q con comodines literales, categoryId, available, hasOverride', async () => {
    const { service, repo } = setup();
    repo.seedRow(A, P2, { priceOverride: '9.00', available: false });
    const list = (q: Parameters<typeof service.listForBranch>[2]) =>
      service.listForBranch(admin(), A, q).then((p) => p.items.map((i) => i.productId));
    expect(await list({ q: 'california', page: 1, pageSize: 20 })).toEqual([P1]);
    expect(await list({ q: 'RC-1', page: 1, pageSize: 20 })).toEqual([P1]);
    expect(await list({ q: 'te', page: 1, pageSize: 20 })).toEqual([P2]);
    expect(await list({ q: '%', page: 1, pageSize: 20 })).toEqual([]);
    expect(await list({ q: '_', page: 1, pageSize: 20 })).toEqual([]);
    expect(await list({ categoryId: CAT.calientes, page: 1, pageSize: 20 })).toEqual([P2]);
    expect(await list({ available: false, page: 1, pageSize: 20 })).toEqual([P2]);
    expect(await list({ available: true, page: 1, pageSize: 20 })).toEqual([P1]);
    expect(await list({ hasOverride: true, page: 1, pageSize: 20 })).toEqual([P2]);
    expect(await list({ hasOverride: false, page: 1, pageSize: 20 })).toEqual([P1]);
    expect(await list({ page: 2, pageSize: 1 })).toEqual([P2]);
  });

  it('q > 80 caracteres => 400', async () => {
    const { service } = setup();
    const e = await failure(
      service.listForBranch(admin(), A, { q: 'x'.repeat(81), page: 1, pageSize: 20 }),
    );
    expect(status(e)).toBe(400);
  });

  it('sucursal ajena o inexistente => 404 BRANCH_NOT_FOUND idéntico', async () => {
    const { service } = setup();
    const q = { page: 1, pageSize: 20 };
    const foreign = await failure(service.listForBranch(scopedTo([B]), A, q));
    const missing = await failure(service.listForBranch(admin(), bid(99), q));
    expect([status(foreign), code(foreign)]).toEqual([404, 'BRANCH_NOT_FOUND']);
    expect([status(missing), code(missing)]).toEqual([404, 'BRANCH_NOT_FOUND']);
    expect((foreign as Error).message).toBe((missing as Error).message);
  });

  it('una sucursal inactiva SÍ se puede consultar (alcance global)', async () => {
    const { service, repo } = setup();
    repo.seedBranch(A, { active: false });
    const page = await service.listForBranch(admin(), A, { page: 1, pageSize: 20 });
    expect(page.total).toBe(2);
  });
});

describe('listForProduct', () => {
  it('alcance global: todas las sucursales ordenadas por nombre', async () => {
    const { service, repo } = setup();
    repo.seedRow(A, P1, { priceOverride: '45.00' });
    const view = await service.listForProduct(admin(), P1);
    expect(view).toMatchObject({
      productId: P1,
      basePrice: '50.00',
      active: true,
      publiclyVisible: true,
    });
    expect(view.items.map((i) => i.branchId)).toEqual([B, A]); // Antigua, Zona 10
    expect(view.items[1]).toMatchObject({ priceOverride: '45.00', branchName: 'Zona 10' });
    expect(repo.count('findProductBranches')).toBe(1);
  });

  it('alcance acotado: solo las sucursales del empleado (nunca ajenas)', async () => {
    const { service } = setup();
    const view = await service.listForProduct(scopedTo([A]), P1);
    expect(view.items.map((i) => i.branchId)).toEqual([A]);
    expect(JSON.stringify(view)).not.toContain(B);
  });

  it('producto inexistente => 404 PRODUCT_NOT_FOUND; inactivo se consulta', async () => {
    const { service, repo } = setup();
    expect(code(await failure(service.listForProduct(admin(), bpid(99))))).toBe(
      'PRODUCT_NOT_FOUND',
    );
    repo.seedProduct(fakeProduct(3, { active: false }));
    const view = await service.listForProduct(admin(), bpid(3));
    expect(view).toMatchObject({ active: false, publiclyVisible: false });
    expect(view.items.every((i) => !i.offered)).toBe(true);
  });
});
