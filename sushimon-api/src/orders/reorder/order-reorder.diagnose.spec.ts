import type { OfferGroup } from '../../modifiers/modifiers.types.js';
import type { OrderSourceLine } from '../order-source.repository.js';
import {
  diagnoseReorder,
  type ReorderCatalog,
  type ReorderOffer,
} from './order-reorder.diagnose.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P1 = id(1);
const P2 = id(2);
const G_SALSAS = id(101);
const G_EXTRAS = id(102);
const G_NUEVO = id(103);
const O_SOYA = id(201);
const O_PICANTE = id(202);
const O_VIEJA = id(203);
const O_QUESO = id(204);
const O_NUEVA = id(205);

const group = (
  gid: string,
  name: string,
  min: number,
  max: number,
  options: { id: string; name: string; price: string; active?: boolean }[],
  active = true,
): OfferGroup => ({
  id: gid,
  name,
  minSelect: min,
  maxSelect: max,
  active,
  options: options.map((o) => ({
    id: o.id,
    name: o.name,
    extraPrice: o.price,
    active: o.active ?? true,
  })),
});

const salsas = (over: Partial<OfferGroup> = {}) => ({
  ...group(G_SALSAS, 'Salsas', 1, 2, [
    { id: O_SOYA, name: 'Soya', price: '1.50' },
    { id: O_PICANTE, name: 'Picante', price: '0.10' },
    { id: O_VIEJA, name: 'Vieja', price: '9.00', active: false },
  ]),
  ...over,
});
const extras = () =>
  group(G_EXTRAS, 'Extras', 0, 1, [{ id: O_QUESO, name: 'Queso', price: '0.20' }]);

const line = (over: Partial<OrderSourceLine> = {}): OrderSourceLine => ({
  lineNo: 1,
  productId: P1,
  productName: 'Roll California',
  quantity: 2,
  unitPrice: '50.00',
  extrasPerUnit: '1.60',
  lineDiscount: '0.00',
  notes: null,
  modifiers: [
    { modifierId: O_SOYA, modifierName: 'Soya', unitExtraPrice: '1.50' },
    { modifierId: O_PICANTE, modifierName: 'Picante', unitExtraPrice: '0.10' },
  ],
  ...over,
});

const ok = (price: string): ReorderOffer => ({ state: 'OK', price });
const catalog = (over: Partial<ReorderCatalog> = {}): ReorderCatalog => ({
  branchActive: true,
  offers: new Map([[P1, ok('50.00')]]),
  groups: new Map([[P1, [salsas(), extras()]]]),
  presentation: new Map([
    [P1, { slug: 'roll-california', name: 'Roll California', imageUrl: 'https://cdn.x.io/1.jpg' }],
  ]),
  ...over,
});

const one = (l: OrderSourceLine, c: ReorderCatalog = catalog()) =>
  diagnoseReorder([l], c).lines[0]!;
const codes = (l: ReturnType<typeof one>) => l.issues.map((i) => i.code);

