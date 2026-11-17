import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import * as bp from '@/services/branch-products';
import * as orders from '@/services/orders';
import { createHarness } from '../testing';

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, code: e.businessCode };
    throw e;
  }
  throw new Error('se esperaba un error');
}

const as = (role: 'admin' | 'manager', userId?: string) => {
  const h = createHarness();
  h.asStaff(role, userId);
  return h;
};

describe('F13 mock · overlay público', () => {
  it('trae el precio EFECTIVO de ESA sucursal y nunca el de otra ni el base como indicio', async () => {
    const h = createHarness();
    const s1 = await bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-1' });
    const s2 = await bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-2' });
    const price = (m: typeof s1, id: string) => m.items.find((i) => i.productId === id)?.price;
    expect(price(s1, 'dynamita-roll')).toBe('82.00');
    expect(price(s2, 'dynamita-roll')).toBe('86.00');
    expect(s1.items[0]).not.toHaveProperty('basePrice');
    expect(s1.items[0]).not.toHaveProperty('priceOverride');
    expect(s1.items[0]).not.toHaveProperty('stock');
    expect(s2.items.find((i) => i.productId === 'gaseosas')?.available).toBe(false);
    expect(s1.items.find((i) => i.productId === 'gaseosas')?.available).toBe(true);
  });
  it('solo productos visibles (inactivo o categoría oculta no se ofrece, aunque tengan fila)', async () => {
    const h = createHarness();
    const menu = await bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-1' });
    expect(menu.items).toHaveLength(29);
    expect(menu.items.map((i) => i.productId)).not.toContain('gyoza-vegetal');
    expect(menu.items.map((i) => i.productId)).not.toContain('roll-edicion-limitada');
  });
  it('F17: branchId OPCIONAL (precio base y available=null); 404 BRANCH_NOT_FOUND con sucursal inexistente o inactiva', async () => {
    const h = createHarness();
    const anonymous = await bp.getStoreBranchMenu(h.client);
    expect(anonymous.branchId).toBeNull();
    expect(anonymous.items.every((i) => i.available === null)).toBe(true);
    expect(anonymous.items.find((i) => i.productId === 'dynamita-roll')?.price).toBe('82.00');
    expect(await failure(bp.getStoreBranchMenu(h.client, { branchId: 'zzz' }))).toEqual({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
    expect(await failure(bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-4' }))).toEqual({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
  });
  it('escenario product-unavailable: agotado en todas las sucursales activas', async () => {
    const h = createHarness('product-unavailable');
    for (const id of ['sucursal-1', 'sucursal-2', 'sucursal-3']) {
      const menu = await bp.getStoreBranchMenu(h.client, { branchId: id });
      expect(menu.items.find((i) => i.productId === 'calientito-roll')?.available).toBe(false);
    }
  });
});

describe('F13 mock · matrices administrativas y alcance por sucursal', () => {
  it('sin sesión 401; sin catalog.read 403', async () => {
    const h = createHarness();
    expect(await failure(bp.listAdminBranchProducts(h.client, 'sucursal-1'))).toMatchObject({
      status: 401,
    });
    h.asStaff('staff');
    expect(await failure(bp.listAdminBranchProducts(h.client, 'sucursal-1'))).toMatchObject({
      status: 403,
    });
  });
  it('el encargado de A ve y modifica A; B es 404 BRANCH_NOT_FOUND (lectura y escritura)', async () => {
    const h = as('manager');
    const own = await bp.listAdminBranchProducts(h.client, 'sucursal-1', { pageSize: 5 });
    expect(own).toMatchObject({ branchId: 'sucursal-1', page: 1, pageSize: 5, total: 31 });
    const notFound = { status: 404, code: 'BRANCH_NOT_FOUND' };
    expect(await failure(bp.listAdminBranchProducts(h.client, 'sucursal-2'))).toEqual(notFound);
    expect(
      await failure(
        bp.setAdminProductAvailability(h.client, 'dumplings', {
          branchId: 'sucursal-2',
          available: false,
        }),
      ),
    ).toEqual(notFound);
    // Inexistente = igual que ajena (no se revela).
    expect(await failure(bp.listAdminBranchProducts(h.client, 'zzz'))).toEqual(notFound);
  });
  it('matriz por producto: el encargado solo ve su sucursal; el admin, todas (activas e inactivas)', async () => {
    const mgr = as('manager');
    const mine = await bp.listAdminProductBranches(mgr.client, 'gaseosas');
    expect(mine.items.map((i) => i.branchId)).toEqual(['sucursal-1']);
    const adm = as('admin');
    const all = await bp.listAdminProductBranches(adm.client, 'gaseosas');
    expect(all.items.map((i) => i.branchId).sort()).toEqual([
      'sucursal-1',
      'sucursal-2',
      'sucursal-3',
      'sucursal-4',
      'sucursal-5',
    ]);
    const s2 = all.items.find((i) => i.branchId === 'sucursal-2');
    expect(s2).toMatchObject({ available: false, offered: false, effectivePrice: '25.00' });
    expect(all.items.find((i) => i.branchId === 'sucursal-5')?.branchActive).toBe(false);
    expect(await failure(bp.listAdminProductBranches(adm.client, 'zzz'))).toEqual({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  });
  it('filtros q/categoría/disponibilidad/hasOverride y paginación (400 fuera de rango)', async () => {
    const h = as('admin');
    const over = await bp.listAdminBranchProducts(h.client, 'sucursal-2', { hasOverride: true });
    expect(over.items.map((i) => i.productId)).toEqual(['dynamita-roll']);
    expect(over.items[0]).toMatchObject({
      basePrice: '82.00',
      priceOverride: '86.00',
      effectivePrice: '86.00',
      publiclyVisible: true,
    });
    const sold = await bp.listAdminBranchProducts(h.client, 'sucursal-3', { available: false });
    expect(sold.items.map((i) => i.productId)).toEqual(['joselito-roll']);
    const q = await bp.listAdminBranchProducts(h.client, 'sucursal-1', { q: 'GASEOSA' });
    expect(q.items.map((i) => i.productId)).toEqual(['gaseosas']);
    const none = await bp.listAdminBranchProducts(h.client, 'sucursal-1', { hasOverride: true });
    expect(none).toMatchObject({ total: 0, items: [] });
    expect(
      await failure(bp.listAdminBranchProducts(h.client, 'sucursal-1', { pageSize: 101 })),
    ).toMatchObject({ status: 400 });
    // Incluye productos ocultos (activos e inactivos) con su estado.
    const hidden = await bp.listAdminBranchProducts(h.client, 'sucursal-1', { q: 'gyoza' });
    expect(hidden.items[0]).toMatchObject({
      active: false,
      publiclyVisible: false,
      offered: false,
    });
  });
});

describe('F13 mock · escrituras', () => {
  it('fijar y quitar precio: la fila por defecto se elimina (D2) y el estado vuelve al base', async () => {
    const h = as('admin');
    const set = await bp.setAdminBranchProductPricing(h.client, 'sucursal-1', 'dumplings', '60.00');
    expect(set).toMatchObject({
      basePrice: '53.00',
      priceOverride: '60.00',
      effectivePrice: '60.00',
      offered: true,
    });
    expect(set.updatedAt).not.toBeNull();
    expect(h.store.branchProducts.some((r) => r.productId === 'dumplings')).toBe(true);
    const cleared = await bp.setAdminBranchProductPricing(
      h.client,
      'sucursal-1',
      'dumplings',
      null,
    );
    expect(cleared).toMatchObject({
      priceOverride: null,
      effectivePrice: '53.00',
      updatedAt: null,
    });
    expect(h.store.branchProducts.some((r) => r.productId === 'dumplings')).toBe(false);
  });
  it('agotar conserva el override; volver a disponible con override no borra la fila', async () => {
    const h = as('admin');
    await bp.setAdminBranchProductPricing(h.client, 'sucursal-1', 'dumplings', '60.00');
    const out = await bp.setAdminProductAvailability(h.client, 'dumplings', {
      branchId: 'sucursal-1',
      available: false,
    });
    expect(out).toMatchObject({ available: false, priceOverride: '60.00', offered: false });
    await bp.setAdminProductAvailability(h.client, 'dumplings', {
      branchId: 'sucursal-1',
      available: true,
    });
    expect(h.store.branchProducts.find((r) => r.productId === 'dumplings')).toMatchObject({
      priceOverride: '60.00',
      available: true,
    });
  });
  it('idempotente: sin cambios 200 sin escribir ni consumir BUSY', async () => {
    const h = as('admin');
    h.store.branchProductsBusy = 1;
    const out = await bp.setAdminBranchProductPricing(h.client, 'sucursal-1', 'dumplings', null);
    expect(out.updatedAt).toBeNull();
    expect(h.store.branchProductsBusy).toBe(1);
  });
  it('el encargado marca agotado pero NO fija precio (403)', async () => {
    const h = as('manager');
    const out = await bp.setAdminProductAvailability(h.client, 'dumplings', {
      branchId: 'sucursal-1',
      available: false,
    });
    expect(out.available).toBe(false);
    expect(
      await failure(bp.setAdminBranchProductPricing(h.client, 'sucursal-1', 'dumplings', '60.00')),
    ).toMatchObject({ status: 403 });
  });
  it('orden de errores: 400 de forma → 404 sucursal → 404 producto → 422 regla', async () => {
    const h = as('admin');
    const put = (branch: string, product: string, body: unknown) =>
      failure(h.client.put(`/v1/admin/branches/${branch}/products/${product}/pricing`, body));
    expect(await put('sucursal-1', 'dumplings', { priceOverride: 85 })).toMatchObject({
      status: 400,
    });
    expect(await put('sucursal-1', 'dumplings', { priceOverride: '85' })).toMatchObject({
      status: 400,
    });
    expect(await put('sucursal-1', 'dumplings', {})).toMatchObject({ status: 400 });
    expect(await put('sucursal-1', 'dumplings', { priceOverride: '1.00', x: 1 })).toMatchObject({
      status: 400,
    });
    expect(await put('sucursal-1', 'dumplings', { priceOverride: '1000000.00' })).toMatchObject({
      status: 400,
    });
    expect(await put('zzz', 'zzz', { priceOverride: '0.00' })).toEqual({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
    expect(await put('sucursal-1', 'zzz', { priceOverride: '0.00' })).toEqual({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
    expect(await put('sucursal-1', 'dumplings', { priceOverride: '0.00' })).toEqual({
      status: 422,
      code: 'BRANCH_PRICE_INVALID',
    });
    const patch = (body: unknown) =>
      failure(h.client.patch('/v1/admin/products/dumplings/availability', body));
    expect(await patch({ branchId: 'sucursal-1', available: 'no' })).toMatchObject({ status: 400 });
    expect(await patch({ branchId: 'sucursal-1' })).toMatchObject({ status: 400 });
    expect(await patch({ branchId: 'zzz', available: true })).toEqual({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
  });
  it('503 BRANCH_PRODUCTS_BUSY determinista: no guarda y el reintento funciona', async () => {
    const h = as('admin');
    h.store.branchProductsBusy = 1;
    expect(
      await failure(bp.setAdminBranchProductPricing(h.client, 'sucursal-1', 'dumplings', '60.00')),
    ).toEqual({ status: 503, code: 'BRANCH_PRODUCTS_BUSY' });
    expect(h.store.branchProducts.some((r) => r.productId === 'dumplings')).toBe(false);
    const ok = await bp.setAdminBranchProductPricing(h.client, 'sucursal-1', 'dumplings', '60.00');
    expect(ok.priceOverride).toBe('60.00');
  });
  it('se refleja en el overlay público de ESA sucursal y en el pedido (precio del servidor por sucursal)', async () => {
    const h = as('admin');
    await bp.setAdminBranchProductPricing(h.client, 'sucursal-2', 'dumplings', '60.00');
    expect(
      (await bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-2' })).items.find(
        (i) => i.productId === 'dumplings',
      )?.price,
    ).toBe('60.00');
    expect(
      (await bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-1' })).items.find(
        (i) => i.productId === 'dumplings',
      )?.price,
    ).toBe('53.00');
  });
  it('un producto inactivo u oculto admite precio/disponibilidad (preparar con antelación) y sigue sin ofertarse', async () => {
    const h = as('admin');
    const out = await bp.setAdminProductAvailability(h.client, 'gyoza-vegetal', {
      branchId: 'sucursal-1',
      available: true,
    });
    expect(out.offered).toBe(false);
    const priced = await bp.setAdminBranchProductPricing(
      h.client,
      'sucursal-1',
      'gyoza-vegetal',
      '40.00',
    );
    expect(priced).toMatchObject({ priceOverride: '40.00', offered: false });
    const menu = await bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-1' });
    expect(menu.items.map((i) => i.productId)).not.toContain('gyoza-vegetal');
  });
});

describe('F13 mock · el pedido mock usa el precio de la sucursal (nunca el de otra)', () => {
  const pickup = (branchId: string, productId: string) => ({
    fulfillment: 'pickup' as const,
    branchId,
    schedule: { kind: 'now' as const },
    customer: { name: 'Ana Prueba', phone: '5555-0000', email: 'ana@ejemplo.com' },
    lines: [{ productId, quantity: 1 }],
    paymentMethod: 'cash' as const,
  });
  it('precio efectivo por sucursal y 409 si está agotado allí', async () => {
    const h = createHarness();
    const a = await orders.createOrder(h.client, pickup('sucursal-1', 'dynamita-roll'));
    const b = await orders.createOrder(h.client, pickup('sucursal-2', 'dynamita-roll'));
    expect(a.lines[0]).toMatchObject({ unitPrice: 82 });
    expect(b.lines[0]).toMatchObject({ unitPrice: 86 });
    expect(
      await failure(orders.createOrder(h.client, pickup('sucursal-2', 'gaseosas'))),
    ).toMatchObject({ status: 409 });
    // Disponible en la sucursal 1.
    expect(
      (await orders.createOrder(h.client, pickup('sucursal-1', 'gaseosas'))).lines,
    ).toHaveLength(1);
  });
});
