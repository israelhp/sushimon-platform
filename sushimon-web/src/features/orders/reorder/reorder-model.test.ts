import { describe, expect, it } from 'vitest';
import {
  EMPTY_CART,
  addToCart,
  type AddToCartInput,
  type CartLine,
  type CartState,
} from '@/lib/cart-rules';
import { ApiError } from '@/lib/data-access/errors';
import type { OrderReorderLine, OrderReorderPreview } from '@/lib/data-access/models';
import {
  addableLines,
  applyReorder,
  groupLines,
  isFinalStatus,
  needsReplaceConfirmation,
  planMerge,
  previewErrorKind,
  priceChangeOf,
  toAddInput,
} from './reorder-model';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BRANCH = ID(1);
const OTHER = ID(2);

function available(
  n: number,
  quantity = 1,
  over: Partial<OrderReorderLine> = {},
): OrderReorderLine {
  return {
    lineNo: n,
    status: 'AVAILABLE',
    original: {
      productName: `P${n}`,
      quantity,
      unitPrice: '10.00',
      extrasPerUnit: '0.00',
      modifiers: [],
      notes: null,
    },
    current: { unitPrice: '10.00', extrasPerUnit: '0.00' },
    issues: [],
    candidate: {
      line: { productId: ID(100 + n), quantity, selections: [] },
      slug: `p-${n}`,
      note: null,
      display: { name: `P${n}`, imageUrl: null, unitPrice: '10.00', options: [] },
    },
    ...over,
  };
}

function preview(lines: OrderReorderLine[], branchId = BRANCH): OrderReorderPreview {
  return {
    generatedAt: '2026-11-19T12:00:00.000Z',
    source: {
      displayNumber: 'MON-000001',
      status: 'delivered',
      fulfillmentType: 'PICKUP',
      deliveryProvider: null,
      placedAt: '2026-11-01T12:00:00.000Z',
    },
    branch: {
      originalBranchId: BRANCH,
      requestedBranchId: branchId,
      sameBranch: branchId === BRANCH,
      name: 'S',
      active: true,
      acceptingOrders: true,
      reason: 'OPEN',
      nextOpensAt: null,
    },
    lines,
    summary: {
      lines: lines.length,
      available: 0,
      needsConfiguration: 0,
      unavailable: 0,
      priceChanged: 0,
      units: 0,
      estimatedSubtotal: '0.00',
      canAddAny: true,
    },
  };
}

/** Carrito mínimo en memoria con la lógica REAL de F18 (`addToCart`). */
function fakeCart(initial: CartState = EMPTY_CART) {
  let state = initial;
  return {
    get state() {
      return state;
    },
    add: (inputs: AddToCartInput | readonly AddToCartInput[], options?: { replace?: boolean }) => {
      const result = addToCart(
        state,
        Array.isArray(inputs) ? inputs : [inputs as AddToCartInput],
        1_700_000_000_000,
        options,
      );
      if (result.ok) state = result.state;
      return result;
    },
  };
}

const cartInput = (n: number, branchId = BRANCH, quantity = 1): AddToCartInput => ({
  productId: ID(100 + n),
  slug: `p-${n}`,
  branchId,
  quantity,
  selections: [],
  display: { name: `P${n}`, imageUrl: null, unitCents: 1000, options: [] },
});

describe('F23 · combinar con el carrito F18', () => {
  const lineOf = (
    branchId: string | null,
    n = 1,
  ): { branchId: string | null; lines: readonly CartLine[] } => {
    const cart = fakeCart();
    if (branchId) cart.add(cartInput(n, branchId));
    return cart.state;
  };

  it('carrito vacío: solo «añadir», sin confirmación', () => {
    const plan = planMerge(lineOf(null), BRANCH);
    expect(plan).toMatchObject({
      situation: 'empty',
      modes: ['add'],
      defaultMode: 'add',
      replaceCount: 0,
    });
    expect(needsReplaceConfirmation(plan, 'add')).toBe(false);
  });

  it('misma sucursal: «añadir» por defecto y «reemplazar» con confirmación y conteo', () => {
    const plan = planMerge(lineOf(BRANCH), BRANCH);
    expect(plan).toMatchObject({
      situation: 'same-branch',
      modes: ['add', 'replace'],
      defaultMode: 'add',
      replaceCount: 1,
    });
    expect(needsReplaceConfirmation(plan, 'add')).toBe(false);
    expect(needsReplaceConfirmation(plan, 'replace')).toBe(true);
  });

  it('sucursal distinta: SOLO reemplazar (con confirmación); nunca se mezclan sucursales', () => {
    const plan = planMerge(lineOf(OTHER), BRANCH);
    expect(plan).toMatchObject({
      situation: 'other-branch',
      modes: ['replace'],
      defaultMode: 'replace',
      replaceCount: 1,
    });
    expect(needsReplaceConfirmation(plan, 'replace')).toBe(true);
    // Defensa: aunque algo pidiera «añadir», el carrito F18 rechaza mezclar sucursales y no cambia.
    const cart = fakeCart(lineOf(OTHER) as CartState);
    const result = applyReorder(cart, preview([available(1)]), 'add');
    expect(result).toEqual({ ok: false, reason: 'BRANCH_MISMATCH' });
    expect(cart.state.branchId).toBe(OTHER);
  });
});

