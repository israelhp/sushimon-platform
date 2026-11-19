import { describe, expect, it } from 'vitest';
import {
  diagnoseLine,
  diagnoseReorder,
  type CatalogProductView,
  type CatalogView,
  type DiagGroup,
  type ReorderSourceLine,
} from './order-reorder';

/** F23 · tabla de casos del diagnóstico de «Volver a pedir» (spec 024 §8.3, matriz #30–#44), idéntica en la API y en el mock. */
const GROUP_EXTRAS: DiagGroup = {
  id: 'g-extras',
  name: 'Extras',
  minSelect: 0,
  maxSelect: 2,
  active: true,
  options: [
    { id: 'o-queso', name: 'Queso', extraPrice: '5.00', active: true },
    { id: 'o-aguacate', name: 'Aguacate', extraPrice: '4.00', active: true },
    { id: 'o-crunch', name: 'Crunch', extraPrice: '6.00', active: false },
  ],
};
const GROUP_SALSA: DiagGroup = {
  id: 'g-salsa',
  name: 'Salsa',
  minSelect: 1,
  maxSelect: 1,
  active: true,
  options: [{ id: 'o-ponzu', name: 'Ponzu', extraPrice: '0.00', active: true }],
};

function catalog(
  over: {
    branchActive?: boolean;
    products?: Record<string, Partial<CatalogProductView> | null>;
    groups?: Record<string, DiagGroup[]>;
  } = {},
): CatalogView {
  const products: Record<string, Partial<CatalogProductView> | null> = {
    roll: {},
    ...over.products,
  };
  return {
    branchActive: over.branchActive ?? true,
    product: (id) => {
      const p = products[id];
      if (p === undefined || p === null) return null;
      return {
        state: 'OK',
        slug: id,
        name: `Nombre ${id}`,
        imageUrl: null,
        unitCents: 4600,
        ...p,
      };
    },
    groups: (id) => over.groups?.[id] ?? [],
  };
}

const line = (over: Partial<ReorderSourceLine> = {}): ReorderSourceLine => ({
  lineNo: 1,
  productId: 'roll',
  productName: 'Roll',
  quantity: 1,
  unitCents: 4600,
  extrasPerUnitCents: 0,
  modifiers: [],
  notes: null,
  ...over,
});

const codes = (l: ReturnType<typeof diagnoseLine>) => l.issues.map((i) => i.code);

