import { afterEach, describe, expect, it } from 'vitest';
import type {
  AdminOrderBoard,
  AdminOrderDetail,
  AdminOrderPage,
  AdminOrderTransitionResult,
} from '@/lib/data-access/models';
import { createHarness, type TestHarness } from '../testing';

/** F22 (spec 023 §11 #19–#28, #56): el mock responde las MISMAS rutas con la forma real y las mismas reglas que el servidor. */

const get = <T>(h: TestHarness, path: string, query?: Record<string, string>) =>
  h.client.get<T>(path, { query });
const post = <T = AdminOrderTransitionResult>(
  h: TestHarness,
  id: string,
  command: string,
  body: unknown,
) => h.client.post<T>(`/v1/admin/orders/${id}/${command}`, body);

const as = (role: Parameters<TestHarness['asStaff']>[0]) => {
  const h = createHarness();
  h.asStaff(role);
  return h;
};

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('GET /v1/admin/orders/board', () => {
  it('9 columnas en el orden del catálogo, conteos reales y pollAfterSeconds', async () => {
    const h = as('admin');
    const board = await get<AdminOrderBoard>(h, '/v1/admin/orders/board');
    expect(board.columns.map((c) => c.status)).toEqual([
      'pending',
      'accepted',
      'preparing',
      'ready',
      'on_the_way',
      'delivered',
      'picked_up',
      'rejected',
      'cancelled',
    ]);
    expect(board.pollAfterSeconds).toBe(15);
    expect(board.terminalWindowHours).toBe(24);
    expect(board.branchId).toBeNull();
    const pending = board.columns[0]!;
    expect(board.summary.pending).toBe(pending.count);
    expect(pending.items.map((i) => i.placedAt)).toEqual(
      [...pending.items.map((i) => i.placedAt)].sort(),
    );
    expect(board.summary.oldestPendingAt).toBe(pending.items[0]!.placedAt);
    for (const column of board.columns.filter((c) =>
      ['delivered', 'picked_up', 'rejected', 'cancelled'].includes(c.status),
    )) {
      expect(column.items.length).toBeLessThanOrEqual(10);
      expect(column.hasMore).toBe(column.count > column.items.length);
    }
  });

  it('el alcance se aplica en el «servidor»: el encargado solo ve su sucursal; un branchId ajeno es 404', async () => {
    const h = as('manager');
    const board = await get<AdminOrderBoard>(h, '/v1/admin/orders/board');
    const branches = new Set(board.columns.flatMap((c) => c.items.map((i) => i.branchId)));
    expect([...branches]).toEqual(['sucursal-1']);
    await expect(
      get(h, '/v1/admin/orders/board', { branchId: 'sucursal-2' }),
    ).rejects.toMatchObject({
      status: 404,
      businessCode: 'BRANCH_NOT_FOUND',
    });
  });

  it('sin sesión → 401; limit inválido → 400', async () => {
    const h = createHarness();
    await expect(get(h, '/v1/admin/orders/board')).rejects.toMatchObject({ status: 401 });
    h.asStaff('admin');
    await expect(get(h, '/v1/admin/orders/board', { limit: '0' })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('GET /v1/admin/orders/:id', () => {
  it('detalle con líneas, contacto, pago en efectivo PENDING (resumen de F24), historial con actor', async () => {
    const h = as('manager');
    const d = await get<AdminOrderDetail>(h, '/v1/admin/orders/MON-307051');
    expect(d).toMatchObject({
      id: 'MON-307051',
      status: 'ready',
      fulfillmentType: 'DELIVERY',
      deliveryProvider: 'OWN',
      currency: 'GTQ',
      paymentMethodPreference: 'cash',
      paymentStatus: 'PENDING',
      payment: {
        method: 'CASH',
        status: 'PENDING',
        outstanding: expect.stringMatching(/^\d+\.\d{2}$/),
        paidAt: null,
        possibleRefundReview: false,
        // Encargado: puede ver el pedido pero no tiene `payments.confirm` (solo `admin` hasta que F03 los asigne).
        registration: { allowed: false, blockedReason: 'NO_PERMISSION' },
      },
    });
    expect(d.contact.phone).toMatch(/^\+502/);
    expect(d.address?.addressLine).toContain('Reforma');
    expect(d.history.at(-1)).toMatchObject({ status: 'ready', previousStatus: 'preparing' });
    expect(d.historyTruncated).toBe(false);
    expect(d).not.toHaveProperty('email');
  });

  it('inexistente y de otra sucursal → el MISMO 404 ORDER_NOT_FOUND (anti-IDOR)', async () => {
    const h = as('manager');
    const other = await get(h, '/v1/admin/orders/MON-307058').catch((e: unknown) => e);
    const none = await get(h, '/v1/admin/orders/MON-999999').catch((e: unknown) => e);
    for (const e of [other, none])
      expect(e).toMatchObject({ status: 404, businessCode: 'ORDER_NOT_FOUND' });
    expect((other as Error).message).toBe((none as Error).message);
    // Los comandos devuelven el mismo 404.
    await expect(
      post(h, 'MON-307058', 'accept', { expectedStatus: 'pending' }),
    ).rejects.toMatchObject({
      status: 404,
      businessCode: 'ORDER_NOT_FOUND',
    });
  });
});

describe('comandos: permisos, validación y matriz', () => {
  it('accept: 200 con la tarjeta confirmada, transición y una fila nueva de historial con el actor', async () => {
    const h = as('manager');
    const r = await post(h, 'MON-307057', 'accept', { expectedStatus: 'pending' });
    expect(r.order).toMatchObject({ id: 'MON-307057', status: 'accepted' });
    expect(r.transition).toMatchObject({
      from: 'pending',
      to: 'accepted',
      replayed: false,
      appliedByMe: true,
    });
    expect(r.pendingActions).toEqual([]);
    const d = await get<AdminOrderDetail>(h, '/v1/admin/orders/MON-307057');
    const last = d.history.at(-1)!;
    expect(last).toMatchObject({
      status: 'accepted',
      previousStatus: 'pending',
      actorName: 'Marco Antonio Gómez',
    });
    expect(d.history.filter((e) => e.status === 'accepted')).toHaveLength(1);
  });

  it('el flujo completo PICKUP llega a picked_up (el borrador guarda delivered)', async () => {
    const h = as('manager');
    await post(h, 'MON-307057', 'accept', { expectedStatus: 'pending' });
    await post(h, 'MON-307057', 'start-preparing', { expectedStatus: 'accepted' });
    await post(h, 'MON-307057', 'mark-ready', { expectedStatus: 'preparing' });
    const r = await post(h, 'MON-307057', 'complete', { expectedStatus: 'ready' });
    expect(r.order.status).toBe('picked_up');
    expect(h.store.orders.find((o) => o.id === 'MON-307057')!.status).toBe('delivered');
  });

  it('sin el permiso del comando en ningún alcance → 403; sin motivo → 400 ORDER_REASON_REQUIRED', async () => {
    const staff = as('staff');
    await expect(
      post(staff, 'MON-307057', 'reject', { expectedStatus: 'pending', reason: 'no hay' }),
    ).rejects.toMatchObject({ status: 403 });
    const h = as('manager');
    for (const reason of [undefined, '', '   ', 'ab']) {
      await expect(
        post(h, 'MON-307057', 'reject', { expectedStatus: 'pending', reason }),
      ).rejects.toMatchObject({
        status: 400,
        businessCode: 'ORDER_REASON_REQUIRED',
      });
    }
    await expect(
      post(h, 'MON-307057', 'reject', { expectedStatus: 'pending', reason: 'a'.repeat(281) }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('el motivo se recorta y queda en el historial; otros comandos no aceptan reason ni campos extra', async () => {
    const h = as('manager');
    const r = await post(h, 'MON-307057', 'reject', {
      expectedStatus: 'pending',
      reason: '  Sin existencias  ',
    });
    expect(r.order.status).toBe('rejected');
    const d = await get<AdminOrderDetail>(h, '/v1/admin/orders/MON-307057');
    expect(d.history.at(-1)!.reason).toBe('Sin existencias');
    await expect(
      post(h, 'MON-307055', 'start-preparing', { expectedStatus: 'accepted', reason: 'x' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      post(h, 'MON-307055', 'start-preparing', { expectedStatus: 'accepted', extra: 1 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      post(h, 'MON-307055', 'start-preparing', { expectedStatus: 'volando' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(post(h, 'MON-307055', 'start-preparing', {})).rejects.toMatchObject({
      status: 400,
    });
  });

  it('403 ORDER_ACTION_FORBIDDEN: puede ver el pedido pero no tiene el permiso del comando en esa sucursal', async () => {
    const h = as('manager');
    const record = h.store.staff.find((u) => u.id === h.session.staff!.userId)!;
    // Encargado en la sucursal 1 y «empleado» (sin cancelar) en la 2.
    record.assignments.push({ roleId: 'role-staff', branchId: 'sucursal-2' });
    await expect(
      post(h, 'MON-307058', 'cancel', { expectedStatus: 'pending', reason: 'Cliente' }),
    ).rejects.toMatchObject({
      status: 403,
      businessCode: 'ORDER_ACTION_FORBIDDEN',
    });
    // En la sucursal 1 sí puede cancelar.
    const ok = await post(h, 'MON-307057', 'cancel', {
      expectedStatus: 'pending',
      reason: 'Cliente',
    });
    expect(ok.order.status).toBe('cancelled');
  });

  it('422 ORDER_TRANSITION_INVALID con violations[0].code y el estado actual', async () => {
    const h = as('admin');
    const cases: [string, string, string, string][] = [
      ['MON-307051', 'complete', 'ready', 'ORDER_FULFILLMENT_MISMATCH'],
      ['MON-307057', 'start-preparing', 'pending', 'ORDER_SOURCE_INVALID'],
      ['MON-307049', 'cancel', 'on_the_way', 'ORDER_CANCEL_NOT_ALLOWED'],
    ];
    for (const [id, command, expectedStatus, code] of cases) {
      const err = await post(h, id, command, {
        expectedStatus,
        ...(command === 'cancel' ? { reason: 'Prueba' } : {}),
      }).catch((e: unknown) => e);
      expect(err, `${command} ${id}`).toMatchObject({
        status: 422,
        businessCode: 'ORDER_TRANSITION_INVALID',
      });
      const body = (
        err as { body: { current: { status: string }; violations: { code: string }[] } }
      ).body;
      expect(body.violations[0]!.code).toBe(code);
      expect(body.current.status).toBeTruthy();
    }
    // Terminal: cualquier comando.
    await post(h, 'MON-307057', 'reject', { expectedStatus: 'pending', reason: 'Sin stock' });
    await expect(
      post(h, 'MON-307057', 'accept', { expectedStatus: 'rejected' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('409 ORDER_STATE_CONFLICT con current {status, updatedAt} y nada escrito', async () => {
    const h = as('admin');
    await post(h, 'MON-307057', 'reject', { expectedStatus: 'pending', reason: 'Sin stock' });
    const before = structuredClone(h.store.orders.find((o) => o.id === 'MON-307057')!.history);
    const err = await post(h, 'MON-307057', 'accept', { expectedStatus: 'pending' }).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ status: 409, businessCode: 'ORDER_STATE_CONFLICT' });
    expect((err as { body: { current: unknown } }).body.current).toMatchObject({
      status: 'rejected',
    });
    expect(h.store.orders.find((o) => o.id === 'MON-307057')!.history).toEqual(before);
  });

  it('repetición idempotente: 200 replayed=true sin segunda fila; por otra persona appliedByMe=false', async () => {
    const h = as('manager');
    await post(h, 'MON-307057', 'accept', { expectedStatus: 'pending' });
    const again = await post(h, 'MON-307057', 'accept', { expectedStatus: 'pending' });
    expect(again.transition).toMatchObject({ replayed: true, appliedByMe: true, to: 'accepted' });
    h.asStaff('admin');
    const other = await post(h, 'MON-307057', 'accept', { expectedStatus: 'pending' });
    expect(other.transition).toMatchObject({ replayed: true, appliedByMe: false });
    const d = await get<AdminOrderDetail>(h, '/v1/admin/orders/MON-307057');
    expect(d.history.filter((e) => e.status === 'accepted')).toHaveLength(1);
  });

  it('pendingActions: payment_review solo si el efectivo YA estaba cobrado (hecho real); sin cobro → []', async () => {
    const h = as('admin');
    await h.client.post(
      '/v1/admin/orders/MON-307058/payment/cash',
      { tendered: '5000.00', receivedConfirmed: true },
      { headers: { 'Idempotency-Key': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } },
    );
    const paid = await post(h, 'MON-307058', 'cancel', {
      expectedStatus: 'pending',
      reason: 'Prueba',
    });
    expect(paid.pendingActions).toEqual(['payment_review']);
    const unpaid = await post(h, 'MON-307057', 'cancel', {
      expectedStatus: 'pending',
      reason: 'Prueba',
    });
    expect(unpaid.pendingActions).toEqual([]);
  });

  it('los detalles de otra sucursal no se pueden modificar ni con permiso global de otra', async () => {
    const h = as('kitchen'); // cocina de la sucursal 1
    await expect(
      post(h, 'MON-307056', 'accept', { expectedStatus: 'accepted' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('fallos de prueba: 429 con Retry-After y 503 ORDERS_BUSY', async () => {
    const h = as('admin');
    (globalThis as unknown as { window: Window }).window = {
      __sushimonMockFaults: { 'GET /v1/admin/orders/board': ['rate-limited', 'busy'] },
    } as unknown as Window;
    await expect(get(h, '/v1/admin/orders/board')).rejects.toMatchObject({
      status: 429,
      retryAfterSec: 12,
      businessCode: 'RATE_LIMITED',
    });
    await expect(get(h, '/v1/admin/orders/board')).rejects.toMatchObject({
      status: 503,
      businessCode: 'ORDERS_BUSY',
    });
  });
});

describe('GET /v1/admin/orders (listado por cursor)', () => {
  const day = { from: '2026-11-11T00:00:00-06:00', to: '2026-11-11T23:59:59.999-06:00' };

  it('orden fijo placedAt desc; el cursor no repite ni salta filas', async () => {
    const h = as('admin');
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page: AdminOrderPage = await get<AdminOrderPage>(h, '/v1/admin/orders', {
        ...day,
        limit: '25',
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.items.map((o) => o.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(25);
    const all = await get<AdminOrderPage>(h, '/v1/admin/orders', { ...day, limit: '50' });
    expect(all.items.map((o) => o.placedAt)).toEqual(
      [...all.items.map((o) => o.placedAt)].sort().reverse(),
    );
  });

  it('filtros: status (csv), q por número y por nombre; fulfillmentType se retiró (400, ADR-0036)', async () => {
    const h = as('admin');
    const accepted = await get<AdminOrderPage>(h, '/v1/admin/orders', {
      ...day,
      status: 'accepted,preparing',
      limit: '50',
    });
    expect(accepted.items.length).toBeGreaterThan(0);
    expect(accepted.items.every((o) => ['accepted', 'preparing'].includes(o.status))).toBe(true);
    await expect(
      get(h, '/v1/admin/orders', { ...day, fulfillmentType: 'PICKUP', limit: '50' }),
    ).rejects.toMatchObject({ status: 400 });
    const byNumber = await get<AdminOrderPage>(h, '/v1/admin/orders', { ...day, q: 'MON-307057' });
    expect(byNumber.items.map((o) => o.id)).toEqual(['MON-307057']);
    const byDigits = await get<AdminOrderPage>(h, '/v1/admin/orders', { ...day, q: '307057' });
    expect(byDigits.items.map((o) => o.id)).toEqual(['MON-307057']);
    const byName = await get<AdminOrderPage>(h, '/v1/admin/orders', { ...day, q: 'DIEGO' });
    expect(byName.items.length).toBeGreaterThan(0);
    expect(byName.items.every((o) => o.customerName.toLowerCase().includes('diego'))).toBe(true);
    expect(byName.items.map((o) => o.id)).toContain('MON-307055');
  });

  it('400: status fuera del catálogo, q corto, fechas sin zona, rango > 92 días, cursor alterado', async () => {
    const h = as('admin');
    await expect(get(h, '/v1/admin/orders', { status: 'volando' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(get(h, '/v1/admin/orders', { q: 'a' })).rejects.toMatchObject({ status: 400 });
    await expect(get(h, '/v1/admin/orders', { from: '2026-11-11T00:00:00' })).rejects.toMatchObject(
      { status: 400 },
    );
    await expect(
      get(h, '/v1/admin/orders', {
        from: '2026-01-01T00:00:00-06:00',
        to: '2026-11-11T00:00:00-06:00',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      get(h, '/v1/admin/orders', { ...day, cursor: '%%%no-valido' }),
    ).rejects.toMatchObject({
      status: 400,
      businessCode: 'ORDER_CURSOR_INVALID',
    });
  });

  it('el alcance se aplica en la consulta: el encargado no lista pedidos de otra sucursal', async () => {
    const h = as('manager');
    const page = await get<AdminOrderPage>(h, '/v1/admin/orders', { ...day, limit: '50' });
    expect(new Set(page.items.map((o) => o.branchId))).toEqual(new Set(['sucursal-1']));
    await expect(get(h, '/v1/admin/orders', { branchId: 'sucursal-3' })).rejects.toMatchObject({
      status: 404,
      businessCode: 'BRANCH_NOT_FOUND',
    });
  });

  it('availableActions de cada fila dependen del permiso de la persona', async () => {
    const kitchen = as('kitchen');
    const page = await get<AdminOrderPage>(kitchen, '/v1/admin/orders', {
      ...day,
      q: 'MON-307057',
    });
    const actions = page.items[0]!.availableActions;
    expect(actions.find((a) => a.action === 'cancel')).toMatchObject({
      enabled: false,
      disabledReason: 'NO_PERMISSION',
    });
    expect(actions.find((a) => a.action === 'accept')).toMatchObject({ enabled: true });
  });
});