describe('F23 · aplicar al carrito', () => {
  it('añade SOLO las AVAILABLE; NEEDS_CONFIGURATION y UNAVAILABLE nunca entran', () => {
    const needs = available(2, 1, { status: 'NEEDS_CONFIGURATION' });
    const gone = available(3, 1, { status: 'UNAVAILABLE', candidate: null });
    const p = preview([available(1, 2), needs, gone]);
    expect(addableLines(p).map((l) => l.lineNo)).toEqual([1]);
    expect(groupLines(p)).toMatchObject({
      available: [{ lineNo: 1 }],
      needsConfiguration: [{ lineNo: 2 }],
      unavailable: [{ lineNo: 3 }],
    });
    const cart = fakeCart();
    expect(applyReorder(cart, p, 'add')).toEqual({ ok: true, lines: 1, units: 2 });
    expect(cart.state.lines.map((l) => [l.slug, l.quantity])).toEqual([['p-1', 2]]);
    expect(cart.state.branchId).toBe(BRANCH);
  });

  it('misma sucursal: «añadir» suma con la unificación de F18 (una configuración idéntica sube la cantidad)', () => {
    const cart = fakeCart();
    cart.add(cartInput(1, BRANCH, 2));
    cart.add(cartInput(9, BRANCH, 1));
    const result = applyReorder(cart, preview([available(1, 3)]), 'add');
    expect(result).toMatchObject({ ok: true });
    expect(cart.state.lines.map((l) => [l.slug, l.quantity])).toEqual([
      ['p-1', 5],
      ['p-9', 1],
    ]);
  });

  it('«reemplazar» sustituye todo el carrito en la misma operación', () => {
    const cart = fakeCart();
    cart.add(cartInput(9, OTHER, 4));
    expect(applyReorder(cart, preview([available(1)]), 'replace')).toMatchObject({ ok: true });
    expect(cart.state.branchId).toBe(BRANCH);
    expect(cart.state.lines.map((l) => l.slug)).toEqual(['p-1']);
  });

  it('tope excedido: se rechaza con el motivo de F18, sin recortar y SIN tocar el carrito', () => {
    const cart = fakeCart();
    cart.add(cartInput(9, BRANCH, 99));
    const before = cart.state;
    // 99 + 1 de la misma configuración supera el máximo por configuración.
    const r = applyReorder(cart, preview([available(9, 1)]), 'add');
    expect(r).toEqual({ ok: false, reason: 'LIMIT_QUANTITY' });
    expect(cart.state).toBe(before);
    // 31 líneas distintas superan el máximo de líneas: todas o ninguna.
    const many = fakeCart();
    const lines = Array.from({ length: 31 }, (_, i) => available(i + 1));
    expect(applyReorder(many, preview(lines), 'replace')).toEqual({
      ok: false,
      reason: 'LIMIT_LINES',
    });
    expect(many.state.lines).toHaveLength(0);
  });

  it('sin líneas agregables => NOTHING_TO_ADD y el carrito no cambia', () => {
    const cart = fakeCart();
    const p = preview([available(1, 1, { status: 'UNAVAILABLE', candidate: null })]);
    expect(applyReorder(cart, p, 'add')).toEqual({ ok: false, reason: 'NOTHING_TO_ADD' });
    expect(cart.state.lines).toHaveLength(0);
  });

  it('la línea del carrito trae ids, selecciones y presentación de la candidata (sin precios del pedido original)', () => {
    const line = available(1, 2);
    line.candidate!.line.selections = [{ groupId: ID(7), optionId: ID(8), quantity: 1 }];
    line.candidate!.display.options = [
      {
        groupId: ID(7),
        optionId: ID(8),
        groupName: 'Extras',
        optionName: 'Queso',
        extraPrice: '5.00',
      },
    ];
    line.candidate!.note = 'Sin ajonjolí';
    const input = toAddInput(line, BRANCH);
    expect(input).toMatchObject({
      productId: ID(101),
      slug: 'p-1',
      branchId: BRANCH,
      quantity: 2,
      note: 'Sin ajonjolí',
      selections: [{ groupId: ID(7), optionId: ID(8), quantity: 1 }],
      display: { name: 'P1', unitCents: 1000, options: [{ extraCents: 500, optionName: 'Queso' }] },
    });
    line.candidate!.display.unitPrice = 'abc';
    expect(toAddInput(line, BRANCH)).toBeNull();
  });
});

describe('F23 · piezas auxiliares', () => {
  it('PRICE_CHANGED: antes → ahora informativo', () => {
    const l = available(1, 1, {
      issues: [
        {
          code: 'PRICE_CHANGED',
          severity: 'info',
          previousUnitPrice: '42.00',
          currentUnitPrice: '46.00',
        },
      ],
    });
    expect(priceChangeOf(l)).toEqual({ previous: '42.00', current: '46.00' });
    expect(priceChangeOf(available(2))).toBeNull();
  });

  it('un pedido en curso (no final) pide confirmar', () => {
    expect(
      ['pending', 'accepted', 'preparing', 'ready', 'on_the_way'].map((s) =>
        isFinalStatus(s as 'pending'),
      ),
    ).toEqual([false, false, false, false, false]);
    expect(
      ['delivered', 'picked_up', 'rejected', 'cancelled'].every((s) =>
        isFinalStatus(s as 'delivered'),
      ),
    ).toBe(true);
  });

  it('401/403/404, 429, 5xx y sin conexión se clasifican como fallo de la consulta, nunca como estado de negocio', () => {
    const e = (status: number, wait?: number) =>
      previewErrorKind(
        new ApiError(status, 'x', 'm', undefined, undefined, undefined, undefined, wait),
      );
    expect(e(401).kind).toBe('denied');
    expect(e(404).kind).toBe('denied');
    expect(e(429, 7)).toEqual({ kind: 'rateLimited', retryAfterSec: 7 });
    expect(e(503, 2)).toEqual({ kind: 'busy', retryAfterSec: 2 });
    expect(e(0).kind).toBe('offline');
    expect(previewErrorKind(new Error('x')).kind).toBe('unknown');
  });
});