describe('F23 diagnóstico de reorden', () => {
  it('línea íntegra y vigente => AVAILABLE, sin avisos; la candidata es solo ids y selecciones', () => {
    const l = diagnoseLine(line(), catalog());
    expect(l).toMatchObject({ status: 'AVAILABLE', issues: [] });
    expect(l.candidate).toEqual({
      line: { productId: 'roll', quantity: 1, selections: [] },
      slug: 'roll',
      note: null,
      display: { name: 'Nombre roll', imageUrl: null, unitPrice: '46.00', options: [] },
    });
    expect(l.current).toEqual({ unitPrice: '46.00', extrasPerUnit: '0.00' });
  });

  it('producto inexistente o sin product_id => PRODUCT_REMOVED, sin candidata ni precio vigente', () => {
    for (const productId of ['ya-no-existe', null]) {
      const l = diagnoseLine(line({ productId }), catalog());
      expect(l).toMatchObject({ status: 'UNAVAILABLE', current: null, candidate: null });
      expect(codes(l)).toEqual(['PRODUCT_REMOVED']);
      expect(l.issues[0]?.severity).toBe('blocking');
    }
  });

  it('inactivo u oculto => PRODUCT_INACTIVE; agotado => PRODUCT_OUT_OF_STOCK con el precio vigente', () => {
    const hidden = diagnoseLine(line(), catalog({ products: { roll: { state: 'HIDDEN' } } }));
    expect(codes(hidden)).toEqual(['PRODUCT_INACTIVE']);
    expect(hidden.current).toBeNull();
    const sold = diagnoseLine(line(), catalog({ products: { roll: { state: 'SOLD_OUT' } } }));
    expect(sold).toMatchObject({ status: 'UNAVAILABLE', candidate: null });
    expect(codes(sold)).toEqual(['PRODUCT_OUT_OF_STOCK']);
    expect(sold.current).toEqual({ unitPrice: '46.00', extrasPerUnit: '0.00' });
  });

  it('sucursal inactiva => todas UNAVAILABLE con BRANCH_UNAVAILABLE, sin evaluar el catálogo', () => {
    const r = diagnoseReorder(
      [line(), line({ lineNo: 2, productId: 'otro' })],
      catalog({ branchActive: false }),
    );
    expect(r.lines.map(codes)).toEqual([['BRANCH_UNAVAILABLE'], ['BRANCH_UNAVAILABLE']]);
    expect(r.summary).toMatchObject({ unavailable: 2, available: 0, canAddAny: false });
  });

  it('opción retirada => OPTION_REMOVED + NEEDS_CONFIGURATION; NO se sustituye ni queda en selections', () => {
    const l = diagnoseLine(
      line({ modifiers: [{ modifierId: 'o-viejo', name: 'Anguila', extraCents: 300 }] }),
      catalog({ groups: { roll: [GROUP_EXTRAS] } }),
    );
    expect(l.status).toBe('NEEDS_CONFIGURATION');
    expect(l.issues).toEqual([
      { code: 'OPTION_REMOVED', severity: 'warning', optionName: 'Anguila' },
    ]);
    expect(l.candidate?.line.selections).toEqual([]);
  });

  it('opción o grupo inactivos => OPTION_INACTIVE + NEEDS_CONFIGURATION', () => {
    const byOption = diagnoseLine(
      line({ modifiers: [{ modifierId: 'o-crunch', name: 'Crunch', extraCents: 600 }] }),
      catalog({ groups: { roll: [GROUP_EXTRAS] } }),
    );
    expect(byOption).toMatchObject({ status: 'NEEDS_CONFIGURATION' });
    expect(codes(byOption)).toEqual(['OPTION_INACTIVE']);
    const byGroup = diagnoseLine(
      line({ modifiers: [{ modifierId: 'o-queso', name: 'Queso', extraCents: 500 }] }),
      catalog({ groups: { roll: [{ ...GROUP_EXTRAS, active: false }] } }),
    );
    expect(codes(byGroup)).toEqual(['OPTION_INACTIVE']);
  });

  it('grupo obligatorio NUEVO sin selección => REQUIRED_SELECTION_MISSING; opción omitida que deja el grupo bajo el mínimo => ambos códigos', () => {
    const fresh = diagnoseLine(line(), catalog({ groups: { roll: [GROUP_SALSA] } }));
    expect(fresh.status).toBe('NEEDS_CONFIGURATION');
    expect(fresh.issues).toEqual([
      {
        code: 'REQUIRED_SELECTION_MISSING',
        severity: 'warning',
        groupId: 'g-salsa',
        groupName: 'Salsa',
      },
    ]);
    const both = diagnoseLine(
      line({ modifiers: [{ modifierId: 'o-viejo', name: 'Anguila', extraCents: 0 }] }),
      catalog({ groups: { roll: [GROUP_SALSA] } }),
    );
    expect(codes(both)).toEqual(['OPTION_REMOVED', 'REQUIRED_SELECTION_MISSING']);
  });

  it('máximo del grupo reducido => GROUP_RULE_CHANGED y la línea no es agregable', () => {
    const l = diagnoseLine(
      line({
        modifiers: [
          { modifierId: 'o-queso', name: 'Queso', extraCents: 500 },
          { modifierId: 'o-aguacate', name: 'Aguacate', extraCents: 400 },
        ],
      }),
      catalog({ groups: { roll: [{ ...GROUP_EXTRAS, maxSelect: 1 }] } }),
    );
    expect(l.status).toBe('NEEDS_CONFIGURATION');
    expect(codes(l)).toEqual(['GROUP_RULE_CHANGED']);
  });

  it('cambio de precio base o de extra => PRICE_CHANGED (con extras retenidos), sigue AVAILABLE; precio igual => sin aviso', () => {
    const same = diagnoseLine(
      line({
        extrasPerUnitCents: 500,
        modifiers: [{ modifierId: 'o-queso', name: 'Queso', extraCents: 500 }],
      }),
      catalog({ groups: { roll: [GROUP_EXTRAS] } }),
    );
    expect(same.issues).toEqual([]);
    const base = diagnoseLine(line({ unitCents: 4200 }), catalog());
    expect(base.status).toBe('AVAILABLE');
    expect(base.issues).toEqual([
      {
        code: 'PRICE_CHANGED',
        severity: 'info',
        previousUnitPrice: '42.00',
        currentUnitPrice: '46.00',
      },
    ]);
    const extra = diagnoseLine(
      line({
        extrasPerUnitCents: 300,
        modifiers: [{ modifierId: 'o-queso', name: 'Queso', extraCents: 300 }],
      }),
      catalog({ groups: { roll: [GROUP_EXTRAS] } }),
    );
    expect(extra.issues[0]).toMatchObject({
      code: 'PRICE_CHANGED',
      previousUnitPrice: '49.00',
      currentUnitPrice: '51.00',
    });
    expect(extra.current).toEqual({ unitPrice: '46.00', extrasPerUnit: '5.00' });
  });

  it('cantidad > 99 => QUANTITY_ADJUSTED (from/to) y 99; nota > 140 o con control => NOTE_DROPPED', () => {
    const q = diagnoseLine(line({ quantity: 120 }), catalog());
    expect(q.issues).toEqual([{ code: 'QUANTITY_ADJUSTED', severity: 'info', from: 120, to: 99 }]);
    expect(q.candidate?.line.quantity).toBe(99);
    for (const notes of ['x'.repeat(141), 'a\u0007b']) {
      const n = diagnoseLine(line({ notes }), catalog());
      expect(codes(n)).toEqual(['NOTE_DROPPED']);
      expect(n.candidate?.note).toBeNull();
      expect(n.status).toBe('AVAILABLE');
    }
    expect(diagnoseLine(line({ notes: 'Sin ajonjolí' }), catalog()).candidate?.note).toBe(
      'Sin ajonjolí',
    );
  });

  it('summary: contadores, unidades y subtotal estimado en centavos SOLO de las AVAILABLE; sin agregables => canAddAny=false', () => {
    const r = diagnoseReorder(
      [
        line({ quantity: 2, unitCents: 4000 }),
        line({ lineNo: 2, productId: 'nada' }),
        line({ lineNo: 3, modifiers: [{ modifierId: 'o-viejo', name: 'X', extraCents: 100 }] }),
      ],
      catalog({ groups: { roll: [GROUP_EXTRAS] } }),
    );
    expect(r.summary).toEqual({
      lines: 3,
      available: 1,
      needsConfiguration: 1,
      unavailable: 1,
      priceChanged: 1,
      units: 2,
      estimatedSubtotal: '92.00',
      canAddAny: true,
    });
    expect(diagnoseReorder([line({ productId: 'nada' })], catalog()).summary.canAddAny).toBe(false);
  });

  it('líneas idénticas no se fusionan (una por lineNo) y el resultado es determinista', () => {
    const input = [line({ lineNo: 1 }), line({ lineNo: 2 })];
    const a = diagnoseReorder(input, catalog());
    expect(a.lines.map((l) => l.lineNo)).toEqual([1, 2]);
    expect(diagnoseReorder(input, catalog())).toEqual(a);
  });

  it('selecciones ordenadas por grupo y opción; duplicados históricos no se repiten', () => {
    const l = diagnoseLine(
      line({
        modifiers: [
          { modifierId: 'o-queso', name: 'Queso', extraCents: 500 },
          { modifierId: 'o-aguacate', name: 'Aguacate', extraCents: 400 },
          { modifierId: 'o-queso', name: 'Queso', extraCents: 500 },
        ],
        extrasPerUnitCents: 900,
      }),
      catalog({ groups: { roll: [GROUP_EXTRAS] } }),
    );
    expect(l.status).toBe('AVAILABLE');
    expect(l.candidate?.line.selections.map((s) => s.optionId)).toEqual(['o-aguacate', 'o-queso']);
  });
});
