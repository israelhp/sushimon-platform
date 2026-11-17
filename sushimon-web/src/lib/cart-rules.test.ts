import { describe, expect, it } from 'vitest';
import type { PublicModifierGroup } from '@/lib/data-access/models';
import { cartInput } from '@/test/cart';
import {
  CART_MAX_BYTES,
  CART_MAX_LINES,
  CART_MAX_UNITS,
  CART_STORAGE_KEY,
  CART_TTL_MS,
  DETAIL_NOT_FOUND,
  EMPTY_CART,
  acknowledgePriceChange,
  addToCart,
  amountToCents,
  applyBranchSwitch,
  applyPatches,
  cartSubtotalCents,
  cartUnits,
  changeLineQuantity,
  cleanText,
  isCartExpired,
  replaceLine,
  CART_FUTURE_SKEW_MS,
  computeLineId,
  evaluateContinue,
  evaluateLine,
  legacyCartHadLines,
  lineSubtotalCents,
  normalizeNote,
  parseCartV2,
  planBranchSwitch,
  removeLine,
  serializeCart,
  setLineQuantity,
  toQuoteInput,
  type AddToCartInput,
  type CartLine,
  type CartQuoteInput,
  type CartState,
  type LiveCard,
} from './cart-rules';

const NOW = 1_800_000_000_000;
const sel = (groupId: string, optionId: string) => ({ groupId, optionId, quantity: 1 });
const opt = (groupId: string, optionId: string, extraCents: number, optionName = optionId) => ({
  groupId,
  optionId,
  groupName: groupId,
  optionName,
  extraCents,
});

function must(state: CartState, input: AddToCartInput | AddToCartInput[], now = NOW): CartState {
  const r = addToCart(state, Array.isArray(input) ? input : [input], now);
  if (!r.ok) throw new Error(`rechazado: ${r.reason}`);
  return r.state;
}

describe('lineId y clave canónica', () => {
  it('es estable ante distinto orden de selecciones y de grupos (#8)', () => {
    const a = computeLineId('p1', 'b1', 'nota', [
      sel('g1', 'o1'),
      sel('g2', 'o9'),
      sel('g1', 'o2'),
    ]);
    const b = computeLineId('p1', 'b1', 'nota', [
      sel('g1', 'o2'),
      sel('g1', 'o1'),
      sel('g2', 'o9'),
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^l1_[0-9a-f]{28}$/);
  });

  it('cambia con producto, sucursal, selecciones o nota; la nota ignora mayúsculas y espacios', () => {
    const base = computeLineId('p1', 'b1', 'Sin picante', []);
    expect(computeLineId('p1', 'b1', '  sin   PICANTE ', [])).toBe(base);
    expect(computeLineId('p2', 'b1', 'Sin picante', [])).not.toBe(base);
    expect(computeLineId('p1', 'b2', 'Sin picante', [])).not.toBe(base);
    expect(computeLineId('p1', 'b1', 'Con picante', [])).not.toBe(base);
    expect(computeLineId('p1', 'b1', 'Sin picante', [sel('g', 'o')])).not.toBe(base);
  });

  it('la nota se normaliza (NFC, controles, espacios) y se corta a 140 puntos de código', () => {
    expect(normalizeNote('  a\u0000\n  b  ')).toBe('a b');
    expect(normalizeNote('é')).toBe('é');
    expect(Array.from(normalizeNote('😀'.repeat(300)))).toHaveLength(140);
  });
});

describe('agregar, unificar y separar (#2, #6, #7)', () => {
  it('unifica configuración idéntica y separa la distinta', () => {
    let s = must(EMPTY_CART, cartInput('dumplings', 1));
    s = must(s, cartInput('dumplings', 2));
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]?.quantity).toBe(3);
    s = must(s, cartInput('dumplings', 1, 'sin salsa'));
    s = must(
      s,
      cartInput('dumplings', 1, '', {
        selections: [sel('g1', 'o1')],
        options: [opt('g1', 'o1', 300)],
      }),
    );
    expect(s.lines).toHaveLength(3);
    expect(cartUnits(s.lines)).toBe(5);
    expect(s.branchId).toBe('sucursal-1');
  });

  it('el orden de selección no crea líneas distintas', () => {
    const options = [opt('g1', 'o1', 0), opt('g2', 'o2', 0)];
    let s = must(
      EMPTY_CART,
      cartInput('p', 1, '', { selections: [sel('g1', 'o1'), sel('g2', 'o2')], options }),
    );
    s = must(
      s,
      cartInput('p', 1, '', {
        selections: [sel('g2', 'o2'), sel('g1', 'o1')],
        options: [...options].reverse(),
      }),
    );
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]?.quantity).toBe(2);
  });

  it('rechaza otra sucursal (nunca mezcla ni vacía) y entradas inválidas', () => {
    const s = must(EMPTY_CART, cartInput('dumplings', 1));
    expect(addToCart(s, [cartInput('dumplings', 1, '', { branchId: 'sucursal-2' })], NOW)).toEqual({
      ok: false,
      reason: 'BRANCH_MISMATCH',
    });
    expect(addToCart(s, [{ ...cartInput('x'), productId: 'a b' }], NOW)).toMatchObject({
      ok: false,
    });
    // selección sin su opción de presentación
    expect(
      addToCart(s, [cartInput('x', 1, '', { selections: [sel('g', 'o')] })], NOW),
    ).toMatchObject({ ok: false, reason: 'INVALID_INPUT' });
    // selección repetida
    expect(
      addToCart(
        s,
        [
          cartInput('x', 1, '', {
            selections: [sel('g', 'o'), sel('g', 'o')],
            options: [opt('g', 'o', 0), opt('g', 'o', 0)],
          }),
        ],
        NOW,
      ),
    ).toMatchObject({ ok: false });
  });

  it('un carrito con otra sucursal no se mezcla ni siquiera dentro de un lote', () => {
    expect(
      addToCart(
        EMPTY_CART,
        [cartInput('a', 1), cartInput('b', 1, '', { branchId: 'sucursal-2' })],
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'BRANCH_MISMATCH' });
  });
});

