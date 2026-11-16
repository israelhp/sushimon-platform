import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import * as admin from '@/services/backoffice-admin';
import * as bo from '@/services/backoffice-orders';
import * as categories from '@/services/categories';
import * as branchProducts from '@/services/branch-products';
import * as products from '@/services/products';
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

describe('sesión y alcance', () => {
  it('sin sesión de personal → 401; forbidden global → 403', async () => {
    const h = createHarness();
    expect(await status(bo.getStaffMe(h.client))).toBe(401);
    const f = createHarness('forbidden');
    f.asStaff('admin');
    expect(await status(bo.getStaffMe(f.client))).toBe(403);
  });

  it('cocina solo ve su sucursal y no despacha ni ve el panel', async () => {
    const h = createHarness();
    h.asStaff('kitchen');
    const me = await bo.getStaffMe(h.client);
    expect(me).toMatchObject({ role: 'kitchen', branchId: 'sucursal-1' });
    const list = await bo.listBackofficeOrders(h.client);
    expect(new Set(list.map((o) => o.branchId))).toEqual(new Set(['sucursal-1']));
    expect(await status(bo.getDashboard(h.client))).toBe(403);
    expect(
      await status(bo.dispatchOrder(h.client, { id: 'MON-307051', provider: 'pedidosya' })),
    ).toBe(403);
    expect(await status(bo.listBackofficeOrders(h.client, { branchId: 'sucursal-2' }))).toBe(403);
    // Pedido de otra sucursal: 404 (no se revela)
    expect(
      await status(bo.changeOrderStatus(h.client, { id: 'MON-307058', status: 'accepted' })),
    ).toBe(404);
  });

  it('un usuario inactivo no entra', async () => {
    const h = createHarness();
    h.asStaff('manager', 'u8');
    // Desactivado: la API revalida en cada solicitud y responde 403.
    expect(await status(bo.getStaffMe(h.client))).toBe(403);
  });
});

describe('panel y pedidos del día', () => {
  it('KPIs del panel (admin, todas las sucursales)', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const d = await bo.getDashboard(h.client);
    // 82 generados de antes + 15 sembrados del backoffice + MON-490217 (pagado, de hoy)
    expect(d.received).toBe(98);
    expect(d.newPending).toBe(3);
    expect(d.inPreparation).toBe(4);
    expect(d.readyForDispatch).toBe(3);
    expect(d.onTheWay).toBe(2);
    expect(d.cancelled).toBe(3);
    expect(d.byBranch.map((b) => b.branchId)).toEqual(['sucursal-1', 'sucursal-2', 'sucursal-3']);
    expect(d.byBranch.reduce((n, b) => n + b.orders, 0)).toBe(d.received);
    expect(
      d.alerts
        .filter((a) => a.type === 'no_rider')
        .map((a) => a.orderId)
        .sort(),
    ).toEqual(['MON-307051', 'MON-307052']);
    expect(d.alerts.some((a) => a.type === 'unaccepted' && a.orderId === 'MON-307057')).toBe(true);
  });

  it('filtra por estado (lista) y fecha; valida parámetros', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const ready = await bo.listBackofficeOrders(h.client, { status: ['ready', 'on_the_way'] });
    expect(ready.every((o) => o.status === 'ready' || o.status === 'on_the_way')).toBe(true);
    expect(ready).toHaveLength(5);
    const yesterday = await bo.listBackofficeOrders(h.client, { date: '2026-11-10' });
    expect(yesterday.length).toBeGreaterThan(60);
    expect(await status(bo.listBackofficeOrders(h.client, { date: '11/10/2026' }))).toBe(400);
    expect(
      await status(h.client.get('/v1/backoffice/orders', { query: { status: 'nuevo' } })),
    ).toBe(400);
  });
});

describe('transiciones de estado', () => {
  it('aceptar → preparar → listo → entregar (recoger)', async () => {
    const h = createHarness();
    h.asStaff('manager');
    const id = 'MON-307057';
    for (const s of ['accepted', 'preparing', 'ready', 'delivered'] as const) {
      expect((await bo.changeOrderStatus(h.client, { id, status: s })).status).toBe(s);
    }
    const o = h.store.orders.find((x) => x.id === id);
    expect(o?.payment.status).toBe('approved');
    expect(o?.history.filter((e) => e.kind === 'order').map((e) => e.status)).toEqual([
      'received',
      'accepted',
      'preparing',
      'ready',
      'delivered',
    ]);
  });

  it('transiciones inválidas → 409; rechazo sin motivo → 400', async () => {
    const h = createHarness();
    h.asStaff('admin');
    expect(
      await status(bo.changeOrderStatus(h.client, { id: 'MON-307057', status: 'ready' })),
    ).toBe(409);
    expect(
      await status(bo.changeOrderStatus(h.client, { id: 'MON-307047', status: 'accepted' })),
    ).toBe(409);
    // domicilio listo: no se marca entregado ni en camino a mano
    expect(
      await status(bo.changeOrderStatus(h.client, { id: 'MON-307051', status: 'delivered' })),
    ).toBe(409);
    expect(
      await status(bo.changeOrderStatus(h.client, { id: 'MON-307051', status: 'on_the_way' })),
    ).toBe(409);
    expect(
      await status(bo.changeOrderStatus(h.client, { id: 'MON-307057', status: 'rejected' })),
    ).toBe(400);
  });

  it('rechazar con motivo saca el pedido de "nuevos" y guarda el motivo', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const o = await bo.changeOrderStatus(h.client, {
      id: 'MON-307058',
      status: 'rejected',
      reason: 'Sucursal saturada',
    });
    expect(o).toMatchObject({ status: 'rejected', rejectionReason: 'Sucursal saturada' });
    expect(o.history.at(-1)).toMatchObject({ status: 'rejected', reason: 'Sucursal saturada' });
    const nuevos = await bo.listBackofficeOrders(h.client, { status: 'received' });
    expect(nuevos.map((x) => x.id)).not.toContain('MON-307058');
  });
});