describe('diagnoseReorder (spec 024 §8.3-8.4, matriz #30-#44)', () => {
  it('#30 línea íntegra y vigente => AVAILABLE; candidate.line es EXACTAMENTE CartQuoteLineInput con selections ordenadas', () => {
    const r = one(line());
    expect(r.status).toBe('AVAILABLE');
    expect(r.issues).toEqual([]);
    expect(r.current).toEqual({ unitPrice: '50.00', extrasPerUnit: '1.60' });
    expect(Object.keys(r.candidate!.line).sort()).toEqual(['productId', 'quantity', 'selections']);
    expect(r.candidate!.line).toEqual({
      productId: P1,
      quantity: 2,
      selections: [
        { groupId: G_SALSAS, optionId: O_SOYA, quantity: 1 },
        { groupId: G_SALSAS, optionId: O_PICANTE, quantity: 1 },
      ],
    });
    expect(r.candidate).toMatchObject({
      slug: 'roll-california',
      note: null,
      display: { name: 'Roll California', imageUrl: 'https://cdn.x.io/1.jpg', unitPrice: '50.00' },
    });
    expect(r.candidate!.display.options.map((o) => o.optionName)).toEqual(['Soya', 'Picante']);
    expect(r.original).toMatchObject({
      productName: 'Roll California',
      quantity: 2,
      unitPrice: '50.00',
    });
  });

  it('#31 producto inexistente o product_id nulo => UNAVAILABLE + PRODUCT_REMOVED, candidate y current null', () => {
    for (const l of [line({ productId: null }), line({ productId: P2 })]) {
      const r = one(l, catalog({ offers: new Map([[P2, { state: 'UNKNOWN', price: null }]]) }));
      expect(r).toMatchObject({ status: 'UNAVAILABLE', current: null, candidate: null });
      expect(r.issues).toEqual([
        expect.objectContaining({ code: 'PRODUCT_REMOVED', severity: 'blocking' }),
      ]);
    }
  });

  it('#32 inactivo/categoría oculta => PRODUCT_INACTIVE; agotado => PRODUCT_OUT_OF_STOCK con current.unitPrice', () => {
    const hidden = one(
      line(),
      catalog({ offers: new Map([[P1, { state: 'HIDDEN', price: '50.00' }]]) }),
    );
    expect(hidden).toMatchObject({ status: 'UNAVAILABLE', candidate: null, current: null });
    expect(codes(hidden)).toEqual(['PRODUCT_INACTIVE']);
    const sold = one(
      line(),
      catalog({ offers: new Map([[P1, { state: 'SOLD_OUT', price: '55.00' }]]) }),
    );
    expect(sold).toMatchObject({ status: 'UNAVAILABLE', candidate: null });
    expect(sold.current).toEqual({ unitPrice: '55.00', extrasPerUnit: '1.60' });
    expect(sold.issues).toEqual([
      expect.objectContaining({ code: 'PRODUCT_OUT_OF_STOCK', severity: 'blocking' }),
    ]);
  });

  it('#33 opción retirada => OPTION_REMOVED + NEEDS_CONFIGURATION; NO está en selections y NO se sustituye', () => {
    const removed = id(999);
    const r = one(
      line({
        modifiers: [
          { modifierId: O_SOYA, modifierName: 'Soya', unitExtraPrice: '1.50' },
          { modifierId: removed, modifierName: 'Tampico', unitExtraPrice: '2.00' },
        ],
      }),
    );
    expect(r.status).toBe('NEEDS_CONFIGURATION');
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'OPTION_REMOVED',
        severity: 'warning',
        optionName: 'Tampico',
      }),
    ]);
    expect(r.candidate!.line.selections.map((s) => s.optionId)).toEqual([O_SOYA]);
    expect(JSON.stringify(r.candidate)).not.toContain('Tampico');
  });

  it('#33 modifier_id nulo en el snapshot => OPTION_REMOVED con el nombre del snapshot', () => {
    const r = one(
      line({
        modifiers: [
          { modifierId: O_SOYA, modifierName: 'Soya', unitExtraPrice: '1.50' },
          { modifierId: null, modifierName: 'Fantasma', unitExtraPrice: '1.00' },
        ],
      }),
    );
    expect(r.issues[0]).toMatchObject({
      code: 'OPTION_REMOVED',
      optionName: 'Fantasma',
      optionId: null,
    });
  });

  it('#34 opción inactiva => OPTION_INACTIVE; grupo inactivo => OPTION_INACTIVE y la línea necesita configuración', () => {
    const r = one(
      line({
        modifiers: [
          { modifierId: O_SOYA, modifierName: 'Soya', unitExtraPrice: '1.50' },
          { modifierId: O_VIEJA, modifierName: 'Vieja', unitExtraPrice: '9.00' },
        ],
      }),
    );
    expect(r.status).toBe('NEEDS_CONFIGURATION');
    expect(r.issues).toEqual([
      expect.objectContaining({ code: 'OPTION_INACTIVE', groupId: G_SALSAS, optionId: O_VIEJA }),
    ]);
    const inactiveGroup = one(
      line({ modifiers: [{ modifierId: O_SOYA, modifierName: 'Soya', unitExtraPrice: '1.50' }] }),
      catalog({ groups: new Map([[P1, [salsas({ active: false }), extras()]]]) }),
    );
    expect(inactiveGroup.status).toBe('NEEDS_CONFIGURATION');
    expect(codes(inactiveGroup)).toContain('OPTION_INACTIVE');
    expect(inactiveGroup.candidate!.line.selections).toEqual([]);
  });

  it('#35 grupo obligatorio NUEVO sin selección => REQUIRED_SELECTION_MISSING', () => {
    const nuevo = group(G_NUEVO, 'Tamaño', 1, 1, [{ id: O_NUEVA, name: 'Grande', price: '3.00' }]);
    const r = one(line(), catalog({ groups: new Map([[P1, [salsas(), extras(), nuevo]]]) }));
    expect(r.status).toBe('NEEDS_CONFIGURATION');
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'REQUIRED_SELECTION_MISSING',
        severity: 'warning',
        groupId: G_NUEVO,
        groupName: 'Tamaño',
      }),
    ]);
  });

  it('#35 opciones omitidas que dejan el grupo bajo el mínimo => OPTION_* y REQUIRED_SELECTION_MISSING', () => {
    const r = one(
      line({ modifiers: [{ modifierId: O_VIEJA, modifierName: 'Vieja', unitExtraPrice: '9.00' }] }),
    );
    expect(codes(r)).toEqual(['OPTION_INACTIVE', 'REQUIRED_SELECTION_MISSING']);
    expect(r.status).toBe('NEEDS_CONFIGURATION');
  });

  it('#36 máximo del grupo reducido => GROUP_RULE_CHANGED y la línea no es agregable', () => {
    const r = one(
      line(),
      catalog({ groups: new Map([[P1, [salsas({ maxSelect: 1 }), extras()]]]) }),
    );
    expect(r.status).toBe('NEEDS_CONFIGURATION');
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'GROUP_RULE_CHANGED',
        severity: 'warning',
        groupId: G_SALSAS,
      }),
    ]);
  });

  it('#37 cambio de precio base => PRICE_CHANGED con previous/current (con extras retenidos); la línea sigue AVAILABLE', () => {
    const r = one(line(), catalog({ offers: new Map([[P1, ok('55.00')]]) }));
    expect(r.status).toBe('AVAILABLE');
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'PRICE_CHANGED',
        severity: 'info',
        previousUnitPrice: '51.60',
        currentUnitPrice: '56.60',
      }),
    ]);
    expect(r.current).toEqual({ unitPrice: '55.00', extrasPerUnit: '1.60' });
  });

  it('#37 cambio de precio de un EXTRA => PRICE_CHANGED; precio igual => sin aviso', () => {
    const dearer = salsas({
      options: [
        { id: O_SOYA, name: 'Soya', extraPrice: '2.50', active: true },
        { id: O_PICANTE, name: 'Picante', extraPrice: '0.10', active: true },
      ],
    });
    const r = one(line(), catalog({ groups: new Map([[P1, [dearer, extras()]]]) }));
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'PRICE_CHANGED',
        previousUnitPrice: '51.60',
        currentUnitPrice: '52.60',
      }),
    ]);
    expect(one(line()).issues).toEqual([]);
  });

  it('#38 cantidad > 99 => QUANTITY_ADJUSTED (from/to) y cantidad 99; nota > 140 o con control => NOTE_DROPPED', () => {
    const q = one(line({ quantity: 150 }));
    expect(q.status).toBe('AVAILABLE');
    expect(q.issues).toEqual([
      expect.objectContaining({ code: 'QUANTITY_ADJUSTED', from: 150, to: 99, severity: 'info' }),
    ]);
    expect(q.candidate!.line.quantity).toBe(99);
    const long = one(line({ notes: 'x'.repeat(141) }));
    expect(long.issues).toEqual([
      expect.objectContaining({ code: 'NOTE_DROPPED', severity: 'info' }),
    ]);
    expect(long.candidate!.note).toBeNull();
    expect(long.status).toBe('AVAILABLE');
    expect(codes(one(line({ notes: 'ho\u0007la' })))).toEqual(['NOTE_DROPPED']);
    const fine = one(line({ notes: '  sin wasabi ' }));
    expect(fine.candidate!.note).toBe('sin wasabi');
    expect(fine.issues).toEqual([]);
  });

  it('#39 sucursal inactiva => todas UNAVAILABLE + BRANCH_UNAVAILABLE sin evaluar el catálogo', () => {
    const lines = [line({ lineNo: 1 }), line({ lineNo: 2, productId: P2 })];
    const { lines: out, summary } = diagnoseReorder(lines, {
      branchActive: false,
      offers: new Map(),
      groups: new Map(),
      presentation: new Map(),
    });
    for (const l of out) {
      expect(l).toMatchObject({ status: 'UNAVAILABLE', current: null, candidate: null });
      expect(l.issues).toEqual([
        expect.objectContaining({ code: 'BRANCH_UNAVAILABLE', severity: 'blocking' }),
      ]);
    }
    expect(summary).toMatchObject({
      available: 0,
      unavailable: 2,
      canAddAny: false,
      units: 0,
      estimatedSubtotal: '0.00',
    });
  });

  it('#41 summary: contadores, units y estimatedSubtotal en centavos solo de las AVAILABLE', () => {
    const lines = [
      line({ lineNo: 1, quantity: 2 }), // 51.60 * 2 = 103.20 con precio sin cambio (AVAILABLE)
      line({
        lineNo: 2,
        quantity: 1,
        modifiers: [{ modifierId: O_VIEJA, modifierName: 'Vieja', unitExtraPrice: '9.00' }],
      }), // NEEDS_CONFIGURATION
      line({ lineNo: 3, productId: P2 }), // UNAVAILABLE
      line({ lineNo: 4, quantity: 3, modifiers: [] }), // sin extras: grupo obligatorio => NEEDS_CONFIGURATION
    ];
    const c = catalog({
      offers: new Map([
        [P1, ok('50.00')],
        [P2, { state: 'UNKNOWN', price: null }],
      ]),
    });
    const { summary, lines: out } = diagnoseReorder(lines, c);
    expect(out.map((l) => l.status)).toEqual([
      'AVAILABLE',
      'NEEDS_CONFIGURATION',
      'UNAVAILABLE',
      'NEEDS_CONFIGURATION',
    ]);
    expect(summary).toEqual({
      lines: 4,
      available: 1,
      needsConfiguration: 2,
      unavailable: 1,
      priceChanged: 0,
      units: 2,
      estimatedSubtotal: '103.20',
      canAddAny: true,
    });
  });

  it('#41 sin líneas agregables => canAddAny=false; priceChanged cuenta líneas con el aviso', () => {
    const { summary } = diagnoseReorder(
      [line()],
      catalog({ offers: new Map([[P1, ok('60.00')]]) }),
    );
    expect(summary).toMatchObject({ priceChanged: 1, available: 1, estimatedSubtotal: '123.20' });
    expect(diagnoseReorder([], catalog()).summary).toEqual({
      lines: 0,
      available: 0,
      needsConfiguration: 0,
      unavailable: 0,
      priceChanged: 0,
      units: 0,
      estimatedSubtotal: '0.00',
      canAddAny: false,
    });
  });

  it('#44 duplicados históricos y varios grupos: diagnóstico determinista y estable entre ejecuciones', () => {
    const l = line({
      modifiers: [
        { modifierId: O_QUESO, modifierName: 'Queso', unitExtraPrice: '0.20' },
        { modifierId: O_SOYA, modifierName: 'Soya', unitExtraPrice: '1.50' },
        { modifierId: O_SOYA, modifierName: 'Soya', unitExtraPrice: '1.50' },
        { modifierId: id(998), modifierName: 'Zeta', unitExtraPrice: '1.00' },
        { modifierId: O_VIEJA, modifierName: 'Vieja', unitExtraPrice: '9.00' },
      ],
    });
    const a = one(l);
    const b = one(l);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.candidate!.line.selections).toEqual([
      { groupId: G_SALSAS, optionId: O_SOYA, quantity: 1 },
      { groupId: G_EXTRAS, optionId: O_QUESO, quantity: 1 },
    ]);
    expect(codes(a)).toEqual(['OPTION_REMOVED', 'OPTION_INACTIVE']);
  });

  it('#76 líneas idénticas no se fusionan (una por lineNo) y se ordenan por lineNo', () => {
    const out = diagnoseReorder([line({ lineNo: 2 }), line({ lineNo: 1 })], catalog()).lines;
    expect(out.map((l) => l.lineNo)).toEqual([1, 2]);
  });

  it('#29 no copia precios históricos como verdad: candidate solo trae ids, cantidad, nota y datos vigentes', () => {
    const r = one(line({ unitPrice: '1.00' }), catalog({ offers: new Map([[P1, ok('50.00')]]) }));
    expect(JSON.stringify(r.candidate)).not.toContain('"1.00"');
    expect(r.candidate!.display.unitPrice).toBe('50.00');
  });

  it('producto ordenable sin presentación (desapareció entre lecturas) => PRODUCT_REMOVED, nunca excepción', () => {
    const r = one(line(), catalog({ presentation: new Map() }));
    expect(r).toMatchObject({ status: 'UNAVAILABLE', candidate: null });
    expect(codes(r)).toEqual(['PRODUCT_REMOVED']);
  });
});