describe('cantidades y topes (#9, #10, #23)', () => {
  it.each([0, -1, Number.NaN, 100, 1.5, Infinity])(
    'rechaza la cantidad inválida %s al agregar',
    (q) => {
      expect(addToCart(EMPTY_CART, [cartInput('dumplings', q)], NOW)).toMatchObject({
        ok: false,
        reason: 'INVALID_QUANTITY',
      });
    },
  );

  it('±1, a 0 elimina; fijar 0 elimina; valores inválidos no cambian nada', () => {
    const s = must(EMPTY_CART, [cartInput('a', 1), cartInput('b', 2)]);
    const [a, b] = s.lines as [CartLine, CartLine];
    const up = changeLineQuantity(s, a.lineId, 1, NOW);
    expect(up.ok && up.state.lines[0]?.quantity).toBe(2);
    const gone = changeLineQuantity(s, a.lineId, -1, NOW);
    expect(gone.ok && gone.state.lines.map((l) => l.productId)).toEqual(['b']);
    const empty = removeLine(gone.ok ? gone.state : s, b.lineId, NOW);
    expect(empty.ok && empty.state.branchId).toBeNull();
    expect(setLineQuantity(s, a.lineId, 0, NOW).ok).toBe(true);
    for (const bad of [Number.NaN, -3, 100, 2.5]) {
      expect(setLineQuantity(s, a.lineId, bad, NOW)).toMatchObject({ ok: false });
    }
    expect(setLineQuantity(s, 'no-existe', 1, NOW)).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('99 por configuración: pasar de 99 se RECHAZA (no se recorta); también entre líneas que difieren solo en la nota', () => {
    let s = must(EMPTY_CART, cartInput('a', 99));
    expect(addToCart(s, [cartInput('a', 1)], NOW)).toEqual({ ok: false, reason: 'LIMIT_QUANTITY' });
    expect(addToCart(s, [cartInput('a', 1, 'otra nota')], NOW)).toEqual({
      ok: false,
      reason: 'LIMIT_QUANTITY',
    });
    expect(s.lines[0]?.quantity).toBe(99);
    s = must(s, cartInput('b', 98));
    expect(changeLineQuantity(s, s.lines[1]!.lineId, 2, NOW)).toEqual({
      ok: false,
      reason: 'LIMIT_QUANTITY',
    });
  });

  it('30 líneas y 200 unidades', () => {
    let s = EMPTY_CART;
    for (let i = 0; i < CART_MAX_LINES; i++) s = must(s, cartInput(`p${i}`, 1));
    expect(addToCart(s, [cartInput('extra', 1)], NOW)).toEqual({
      ok: false,
      reason: 'LIMIT_LINES',
    });
    let u = EMPTY_CART;
    u = must(u, [cartInput('a', 99), cartInput('b', 99)]);
    expect(cartUnits(u.lines)).toBe(198);
    expect(addToCart(u, [cartInput('c', 3)], NOW)).toEqual({ ok: false, reason: 'LIMIT_UNITS' });
    expect(CART_MAX_UNITS).toBe(200);
  });

  it('30 selecciones por línea', () => {
    const many = Array.from({ length: 31 }, (_, i) => sel(`g${i}`, `o${i}`));
    expect(
      addToCart(
        EMPTY_CART,
        [
          cartInput('a', 1, '', {
            selections: many,
            options: many.map((m) => opt(m.groupId, m.optionId, 0)),
          }),
        ],
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'LIMIT_SELECTIONS' });
  });
});

describe('dinero en centavos (#13, #14, #15)', () => {
  it('convierte importes por cadena y rechaza lo no canónico', () => {
    expect(amountToCents('85.00')).toBe(8500);
    expect(amountToCents('0.10')).toBe(10);
    expect(amountToCents('0.00')).toBe(0);
    expect(amountToCents('85')).toBeNull();
    expect(amountToCents('85.5')).toBeNull();
    expect(amountToCents('-1.00')).toBeNull();
    expect(amountToCents('9999999.00')).toBeNull();
  });

  it('subtotal con extras × cantidad y precisión (0.1 + 0.2, 3 × 33.33, extras 0.00)', () => {
    const s = must(EMPTY_CART, [
      cartInput('a', 2, '', {
        unitCents: 8500,
        selections: [sel('g', 'o')],
        options: [opt('g', 'o', 500)],
      }),
      cartInput('b', 3, '', { unitCents: 3333 }),
      cartInput('c', 1, '', { unitCents: 10 }),
      cartInput('d', 1, '', { unitCents: 20 }),
      cartInput('e', 1, '', {
        unitCents: 100,
        selections: [sel('g', 'z')],
        options: [opt('g', 'z', 0)],
      }),
    ]);
    expect(lineSubtotalCents(s.lines[0] as CartLine)).toBe((8500 + 500) * 2);
    expect(lineSubtotalCents(s.lines[1] as CartLine)).toBe(9999);
    expect(cartSubtotalCents(s.lines)).toBe(18000 + 9999 + 10 + 20 + 100);
    // 0.1 + 0.2 en flotante da 0.30000000000000004; en centavos es exacto
    expect(cartSubtotalCents(s.lines.slice(2, 4))).toBe(30);
    expect(Number.isInteger(cartSubtotalCents(s.lines))).toBe(true);
  });

  it('usa el precio provisional que la línea guarda (el de la sucursal)', () => {
    const s = must(EMPTY_CART, cartInput('a', 2, '', { unitCents: 8600 }));
    expect(cartSubtotalCents(s.lines)).toBe(17200);
  });
});

describe('lectura estricta de monsushi-cart-v2 (#22 #23 #24 #25 #39)', () => {
  const good = must(EMPTY_CART, [
    cartInput('dumplings', 2),
    cartInput('a', 1, 'nota', { selections: [sel('g', 'o')], options: [opt('g', 'o', 100)] }),
  ]);
  const read = (raw: string | null, now = NOW) => parseCartV2(raw, now);

  it('ida y vuelta conserva el carrito y recalcula lineId', () => {
    const r = read(serializeCart(good));
    expect(r.notice).toBeNull();
    expect(r.state.lines.map((l) => l.lineId)).toEqual(good.lines.map((l) => l.lineId));
    const tampered = JSON.parse(serializeCart(good));
    tampered.lines[0].lineId = 'l1_falso';
    expect(read(JSON.stringify(tampered)).state.lines[0]?.lineId).toBe(good.lines[0]?.lineId);
  });

  it('vacío, JSON corrupto, versión errónea, tipos y topes → estado seguro + aviso + borrar', () => {
    expect(read(null)).toMatchObject({ state: EMPTY_CART, notice: null, discard: false });
    const corrupt = [
      '{no-json',
      '[]',
      '"x"',
      '{"v":1,"lines":[]}',
      JSON.stringify({ ...good, v: 3 }),
    ];
    for (const raw of corrupt) {
      expect(read(raw), raw).toMatchObject({ state: EMPTY_CART, notice: 'corrupt', discard: true });
    }
    const bad = (patch: object) => JSON.stringify({ ...good, ...patch });
    expect(read(bad({ updatedAt: 'ayer' })).notice).toBe('corrupt');
    expect(read(bad({ branchId: null })).notice).toBe('corrupt'); // líneas sin sucursal
    expect(read(bad({ branchId: 'con espacios' })).notice).toBe('corrupt');
    expect(
      read(bad({ lines: Array.from({ length: CART_MAX_LINES + 1 }, () => good.lines[0]) })).notice,
    ).toBe('corrupt');
    expect(read('x'.repeat(CART_MAX_BYTES + 1)).notice).toBe('corrupt');
    expect(CART_STORAGE_KEY).toBe('monsushi-cart-v2');
  });

  it('más de 200 unidades en el documento es corrupto', () => {
    const big = JSON.parse(serializeCart(good));
    big.lines = Array.from({ length: 3 }, (_, i) => ({
      ...good.lines[0],
      productId: `p${i}`,
      slug: `p${i}`,
      quantity: 99,
    }));
    expect(read(JSON.stringify(big)).notice).toBe('corrupt');
  });

  it('una línea inválida aislada se descarta y se cuenta; no exige UUID', () => {
    const doc = JSON.parse(serializeCart(good));
    doc.lines.push({ ...doc.lines[0], quantity: 0 });
    doc.lines.push({ ...doc.lines[0], productId: '<script>' });
    const r = read(JSON.stringify(doc));
    expect(r).toMatchObject({ notice: 'dropped', dropped: 2 });
    expect(r.state.lines).toHaveLength(2);
    expect(r.state.lines[0]?.productId).toBe('dumplings'); // id del mock, no UUID
  });

  it('descarta líneas con importes no enteros, imagen no https o precio fuera de rango', () => {
    const doc = JSON.parse(serializeCart(good));
    doc.lines[0].display.unitCents = 53.5;
    doc.lines[1].display.unitCents = 100_000_000;
    expect(read(JSON.stringify(doc))).toMatchObject({ dropped: 2, notice: 'dropped' });
    const img = JSON.parse(serializeCart(good));
    img.lines[0].display.imageUrl = 'javascript:alert(1)';
    expect(read(JSON.stringify(img)).state.lines[0]?.display.imageUrl).toBeNull();
  });

  it('TTL de 7 días desde la última edición', () => {
    expect(read(serializeCart(good), NOW + CART_TTL_MS).notice).toBeNull();
    expect(read(serializeCart(good), NOW + CART_TTL_MS + 1)).toMatchObject({
      state: EMPTY_CART,
      notice: 'expired',
      discard: true,
    });
  });

  it('un carrito v1 (arreglo) no se migra: el aviso solo aplica si tenía productos', () => {
    expect(legacyCartHadLines('[{"productId":"dumplings","quantity":1,"note":""}]')).toBe(true);
    expect(legacyCartHadLines('[]')).toBe(false);
    expect(legacyCartHadLines(null)).toBe(false);
    expect(legacyCartHadLines('no-json')).toBe(false);
    // En la clave v2 un arreglo de v1 es corrupto: no se interpreta.
    expect(read('[{"productId":"dumplings","quantity":1,"note":""}]').state).toBe(EMPTY_CART);
  });

  it('el JSON guardado no lleva tokens, correo, teléfono ni datos de pago', () => {
    const json = serializeCart(good).toLowerCase();
    for (const forbidden of [
      'token',
      'bearer',
      'password',
      'email',
      'correo',
      'phone',
      'cvv',
      'pan',
      'card',
      'authorization',
    ]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    expect(Object.keys(JSON.parse(serializeCart(good))).sort()).toEqual([
      'branchId',
      'lines',
      'updatedAt',
      'v',
    ]);
  });
});

// ── Revalidación por línea ───────────────────────────────────────────────────────────────────────────────

const group = (over: Partial<PublicModifierGroup> = {}): PublicModifierGroup => ({
  id: 'g1',
  name: 'Salsa',
  minSelect: 1,
  maxSelect: 1,
  required: true,
  options: [
    { id: 'o1', name: 'Ponzu', extraPrice: '0.00' },
    { id: 'o2', name: 'Anguila', extraPrice: '2.50' },
  ],
  ...over,
});
const card = (over: Partial<LiveCard> = {}): LiveCard => ({
  productId: 'p',
  slug: 'p',
  name: 'p',
  imageUrl: null,
  priceCents: 5300,
  available: true,
  ...over,
});
const lineWith = (selectionIds: string[] = ['o1'], unitCents = 5300): CartLine => {
  const selections = selectionIds.map((o) => sel('g1', o));
  const s = must(
    EMPTY_CART,
    cartInput('p', 2, '', {
      unitCents,
      selections,
      options: selectionIds.map((o) => opt('g1', o, o === 'o2' ? 250 : 0, o)),
    }),
  );
  return s.lines[0] as CartLine;
};

describe('evaluateLine (#18 #19 #20 #21)', () => {
  it('OK cuando todo coincide (sin ficha se omiten los extras)', () => {
    const line = lineWith();
    expect(
      evaluateLine(line, { card: card({ name: 'p' }), detail: { groups: [group()] } }).status,
    ).toBe('OK');
    expect(evaluateLine(line, { card: card(), detail: null }).status).toBe('OK');
  });

  it('agotado, no vendido y 404', () => {
    const line = lineWith();
    expect(evaluateLine(line, { card: card({ available: false }), detail: null }).status).toBe(
      'UNAVAILABLE',
    );
    expect(evaluateLine(line, { card: null, detail: null }).status).toBe('INACTIVE');
    expect(evaluateLine(line, { card: null, detail: DETAIL_NOT_FOUND }).status).toBe('NOT_FOUND');
  });

  it('grupo quitado, obligatorio nuevo sin selección, mínimo y máximo violados → MODIFIER_INVALID', () => {
    const line = lineWith();
    expect(evaluateLine(line, { card: card(), detail: { groups: [] } }).status).toBe(
      'MODIFIER_INVALID',
    );
    const noSel = must(EMPTY_CART, cartInput('p', 1, '', { unitCents: 5300 })).lines[0] as CartLine;
    expect(evaluateLine(noSel, { card: card(), detail: { groups: [group()] } }).status).toBe(
      'MODIFIER_INVALID',
    );
    expect(
      evaluateLine(lineWith(['o1', 'o2']), { card: card(), detail: { groups: [group()] } }).status,
    ).toBe('MODIFIER_INVALID'); // máximo 1
    expect(
      evaluateLine(lineWith(['o1']), {
        card: card(),
        detail: { groups: [group({ minSelect: 2, maxSelect: 2 })] },
      }).status,
    ).toBe('MODIFIER_INVALID'); // mínimo 2
  });

  it('opción eliminada → OPTION_UNAVAILABLE sin tocar las selecciones', () => {
    const line = lineWith(['o2']);
    const g = group({ options: [{ id: 'o1', name: 'Ponzu', extraPrice: '0.00' }] });
    const r = evaluateLine(line, { card: card(), detail: { groups: [g] } });
    expect(r.status).toBe('OPTION_UNAVAILABLE');
    expect(line.selections).toEqual([sel('g1', 'o2')]);
  });

  it('precio cambiado: aviso con antes → ahora, parche con lo vigente y sin bloquear', () => {
    const line = lineWith(['o2'], 5000); // 5000 + 250 = 5250
    const r = evaluateLine(line, {
      card: card({ priceCents: 5300 }),
      detail: { groups: [group()] },
    });
    expect(r).toMatchObject({
      status: 'PRICE_CHANGED',
      liveUnitCents: 5550,
      previousUnitCents: 5250,
    });
    expect(r.patch?.unitCents).toBe(5300);
    const extraChanged = evaluateLine(lineWith(['o2'], 5300), {
      card: card(),
      detail: {
        groups: [
          group({
            options: [
              { id: 'o2', name: 'Anguila', extraPrice: '3.00' },
              { id: 'o1', name: 'Ponzu', extraPrice: '0.00' },
            ],
          }),
        ],
      },
    });
    expect(extraChanged.status).toBe('PRICE_CHANGED'); // cambió el extra
    // aplicar el parche deja el aviso hasta «Entendido»
    const state = must(EMPTY_CART, cartInput('p', 2, '', { unitCents: 5000 }));
    const l = state.lines[0] as CartLine;
    const ev = evaluateLine(l, { card: card({ priceCents: 5300 }), detail: null });
    const patched = applyPatches(state, ev.patch ? [ev.patch] : [], NOW + 1);
    expect(patched.lines[0]?.display).toMatchObject({
      unitCents: 5300,
      priceChange: { fromCents: 5000 },
    });
    expect(patched.updatedAt).toBe(state.updatedAt); // la revalidación no renueva el TTL
    expect(applyPatches(patched, ev.patch ? [ev.patch] : [], NOW + 2)).toBe(
      patched === patched ? patched : patched,
    );
    const again = evaluateLine(patched.lines[0] as CartLine, {
      card: card({ priceCents: 5300 }),
      detail: null,
    });
    expect(again).toMatchObject({ status: 'PRICE_CHANGED', previousUnitCents: 5000 });
    const acked = acknowledgePriceChange(patched, l.lineId);
    expect(
      evaluateLine(acked.lines[0] as CartLine, { card: card({ priceCents: 5300 }), detail: null })
        .status,
    ).toBe('OK');
  });

  it('otra sucursal: BRANCH_MISMATCH', () => {
    expect(
      evaluateLine(lineWith(), { card: card(), detail: null, branchMismatch: true }).status,
    ).toBe('BRANCH_MISMATCH');
  });
});

describe('«Continuar» (#31)', () => {
  const base = {
    lineCount: 1,
    statuses: ['OK'] as const,
    revalidation: 'ready' as const,
    modeBranchId: 'b',
    cartBranchId: 'b',
  };
  it('permite con todo válido (PRICE_CHANGED no bloquea)', () => {
    expect(evaluateContinue({ ...base, statuses: ['OK', 'PRICE_CHANGED'] }).canContinue).toBe(true);
  });
  it.each([
    ['vacío', { lineCount: 0, statuses: [] }, 'EMPTY'],
    ['sin sucursal', { modeBranchId: null }, 'NO_BRANCH'],
    ['otra sucursal', { cartBranchId: 'x' }, 'BRANCH_MISMATCH'],
    ['pendiente', { revalidation: 'pending' }, 'PENDING'],
    ['idle', { revalidation: 'idle' }, 'PENDING'],
    ['error', { revalidation: 'error' }, 'ERROR'],
    ['línea agotada', { statuses: ['OK', 'UNAVAILABLE'] }, 'INVALID_LINES'],
    ['modificador', { statuses: ['MODIFIER_INVALID'] }, 'INVALID_LINES'],
    ['opción', { statuses: ['OPTION_UNAVAILABLE'] }, 'INVALID_LINES'],
    ['no encontrado', { statuses: ['NOT_FOUND'] }, 'INVALID_LINES'],
    ['inactivo', { statuses: ['INACTIVE'] }, 'INVALID_LINES'],
    ['otra sucursal (línea)', { statuses: ['BRANCH_MISMATCH'] }, 'INVALID_LINES'],
  ] as const)('bloquea: %s', (_n, patch, blocker) => {
    const r = evaluateContinue({ ...base, ...patch } as Parameters<typeof evaluateContinue>[0]);
    expect(r.canContinue).toBe(false);
    expect(r.blockers).toContain(blocker);
  });
});

describe('planBranchSwitch (#17)', () => {
  const state = must(EMPTY_CART, [
    cartInput('ok', 1, '', { unitCents: 5000 }),
    cartInput('caro', 1, '', { unitCents: 4000 }),
    cartInput('agotado', 1),
    cartInput('nuevo-no-vendido', 1),
    cartInput('sin-ficha', 1),
    cartInput('extra-viejo', 1, '', {
      selections: [sel('g1', 'o9')],
      options: [opt('g1', 'o9', 0)],
    }),
  ]);
  const cards = new Map<string, LiveCard>([
    ['ok', card({ productId: 'ok', slug: 'ok', name: 'ok', priceCents: 5000 })],
    ['caro', card({ productId: 'caro', slug: 'caro', name: 'caro', priceCents: 4500 })],
    ['agotado', card({ productId: 'agotado', slug: 'agotado', name: 'agotado', available: false })],
    ['sin-ficha', card({ productId: 'sin-ficha', slug: 'sin-ficha', name: 'sin-ficha' })],
    ['extra-viejo', card({ productId: 'extra-viejo', slug: 'extra-viejo', name: 'extra-viejo' })],
  ]);
  const details = new Map<string, { groups: PublicModifierGroup[] } | typeof DETAIL_NOT_FOUND>([
    ['ok', { groups: [] }],
    ['caro', { groups: [] }],
    ['agotado', { groups: [] }],
    ['nuevo-no-vendido', { groups: [] }],
    ['sin-ficha', DETAIL_NOT_FOUND],
    ['extra-viejo', { groups: [group()] }],
  ]);

  it('no está listo sin menú o sin alguna ficha: no afirma nada', () => {
    expect(planBranchSwitch(state, 'b2', { cards: null, details }).ready).toBe(false);
    expect(planBranchSwitch(state, 'b2', { cards, details: new Map() }).ready).toBe(false);
  });

  it('plan por línea: se mantiene, cambia de precio, agotado, no vendido, inexistente y extra viejo', () => {
    const plan = planBranchSwitch(state, 'b2', { cards, details });
    expect(plan.ready).toBe(true);
    const by = Object.fromEntries(plan.items.map((i, n) => [state.lines[n]?.productId, i]));
    expect(by['ok']).toMatchObject({ outcome: 'KEEP', status: 'OK' });
    expect(by['caro']).toMatchObject({
      outcome: 'KEEP_PRICE_CHANGED',
      beforeUnitCents: 4000,
      afterUnitCents: 4500,
    });
    expect(by['agotado']).toMatchObject({ outcome: 'REMOVE', status: 'UNAVAILABLE' });
    expect(by['nuevo-no-vendido']).toMatchObject({ outcome: 'REMOVE', status: 'INACTIVE' });
    expect(by['sin-ficha']).toMatchObject({ outcome: 'REMOVE', status: 'NOT_FOUND' });
    expect(by['extra-viejo']).toMatchObject({ outcome: 'REMOVE', status: 'OPTION_UNAVAILABLE' });
    expect(plan.keepCount).toBe(2);
    expect(plan.removeCount).toBe(4);
  });

  it('el plan NO modifica el carrito; confirmar conserva solo las válidas, recalcula lineId y deja el aviso de precio', () => {
    const snapshot = JSON.stringify(state);
    const plan = planBranchSwitch(state, 'b2', { cards, details });
    expect(JSON.stringify(state)).toBe(snapshot);
    const next = applyBranchSwitch(state, plan, NOW + 5);
    expect(next.branchId).toBe('b2');
    expect(next.lines.map((l) => l.productId)).toEqual(['ok', 'caro']);
    expect(next.lines[0]?.lineId).toBe(computeLineId('ok', 'b2', '', []));
    expect(next.lines[1]?.display).toMatchObject({
      unitCents: 4500,
      priceChange: { fromCents: 4000 },
    });
    expect(applyBranchSwitch(state, { ...plan, ready: false }, NOW)).toBe(state);
  });

  it('si no queda nada válido, el carrito queda vacío y sin sucursal (solo por confirmación)', () => {
    const none = planBranchSwitch(state, 'b2', { cards: new Map(), details });
    expect(applyBranchSwitch(state, none, NOW).branchId).toBeNull();
  });
});

describe('toQuoteInput (#32 #33)', () => {
  const state = must(EMPTY_CART, [
    cartInput('zeta', 1, 'a', {
      unitCents: 100,
      selections: [sel('g2', 'o2'), sel('g1', 'o1')],
      options: [opt('g2', 'o2', 5), opt('g1', 'o1', 7)],
    }),
    cartInput('zeta', 2, 'b', {
      selections: [sel('g1', 'o1'), sel('g2', 'o2')],
      options: [opt('g1', 'o1', 7), opt('g2', 'o2', 5)],
    }),
    cartInput('alfa', 3),
  ]);

  it('solo ids y cantidades, fusiona configuraciones iguales y ordena de forma determinista', () => {
    const q = toQuoteInput(state);
    const expected: CartQuoteInput = {
      branchId: 'sucursal-1',
      lines: [
        { productId: 'alfa', quantity: 3, selections: [] },
        {
          productId: 'zeta',
          quantity: 3,
          selections: [
            { groupId: 'g1', optionId: 'o1', quantity: 1 },
            { groupId: 'g2', optionId: 'o2', quantity: 1 },
          ],
        },
      ],
    };
    expect(q).toEqual(expected);
    const json = JSON.stringify(q);
    for (const leaked of [
      'Dumplings',
      'name',
      'price',
      'cents',
      'note',
      'imageUrl',
      'display',
      'slug',
    ]) {
      expect(json).not.toContain(leaked);
    }
    expect(toQuoteInput({ ...state, lines: [...state.lines].reverse() })).toEqual(expected);
  });

  it('null si está vacío, sin sucursal, de otra sucursal que la esperada o una configuración suma > 99', () => {
    expect(toQuoteInput(EMPTY_CART)).toBeNull();
    expect(toQuoteInput({ ...state, branchId: null })).toBeNull();
    expect(toQuoteInput(state, { expectedBranchId: 'sucursal-2' })).toBeNull();
    expect(toQuoteInput(state, { expectedBranchId: 'sucursal-1' })).not.toBeNull();
    const over = { ...state, lines: state.lines.map((l) => ({ ...l, quantity: 99 })) };
    expect(toQuoteInput(over)).toBeNull();
  });

  it('cumple el esquema del contrato (tipos generados y límites)', () => {
    const q = toQuoteInput(state) as CartQuoteInput;
    expect(Object.keys(q).sort()).toEqual(['branchId', 'lines']);
    for (const line of q.lines) {
      expect(Object.keys(line).sort()).toEqual(['productId', 'quantity', 'selections']);
      expect(line.quantity).toBeGreaterThanOrEqual(1);
      expect(line.quantity).toBeLessThanOrEqual(99);
      expect(line.selections.length).toBeLessThanOrEqual(30);
      for (const s of line.selections) {
        expect(Object.keys(s).sort()).toEqual(['groupId', 'optionId', 'quantity']);
        expect(s.quantity).toBe(1);
      }
    }
  });
});

describe('seguridad y saneado (S1, S4, S5)', () => {
  const good = must(EMPTY_CART, cartInput('dumplings', 1));

  it('S1: updatedAt en el futuro (> 5 min) es corrupto; dentro de la tolerancia, válido', () => {
    const doc = (updatedAt: number) => JSON.stringify({ ...good, updatedAt });
    expect(parseCartV2(doc(NOW + CART_FUTURE_SKEW_MS + 1), NOW)).toMatchObject({
      notice: 'corrupt',
      discard: true,
    });
    expect(parseCartV2(doc(NOW + CART_FUTURE_SKEW_MS), NOW).notice).toBeNull();
    expect(isCartExpired(good, NOW + CART_TTL_MS + 1)).toBe(true);
    expect(isCartExpired(good, NOW)).toBe(false);
    expect(isCartExpired(EMPTY_CART, NOW + CART_TTL_MS * 3)).toBe(false);
  });

  it('S4: los textos de presentación pierden controles, bidi e invisibles y se TRUNCAN (no rechazan el agregado)', () => {
    expect(cleanText('Roll\u202Egnp.exe\u200b\u0007  X')).toBe('Roll gnp.exe X');
    expect(cleanText('\ufeff\u200b')).toBe('');
    expect(Array.from(cleanText('😀'.repeat(500)))).toHaveLength(200);
    const long = cartInput('p', 1);
    long.display.name = 'N'.repeat(500);
    const r = addToCart(EMPTY_CART, [long], NOW);
    expect(r.ok && r.state.lines[0]?.display.name).toHaveLength(200);
    const dirty = cartInput('p', 1);
    dirty.display.name = '\u202E\u200b';
    const fallback = addToCart(EMPTY_CART, [dirty], NOW);
    expect(fallback.ok && fallback.state.lines[0]?.display.name).toBe('p');
    // también al leer un JSON editado a mano
    const doc = JSON.parse(serializeCart(good));
    doc.lines[0].display.name = 'Pizza\u202Eevil\u0000';
    expect(parseCartV2(JSON.stringify(doc), NOW).state.lines[0]?.display.name).toBe('Pizza evil');
  });

  it('S4: un importe NO canónico del servidor no cae al guardado: marca error de datos', () => {
    const line = lineWith(['o2']);
    const bad = group({
      options: [
        { id: 'o1', name: 'Ponzu', extraPrice: '0.00' },
        { id: 'o2', name: 'Anguila', extraPrice: '2,5' },
      ],
    });
    expect(evaluateLine(line, { card: card(), detail: { groups: [bad] } })).toMatchObject({
      dataError: true,
    });
    expect(evaluateLine(line, { card: card({ priceCents: null }), detail: null })).toMatchObject({
      dataError: true,
    });
    expect(
      evaluateLine(line, { card: card(), detail: { groups: [group()] } }).dataError,
    ).toBeUndefined();
  });

  it('S4: los nombres vigentes también se limpian al actualizar la presentación', () => {
    const line = lineWith();
    const r = evaluateLine(line, { card: card({ name: 'Nuevo\u202E nombre' }), detail: null });
    expect(r.patch?.name).toBe('Nuevo nombre');
  });

  it('S5: replaceLine es atómico, conserva posición y sucursal, y no fija otra sucursal', () => {
    const base = must(EMPTY_CART, [cartInput('a', 1), cartInput('b', 2), cartInput('c', 1)]);
    const target = base.lines[1] as CartLine;
    const edited = replaceLine(base, target.lineId, cartInput('b', 3, 'sin salsa'), NOW + 1);
    expect(edited.ok && edited.state.lines.map((l) => [l.productId, l.quantity])).toEqual([
      ['a', 1],
      ['b', 3],
      ['c', 1],
    ]);
    // otra sucursal NO se fija ni siquiera en la única línea
    const single = must(EMPTY_CART, cartInput('a', 1));
    expect(
      replaceLine(
        single,
        single.lines[0]!.lineId,
        cartInput('a', 1, '', { branchId: 'sucursal-9' }),
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'BRANCH_MISMATCH' });
    expect(replaceLine(single, 'no-existe', cartInput('a', 1), NOW)).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    // un rechazo deja el carrito como estaba (la función no muta)
    const over = replaceLine(base, target.lineId, cartInput('b', 99, '', {}), NOW);
    expect(over.ok).toBe(true);
    expect(base.lines).toHaveLength(3);
  });

  it('S5: si la edición coincide con otra línea se UNIFICA y lo informa (merged)', () => {
    const base = must(EMPTY_CART, [cartInput('a', 1), cartInput('a', 2, 'nota')]);
    const edited = replaceLine(base, base.lines[1]!.lineId, cartInput('a', 2), NOW + 1);
    expect(edited).toMatchObject({ ok: true, merged: true });
    expect(edited.ok && edited.state.lines.map((l) => l.quantity)).toEqual([3]);
  });
});