describe('despacho y logística (simulados)', () => {
  it('PedidosYa: cotiza, busca repartidor y avanza hasta entregado', async () => {
    const h = createHarness();
    h.asStaff('manager', 'u4'); // encargado de sucursal-3
    const quote = await bo.quoteCourier(h.client, 'MON-307052');
    // envío cobrado Q15 (Mixco near) + recargo sembrado Q6
    expect(quote).toMatchObject({
      cost: 21,
      customerFee: 15,
      simulated: true,
      provider: 'pedidosya',
    });
    let o = await bo.dispatchOrder(h.client, { id: 'MON-307052', provider: 'pedidosya' });
    expect(o.delivery).toMatchObject({ status: 'searching', cost: 21, reference: 'PY-GT-7732000' });
    const steps: string[] = [];
    while (o.delivery?.status !== 'delivered') {
      o = await bo.advanceDelivery(h.client, o.id);
      steps.push(`${o.delivery?.status}/${o.status}`);
    }
    expect(steps).toEqual([
      'assigned/ready',
      'picking_up/ready',
      'picked_up/on_the_way',
      'on_the_way/on_the_way',
      'delivered/delivered',
    ]);
    expect(o.delivery?.riderName).toMatch(/· moto$/);
    expect(await status(bo.advanceDelivery(h.client, o.id))).toBe(409);
    expect(
      await status(bo.dispatchOrder(h.client, { id: o.id, provider: 'own', riderId: 'r5' })),
    ).toBe(409);
  });

  it('repartidor propio: valida sucursal, actividad y ocupación', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const dispatch = (riderId: string, id = 'MON-307051') =>
      status(bo.dispatchOrder(h.client, { id, provider: 'own', riderId }));
    expect(await dispatch('r3')).toBe(422); // otra sucursal
    expect(await status(bo.dispatchOrder(h.client, { id: 'MON-307051', provider: 'own' }))).toBe(
      400,
    );
    expect(await dispatch('r1')).toBe(200);
    const riders = await bo.listRiders(h.client, 'sucursal-1');
    expect(riders.find((r) => r.id === 'r1')?.busy).toBe(true);
    expect(await dispatch('r6', 'MON-307052')).toBe(422); // inactivo
    const o = await bo.advanceDelivery(h.client, 'MON-307051');
    expect(o).toMatchObject({ status: 'on_the_way', delivery: { status: 'on_the_way' } });
    const done = await bo.advanceDelivery(h.client, 'MON-307051');
    expect(done.status).toBe('delivered');
    expect(done.payment.status).toBe('approved'); // efectivo cobrado al entregar
  });

  it('solo se despachan pedidos listos a domicilio', async () => {
    const h = createHarness();
    h.asStaff('admin');
    expect(await status(bo.quoteCourier(h.client, 'MON-307050'))).toBe(409); // recoger
    expect(
      await status(bo.dispatchOrder(h.client, { id: 'MON-307054', provider: 'pedidosya' })),
    ).toBe(409);
  });

  it('rider-unavailable: la búsqueda falla y se puede despachar con repartidor propio', async () => {
    const h = createHarness('rider-unavailable');
    h.asStaff('admin');
    await bo.dispatchOrder(h.client, { id: 'MON-307051', provider: 'pedidosya' });
    const failed = await bo.advanceDelivery(h.client, 'MON-307051');
    expect(failed).toMatchObject({ status: 'ready', delivery: { status: 'failed' } });
    const d = await bo.getDashboard(h.client);
    expect(d.alerts.some((a) => a.type === 'no_rider' && a.orderId === 'MON-307051')).toBe(true);
    const own = await bo.dispatchOrder(h.client, {
      id: 'MON-307051',
      provider: 'own',
      riderId: 'r2',
    });
    expect(own.delivery).toMatchObject({ provider: 'own', status: 'assigned' });
  });

  it('entregas del periodo filtradas por proveedor', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const all = await bo.listDeliveries(h.client, { from: '2026-11-09', to: '2026-11-11' });
    expect(all.every((o) => o.fulfillment === 'delivery')).toBe(true);
    const own = await bo.listDeliveries(h.client, {
      from: '2026-11-09',
      to: '2026-11-11',
      provider: 'own',
    });
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((o) => o.delivery?.provider === 'own')).toBe(true);
  });

  it('pedido entrante simulado (demo)', async () => {
    const h = createHarness();
    h.asStaff('manager');
    const o = await bo.simulateIncomingOrder(h.client);
    expect(o).toMatchObject({ status: 'received', branchId: 'sucursal-1' });
    expect(o.total).toBeCloseTo(o.subtotal + o.deliveryFee, 2);
  });
});

describe('catálogo y administración', () => {
  it('F11: admin edita productos (global); encargado solo disponibilidad de su sucursal', async () => {
    const h = createHarness();
    h.asStaff('manager');
    expect(
      await status(products.updateAdminProduct(h.client, 'dumplings', { basePrice: '60.00' })),
    ).toBe(403);
    const p = await branchProducts.setAdminProductAvailability(h.client, 'dumplings', {
      branchId: 'sucursal-1',
      available: false,
    });
    expect(p.available).toBe(false);
    // F13: otra sucursal = 404 (no se revela); fijar precio sin `catalog.update` = 403.
    expect(
      await status(
        branchProducts.setAdminProductAvailability(h.client, 'dumplings', {
          branchId: 'sucursal-2',
          available: false,
        }),
      ),
    ).toBe(404);

    h.asStaff('admin');
    const edited = await products.updateAdminProduct(h.client, 'dumplings', { basePrice: '60.00' });
    expect(edited.basePrice).toBe('60.00');
    expect(
      await status(products.updateAdminProduct(h.client, 'dumplings', { basePrice: '0.00' })),
    ).toBe(400);
  });

  it('la disponibilidad del backoffice se refleja en la tienda', async () => {
    const h = createHarness();
    h.asStaff('admin');
    await branchProducts.setAdminProductAvailability(h.client, 'cangreburger', {
      branchId: 'sucursal-2',
      available: false,
    });
    const menu = await branchProducts.getStoreBranchMenu(h.client, 'sucursal-2');
    expect(menu.items.find((p) => p.productId === 'cangreburger')?.available).toBe(false);
  });

  it('categorías (orden/visibilidad) afectan el menú público', async () => {
    const h = createHarness();
    h.asStaff('admin');
    await admin.updateCategory(h.client, 'postres', { visible: false });
    const cats = await h.client.get<{ id: string }[]>('/v1/catalog/categories');
    expect(cats.map((c) => c.id)).not.toContain('postres');
    // F10/F11: la jerarquía del menú (F10) es la que decide la visibilidad de los productos públicos.
    await categories.updateAdminCategory(h.client, 'cat-postres', { active: false });
    const list = await products.listAllStoreProducts(h.client);
    expect(list.some((p) => p.category.slug === 'postres')).toBe(false);
  });
});

describe('reportes', () => {
  it('resumen por hora (un día) y por día (rango) con totales coherentes', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const day = await admin.getReportSummary(h.client, { from: '2026-11-10' });
    expect(day.unit).toBe('hour');
    expect(day.groups).toHaveLength(11);
    expect(day.groups.reduce((n, g) => n + g.orders, 0)).toBe(day.orders);

    const range = await admin.getReportSummary(h.client, { from: '2026-11-05', to: '2026-11-11' });
    expect(range.unit).toBe('day');
    expect(range.groups.map((g) => g.key)).toHaveLength(7);
    expect(range.groups.reduce((s, g) => s + g.sales, 0)).toBeCloseTo(range.sales, 1);
    expect(range.topProducts.length).toBeLessThanOrEqual(6);

    // El historial lista exactamente los pedidos que suma el resumen (criterio US5).
    const history = await admin.getReportHistory(h.client, {
      from: '2026-11-05',
      to: '2026-11-11',
    });
    expect(history).toHaveLength(range.orders);
  });

  it('recorta rangos fuera de los 60 días y respeta el alcance del encargado', async () => {
    const h = createHarness();
    h.asStaff('manager');
    const r = await admin.getReportSummary(h.client, { from: '2026-01-01', to: '2026-11-11' });
    expect(r).toMatchObject({ clipped: true, from: '2026-09-13', branchId: 'sucursal-1' });
    expect(r.byBranch.map((b) => b.branchId)).toEqual(['sucursal-1']);
    h.asStaff('kitchen');
    expect(await status(admin.getReportSummary(h.client))).toBe(403);
  });

  it('empty: sin pedidos ni historial', async () => {
    const h = createHarness('empty');
    h.asStaff('admin');
    expect(await bo.listBackofficeOrders(h.client)).toEqual([]);
    expect((await bo.getDashboard(h.client)).received).toBe(0);
    expect(
      (await admin.getReportSummary(h.client, { from: '2026-11-01', to: '2026-11-11' })).orders,
    ).toBe(0);
  });
});
