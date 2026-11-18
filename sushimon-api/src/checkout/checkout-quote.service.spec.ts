import { Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import {
  A,
  ADDR_MISSING,
  ADDR_OTHER,
  ADDR_OWN,
  B,
  checkoutHarness,
  coverageResult,
  groupRow,
  HIDDEN,
  INACTIVE,
  local,
  MISSING_PRODUCT,
  MUNI_GUATEMALA,
  MUNI_MISSING,
  MUNI_MIXCO,
  mid,
  NOW,
  optionRow,
  ownZone,
  P1,
  P2,
  P3,
  principal,
} from '../../test/support/checkout-harness.js';
import type { FakeProduct } from '../../test/support/fake-branch-products-repo.js';
import { DbGate } from '../common/concurrency/db-gate.js';
import { checkoutBusy } from './checkout-errors.js';
import { verifyQuoteToken } from './quote-token.js';

const SECRET = 's'.repeat(40);
type H = ReturnType<typeof checkoutHarness>;
const codeOf = (e: unknown) =>
  (((e as { getResponse?: () => unknown }).getResponse?.() ?? {}) as { code?: string }).code;
const statusOf = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();

/** Un grupo OBLIGATORIO de extras (mín. 1, máx. 2) con dos opciones activas en el producto indicado. */
function seedExtras(h: H, productId: string, over: { min?: number; max?: number } = {}) {
  const g = mid(1);
  h.modifiersRepo.seedGroup(groupRow(g, { minSelect: over.min ?? 1, maxSelect: over.max ?? 2 }), [
    optionRow(mid(11), g, { extraPrice: '5.00', sortOrder: 0 }),
    optionRow(mid(12), g, { extraPrice: '2.50', sortOrder: 1 }),
    optionRow(mid(13), g, { extraPrice: '1.00', sortOrder: 2, active: false }),
  ]);
  h.modifiersRepo.seedProduct(productId, [g]);
  return { group: g, o1: mid(11), o2: mid(12), inactive: mid(13) };
}

describe('CheckoutQuoteService (F19)', () => {
  let h: H;
  beforeAll(() => {
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  beforeEach(() => {
    h = checkoutHarness({ secret: SECRET });
  });

  describe('fila 1: totales exactos', () => {
    it('carrito válido de PICKUP: importes en cadenas, sin tarifa y sin llamar a cobertura (fila 6)', async () => {
      const q = await h.service.quote(undefined, h.body());
      expect(q).toMatchObject({
        currency: 'GTQ',
        subtotal: '170.00',
        extrasTotal: '0.00',
        discountTotal: '0.00',
        deliveryFee: '0.00',
        total: '170.00',
        canProceed: true,
        blockers: [],
        coupon: null,
        fulfillment: { type: 'PICKUP', delivery: null },
      });
      expect(q.lines[0]).toMatchObject({
        index: 0,
        status: 'OK',
        unitPrice: '85.00',
        lineSubtotal: '170.00',
        lineTotal: '170.00',
        discount: '0.00',
        promotionId: null,
      });
      expect(h.coverage.check).not.toHaveBeenCalled();
      expect(h.locations.findMunicipality).not.toHaveBeenCalled();
    });

    it('expiresAt = emisión + 10 min; generatedAt viene del reloj del servidor', async () => {
      const q = await h.service.quote(undefined, h.body());
      expect(q.quote.generatedAt).toBe(h.clock.now().toISOString());
      expect(new Date(q.quote.expiresAt).getTime() - new Date(q.quote.generatedAt).getTime()).toBe(
        600_000,
      );
    });

    it('varias líneas: total = Σ líneas − descuento + envío (invariante)', async () => {
      const q = await h.service.quote(
        undefined,
        h.body({
          cart: {
            branchId: A,
            lines: [
              { productId: P1, quantity: 3, selections: [] },
              { productId: P2, quantity: 1, selections: [] },
              { productId: P3, quantity: 7, selections: [] },
            ],
          },
        }),
      );
      const sum = q.lines.reduce((acc, l) => acc + Number(l.lineTotal?.replace('.', '')), 0);
      expect(q.total).toBe(`${Math.floor(sum / 100)}.${String(sum % 100).padStart(2, '0')}`);
      expect(q.total).toBe('460.00'); // 255 + 30 + 175
    });
  });

  describe('fila 2 y 4: estado de línea y precio por sucursal', () => {
    it.each([
      ['inexistente', MISSING_PRODUCT, 'NOT_FOUND'],
      ['categoría oculta', HIDDEN, 'INACTIVE'],
    ])('%s => %s y total null', async (_name, productId, status) => {
      const q = await h.service.quote(
        undefined,
        h.body({
          cart: {
            branchId: A,
            lines: [
              { productId: P1, quantity: 1, selections: [] },
              { productId, quantity: 1, selections: [] },
            ],
          },
        }),
      );
      expect(q.lines[1]).toMatchObject({
        status,
        unitPrice: null,
        lineSubtotal: null,
        lineTotal: null,
        modifiers: [],
      });
      expect(q.total).toBeNull();
      expect(q.canProceed).toBe(false);
      expect(q.blockers).toEqual([{ code: status, scope: 'LINE', lineIndex: 1 }]);
      // La línea comprable sigue visible y los totales agregados solo suman las comprables.
      expect(q.subtotal).toBe('85.00');
    });

    it('producto inactivo => INACTIVE; agotado en la sucursal => UNAVAILABLE', async () => {
      h.world.seedProduct({ ...(h.world.products.get(P2) as FakeProduct), active: false });
      h.world.seedRow(A, P3, { available: false });
      const q = await h.service.quote(
        undefined,
        h.body({
          cart: {
            branchId: A,
            lines: [
              { productId: P2, quantity: 1, selections: [] },
              { productId: P3, quantity: 1, selections: [] },
            ],
          },
        }),
      );
      expect(q.lines.map((l) => l.status)).toEqual(['INACTIVE', 'UNAVAILABLE']);
      expect(q.total).toBeNull();
    });

    it('precedencia: INACTIVE gana a UNAVAILABLE y a las violaciones de extras', async () => {
      h.world.seedProduct({ ...(h.world.products.get(P2) as FakeProduct), active: false });
      h.world.seedRow(A, P2, { available: false });
      seedExtras(h, P2);
      const q = await h.service.quote(
        undefined,
        h.body({
          cart: { branchId: A, lines: [{ productId: P2, quantity: 1, selections: [] }] },
        }),
      );
      expect(q.lines[0]?.status).toBe('INACTIVE');
    });

    it('precio por sucursal: usa el override de la sucursal, nunca basePrice; agotado es por sucursal', async () => {
      h.world.seedRow(A, P1, { priceOverride: '90.00' });
      h.world.seedRow(B, P1, { available: false });
      const a = await h.service.quote(undefined, h.body());
      expect(a.lines[0]).toMatchObject({ unitPrice: '90.00', status: 'OK' });
      expect(a.total).toBe('180.00');
      const b = await h.service.quote(
        undefined,
        h.body({ cart: { branchId: B, lines: [{ productId: P1, quantity: 1, selections: [] }] } }),
      );
      expect(b.lines[0]?.status).toBe('UNAVAILABLE');
    });
  });

  describe('fila 3: extras', () => {
    it('válidos: suman por unidad y se multiplican por la cantidad', async () => {
      const x = seedExtras(h, P1);
      const q = await h.service.quote(
        undefined,
        h.body({
          cart: {
            branchId: A,
            lines: [
              {
                productId: P1,
                quantity: 2,
                selections: [
                  { groupId: x.group, optionId: x.o1, quantity: 1 },
                  { groupId: x.group, optionId: x.o2, quantity: 1 },
                ],
              },
            ],
          },
        }),
      );
      expect(q.lines[0]).toMatchObject({
        status: 'OK',
        unitPrice: '85.00',
        extrasPerUnit: '7.50',
        lineSubtotal: '185.00', // (85 + 7.50) × 2
      });
      expect(q.lines[0]?.modifiers).toEqual([
        { groupId: x.group, optionId: x.o1, extraPrice: '5.00' },
        { groupId: x.group, optionId: x.o2, extraPrice: '2.50' },
      ]);
      expect(q.extrasTotal).toBe('15.00');
      expect(q.subtotal).toBe('185.00');
      expect(q.total).toBe('185.00');
    });

    it('obligatorio ausente => MODIFIER_INVALID', async () => {
      seedExtras(h, P1);
      const q = await h.service.quote(undefined, h.body());
      expect(q.lines[0]?.status).toBe('MODIFIER_INVALID');
      expect(q.blockers).toEqual([{ code: 'MODIFIER_INVALID', scope: 'LINE', lineIndex: 0 }]);
    });

    it('máximo superado, duplicado y grupo ajeno => MODIFIER_INVALID', async () => {
      const x = seedExtras(h, P1, { min: 1, max: 1 });
      const lineWith = (selections: { groupId: string; optionId: string; quantity: number }[]) =>
        h.service.quote(
          undefined,
          h.body({ cart: { branchId: A, lines: [{ productId: P1, quantity: 1, selections }] } }),
        );
      const tooMany = await lineWith([
        { groupId: x.group, optionId: x.o1, quantity: 1 },
        { groupId: x.group, optionId: x.o2, quantity: 1 },
      ]);
      expect(tooMany.lines[0]?.status).toBe('MODIFIER_INVALID');
      const duplicated = await lineWith([
        { groupId: x.group, optionId: x.o1, quantity: 1 },
        { groupId: x.group, optionId: x.o1, quantity: 1 },
      ]);
      expect(duplicated.lines[0]?.status).toBe('MODIFIER_INVALID');
      const foreign = await lineWith([{ groupId: mid(99), optionId: x.o1, quantity: 1 }]);
      expect(foreign.lines[0]?.status).toBe('MODIFIER_INVALID');
    });

    it('opción inactiva u opción que no es del grupo => OPTION_UNAVAILABLE', async () => {
      const x = seedExtras(h, P1);
      const q1 = await h.service.quote(
        undefined,
        h.body({
          cart: {
            branchId: A,
            lines: [
              {
                productId: P1,
                quantity: 1,
                selections: [{ groupId: x.group, optionId: x.inactive, quantity: 1 }],
              },
            ],
          },
        }),
      );
      expect(q1.lines[0]?.status).toBe('OPTION_UNAVAILABLE');
      const q2 = await h.service.quote(
        undefined,
        h.body({
          cart: {
            branchId: A,
            lines: [
              {
                productId: P1,
                quantity: 1,
                selections: [{ groupId: x.group, optionId: mid(77), quantity: 1 }],
              },
            ],
          },
        }),
      );
      expect(q2.lines[0]?.status).toBe('OPTION_UNAVAILABLE');
      expect(q2.blockers).toEqual([{ code: 'OPTION_UNAVAILABLE', scope: 'LINE', lineIndex: 0 }]);
    });

    it('más de 10 grupos en una línea => MODIFIER_INVALID (no 5xx)', async () => {
      const selections = Array.from({ length: 11 }, (_, i) => ({
        groupId: mid(200 + i),
        optionId: mid(300 + i),
        quantity: 1,
      }));
      const q = await h.service.quote(
        undefined,
        h.body({ cart: { branchId: A, lines: [{ productId: P1, quantity: 1, selections }] } }),
      );
      expect(q.lines[0]?.status).toBe('MODIFIER_INVALID');
    });
  });

  describe('fila 5: sucursal', () => {
    it('inexistente o inactiva => 422 BRANCH_NOT_AVAILABLE idéntico', async () => {
      const missing = await h.service
        .quote(undefined, h.body({ cart: { branchId: mid(555), lines: h.body().cart.lines } }))
        .catch((e: unknown) => e);
      const inactive = await h.service
        .quote(undefined, h.body({ cart: { branchId: INACTIVE, lines: h.body().cart.lines } }))
        .catch((e: unknown) => e);
      for (const e of [missing, inactive]) {
        expect(statusOf(e)).toBe(422);
        expect(codeOf(e)).toBe('BRANCH_NOT_AVAILABLE');
      }
      expect((missing as { getResponse(): unknown }).getResponse()).toEqual(
        (inactive as { getResponse(): unknown }).getResponse(),
      );
    });

    it('cerrada => blocker BRANCH_CLOSED, total visible, sin token', async () => {
      h.state.accepted = false;
      h.state.reason = 'OUTSIDE_BUSINESS_HOURS';
      h.state.nextOpensAt = new Date('2026-11-17T14:00:00Z');
      const q = await h.service.quote(undefined, h.body());
      expect(q.branch).toEqual({
        id: A,
        isAcceptingOrders: false,
        reason: 'OUTSIDE_BUSINESS_HOURS',
        nextOpensAt: '2026-11-17T14:00:00.000Z',
      });
      expect(q.total).toBe('170.00');
      expect(q.canProceed).toBe(false);
      expect(q.blockers).toEqual([{ code: 'BRANCH_CLOSED', scope: 'BRANCH' }]);
      expect(q.quote.token).toBeNull();
    });
  });

  describe('filas 7 y 8: dirección', () => {
    const delivery = (extra: Record<string, unknown>) =>
      h.body({ fulfillment: { type: 'DELIVERY', ...extra } as never });

    it('sin sesión y customerAddressId => 401 sin tocar la BD', async () => {
      const e = await h.service
        .quote(undefined, delivery({ customerAddressId: ADDR_OWN }))
        .catch((x: unknown) => x);
      expect(e).toBeInstanceOf(UnauthorizedException);
      expect(h.availability.canAcceptOrderNow).not.toHaveBeenCalled();
    });

    it('dirección propia: cobertura con su municipio y zona', async () => {
      h.cover.result = coverageResult({ own: ownZone('15.00') });
      const q = await h.service.quote(
        principal('user-1'),
        delivery({ customerAddressId: ADDR_OWN }),
      );
      expect(h.addresses.get).toHaveBeenCalledWith(
        expect.objectContaining({ authUserId: 'user-1' }),
        ADDR_OWN,
      );
      expect(h.coverage.check).toHaveBeenCalledWith({
        branchId: A,
        municipalityId: MUNI_GUATEMALA,
        zone: 'Zona 10',
      });
      expect(q.fulfillment.delivery?.selectedProvider).toBe('OWN');
      expect(q.deliveryFee).toBe('15.00');
      expect(q.total).toBe('185.00');
    });

    it('ajena e inexistente => el MISMO 404; nunca se toca cobertura', async () => {
      const other = await h.service
        .quote(principal('user-1'), delivery({ customerAddressId: ADDR_OTHER }))
        .catch((e: unknown) => e);
      const missing = await h.service
        .quote(principal('user-1'), delivery({ customerAddressId: ADDR_MISSING }))
        .catch((e: unknown) => e);
      expect(other).toBeInstanceOf(NotFoundException);
      expect(missing).toBeInstanceOf(NotFoundException);
      expect((other as NotFoundException).getResponse()).toEqual(
        (missing as NotFoundException).getResponse(),
      );
      expect(h.coverage.check).not.toHaveBeenCalled();
    });

    it('invitado con municipio y zona: usa el municipio del cuerpo', async () => {
      h.cover.result = coverageResult({ own: ownZone('20.00') });
      const q = await h.service.quote(
        undefined,
        delivery({ municipalityId: MUNI_GUATEMALA, zone: '  zona   10 ' }),
      );
      expect(h.coverage.check).toHaveBeenCalledWith({
        branchId: A,
        municipalityId: MUNI_GUATEMALA,
        zone: 'Zona 10',
      });
      expect(q.deliveryFee).toBe('20.00');
    });

    it('ciudad de Guatemala sin zona (o con zona inválida) => ADDRESS_INCOMPLETE, sin cobertura y total null', async () => {
      for (const zone of [undefined, null, 'Centro', 'Zona 99']) {
        h.coverage.check.mockClear();
        const q = await h.service.quote(
          undefined,
          delivery({ municipalityId: MUNI_GUATEMALA, ...(zone === undefined ? {} : { zone }) }),
        );
        expect(q.blockers).toEqual([{ code: 'ADDRESS_INCOMPLETE', scope: 'FULFILLMENT' }]);
        expect(q.total).toBeNull();
        expect(q.deliveryFee).toBeNull();
        expect(q.fulfillment.delivery).toEqual({ selectedProvider: null, options: [] });
        expect(h.coverage.check).not.toHaveBeenCalled();
      }
    });

    it('dirección guardada antigua sin zona en la ciudad de Guatemala => ADDRESS_INCOMPLETE', async () => {
      h.addressesState.dto = h.addressRow(null);
      const q = await h.service.quote(
        principal('user-1'),
        delivery({ customerAddressId: ADDR_OWN }),
      );
      expect(q.blockers).toEqual([{ code: 'ADDRESS_INCOMPLETE', scope: 'FULFILLMENT' }]);
    });

    it('otro municipio: la zona es opcional', async () => {
      h.cover.result = coverageResult({ own: ownZone('25.00') });
      const q = await h.service.quote(undefined, delivery({ municipalityId: MUNI_MIXCO }));
      expect(h.coverage.check).toHaveBeenCalledWith({
        branchId: A,
        municipalityId: MUNI_MIXCO,
        zone: null,
      });
      expect(q.deliveryFee).toBe('25.00');
    });

    it('municipio inexistente => 422 MUNICIPALITY_NOT_FOUND', async () => {
      const e = await h.service
        .quote(undefined, delivery({ municipalityId: MUNI_MISSING }))
        .catch((x: unknown) => x);
      expect(statusOf(e)).toBe(422);
      expect(codeOf(e)).toBe('MUNICIPALITY_NOT_FOUND');
    });

    it('prioridad: sucursal inexistente gana a dirección ajena (error determinista)', async () => {
      const e = await h.service
        .quote(
          principal('user-1'),
          h.body({
            cart: { branchId: mid(555), lines: h.body().cart.lines },
            fulfillment: { type: 'DELIVERY', customerAddressId: ADDR_OTHER },
          }),
        )
        .catch((x: unknown) => x);
      expect(codeOf(e)).toBe('BRANCH_NOT_AVAILABLE');
    });
  });

  describe('filas 9 a 11: entrega', () => {
    const delivery = (extra: Record<string, unknown> = {}) =>
      h.body({
        fulfillment: { type: 'DELIVERY', municipalityId: MUNI_MIXCO, ...extra } as never,
      });

    it('flag OWN apagado (defecto) y PedidosYa UNKNOWN => DELIVERY_UNVERIFIED, total null', async () => {
      const q = await h.service.quote(undefined, delivery());
      expect(q.blockers).toEqual([{ code: 'DELIVERY_UNVERIFIED', scope: 'FULFILLMENT' }]);
      expect(q.total).toBeNull();
      expect(q.deliveryFee).toBeNull();
      const [py, own] = q.fulfillment.delivery?.options ?? [];
      expect(py).toMatchObject({
        provider: 'PEDIDOSYA',
        coverageStatus: 'UNKNOWN',
        integrationStatus: 'BLOCKED_EXTERNAL',
        simulated: false,
        customerFee: null,
        selectable: false,
      });
      expect(own).toMatchObject({
        provider: 'OWN',
        enabled: false,
        coverageStatus: 'UNAVAILABLE',
        selectable: false,
        unavailableReason: 'PROVIDER_DISABLED',
        customerFee: null,
      });
      expect(q.quote.token).toBeNull();
    });

    it('OWN con zona: tarifa exacta de la zona y selectedProvider OWN; PedidosYa no seleccionable', async () => {
      h.cover.result = coverageResult({ own: ownZone('17.50') });
      const q = await h.service.quote(undefined, delivery());
      expect(q.fulfillment.delivery?.selectedProvider).toBe('OWN');
      expect(q.deliveryFee).toBe('17.50');
      expect(q.total).toBe('187.50');
      expect(q.canProceed).toBe(true);
      expect(q.fulfillment.delivery?.options.find((o) => o.provider === 'PEDIDOSYA')).toMatchObject(
        {
          selectable: false,
          customerFee: null,
        },
      );
    });

    it('OWN encendido sin zona y PedidosYa UNKNOWN => DELIVERY_UNVERIFIED', async () => {
      h.cover.result = coverageResult({
        own: { enabled: true, coverageStatus: 'UNAVAILABLE', reason: 'NO_ZONE_COVERAGE' },
      });
      const q = await h.service.quote(undefined, delivery());
      expect(q.blockers).toEqual([{ code: 'DELIVERY_UNVERIFIED', scope: 'FULFILLMENT' }]);
      expect(q.fulfillment.delivery?.options.find((o) => o.provider === 'OWN')).toMatchObject({
        coverageStatus: 'UNAVAILABLE',
        selectable: false,
        unavailableReason: 'NO_ZONE_COVERAGE',
      });
    });

    it('pedidosyaEnabled=false y OWN sin zona => DELIVERY_UNAVAILABLE', async () => {
      h.cover.result = coverageResult({
        own: { enabled: true, coverageStatus: 'UNAVAILABLE', reason: 'NO_ZONE_COVERAGE' },
        pedidosya: { enabled: false, reason: 'PROVIDER_DISABLED' },
      });
      const q = await h.service.quote(undefined, delivery());
      expect(q.blockers).toEqual([{ code: 'DELIVERY_UNAVAILABLE', scope: 'FULFILLMENT' }]);
    });

    it('PedidosYa mock AVAILABLE: simulated, no seleccionable, sin tarifa y NO habilita el pedido', async () => {
      h.cover.result = coverageResult({
        pedidosya: {
          coverageStatus: 'AVAILABLE',
          integrationStatus: 'MOCK',
          reason: undefined,
        },
      });
      const q = await h.service.quote(undefined, delivery());
      expect(q.fulfillment.delivery?.options.find((o) => o.provider === 'PEDIDOSYA')).toMatchObject(
        {
          coverageStatus: 'AVAILABLE',
          simulated: true,
          selectable: false,
          customerFee: null,
          unavailableReason: 'SIMULATED',
        },
      );
      expect(q.fulfillment.delivery?.selectedProvider).toBeNull();
      expect(q.canProceed).toBe(false);
      expect(q.total).toBeNull();
      expect(q.quote.token).toBeNull();
    });

    it.each([
      ['AVAILABLE', undefined],
      ['UNAVAILABLE', undefined],
      ['UNKNOWN', 'PROVIDER_TIMEOUT'],
      ['UNKNOWN', 'PROVIDER_ERROR'],
    ] as const)(
      'escenario mock %s/%s: jamás seleccionable ni con tarifa',
      async (status, reason) => {
        h.cover.result = coverageResult({
          pedidosya: {
            coverageStatus: status,
            integrationStatus: 'MOCK',
            ...(reason ? { reason } : { reason: undefined }),
          },
        });
        const q = await h.service.quote(undefined, delivery());
        const py = q.fulfillment.delivery?.options.find((o) => o.provider === 'PEDIDOSYA');
        expect(py?.selectable).toBe(false);
        expect(py?.customerFee).toBeNull();
        expect(q.fulfillment.delivery?.selectedProvider).toBeNull();
        expect(q.total).toBeNull();
      },
    );

    it('PedidosYa LIVE AVAILABLE tampoco es seleccionable (tarifa al cliente sin política, P40)', async () => {
      h.cover.result = coverageResult({
        pedidosya: { coverageStatus: 'AVAILABLE', integrationStatus: 'LIVE', reason: undefined },
      });
      const q = await h.service.quote(undefined, delivery());
      const py = q.fulfillment.delivery?.options.find((o) => o.provider === 'PEDIDOSYA');
      expect(py).toMatchObject({ selectable: false, unavailableReason: 'CUSTOMER_FEE_UNDEFINED' });
      expect(q.canProceed).toBe(false);
    });

    it('deliveryProvider=PEDIDOSYA => DELIVERY_PROVIDER_NOT_SELECTABLE sin cambiar a OWN aunque OWN sirva', async () => {
      h.cover.result = coverageResult({ own: ownZone('15.00') });
      const q = await h.service.quote(undefined, delivery({ deliveryProvider: 'PEDIDOSYA' }));
      expect(q.blockers).toEqual([
        { code: 'DELIVERY_PROVIDER_NOT_SELECTABLE', scope: 'FULFILLMENT' },
      ]);
      expect(q.fulfillment.delivery?.selectedProvider).toBeNull();
      expect(q.deliveryFee).toBeNull();
      expect(q.total).toBeNull();
    });

    it('deliveryProvider=OWN seleccionable => OWN; OWN no seleccionable => NOT_SELECTABLE', async () => {
      h.cover.result = coverageResult({ own: ownZone('15.00') });
      const ok = await h.service.quote(undefined, delivery({ deliveryProvider: 'OWN' }));
      expect(ok.canProceed).toBe(true);
      h.cover.result = coverageResult();
      const no = await h.service.quote(undefined, delivery({ deliveryProvider: 'OWN' }));
      expect(no.blockers).toEqual([
        { code: 'DELIVERY_PROVIDER_NOT_SELECTABLE', scope: 'FULFILLMENT' },
      ]);
    });

    it('fila 11: ninguna propiedad de costo del proveedor en la respuesta', async () => {
      h.cover.result = coverageResult({ own: ownZone('15.00') });
      const q = await h.service.quote(undefined, delivery());
      expect(JSON.stringify(q).toLowerCase()).not.toContain('cost');
    });

    it('un error de cobertura de dominio (422) se propaga tal cual', async () => {
      h.cover.fail = new NotFoundException('x');
      await expect(h.service.quote(undefined, delivery())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('filas 12 a 15: descuentos', () => {
    it('PERCENT con redondeo medio hacia arriba (12.5% de 0.01 x 4 no se pierde ni sobra)', async () => {
      h.world.seedRow(A, P2, { priceOverride: '0.99' });
      h.repo.seed({ kind: 'PERCENT', value: '50.00' });
      const q = await h.service.quote(
        undefined,
        h.body({ cart: { branchId: A, lines: [{ productId: P2, quantity: 1, selections: [] }] } }),
      );
      expect(q.lines[0]?.discount).toBe('0.50'); // 49.5 -> 50
      expect(q.total).toBe('0.49');
    });

    it('FIXED_AMOUNT por unidad con tope en la base', async () => {
      h.repo.seed({ kind: 'FIXED_AMOUNT', value: '100.00' });
      const q = await h.service.quote(undefined, h.body());
      expect(q.lines[0]).toMatchObject({ discount: '170.00', lineTotal: '0.00' }); // tope: base de la línea
      expect(q.total).toBe('0.00');
      const fixed = checkoutHarness();
      fixed.repo.seed({ kind: 'FIXED_AMOUNT', value: '10.00' });
      const q2 = await fixed.service.quote(undefined, fixed.body());
      expect(q2.lines[0]?.discount).toBe('20.00'); // 10.00 × 2
    });

    it('los extras NO se descuentan', async () => {
      const x = seedExtras(h, P1);
      h.repo.seed({ kind: 'PERCENT', value: '10.00' });
      const q = await h.service.quote(
        undefined,
        h.body({
          cart: {
            branchId: A,
            lines: [
              {
                productId: P1,
                quantity: 2,
                selections: [{ groupId: x.group, optionId: x.o1, quantity: 1 }],
              },
            ],
          },
        }),
      );
      expect(q.lines[0]).toMatchObject({
        lineSubtotal: '180.00', // (85 + 5) × 2
        discount: '17.00', // 10 % de 170 (sin extras)
        lineTotal: '163.00',
      });
      expect(q.discountTotal).toBe('17.00');
      expect(q.subtotal).toBe('180.00');
      expect(q.total).toBe('163.00');
    });

    it('fila 13: happy hour vigente / fuera de horario / vencido, con reloj inyectado', async () => {
      h.repo.seed({
        kind: 'PERCENT',
        value: '20.00',
        schedule: [{ weekday: 1, startsAt: '15:00', endsAt: '18:00' }],
      });
      const live = await h.service.quote(undefined, h.body());
      expect(live.lines[0]?.discount).toBe('34.00');
      h.clock.current = local('2026-11-16T19:00:00'); // lunes, fuera del tramo
      const outside = await h.service.quote(undefined, h.body());
      expect(outside.lines[0]?.discount).toBe('0.00');
      h.clock.current = local('2026-11-17T16:00:00'); // martes
      expect((await h.service.quote(undefined, h.body())).discountTotal).toBe('0.00');
      h.clock.current = local('2026-11-16T16:00:00');
      h.repo.seed({ kind: 'PERCENT', value: '50.00', endsAt: local('2026-11-16T15:00:00') });
      expect((await h.service.quote(undefined, h.body())).lines[0]?.discount).toBe('34.00');
    });

    it('fila 14: cupón válido APPLIED; inválido/vencido/de otra sucursal => el mismo NOT_APPLIED sin motivo', async () => {
      h.repo.seed({ code: 'SUSHI10', kind: 'PERCENT', value: '10.00' });
      h.repo.seed({ code: 'OTRA', kind: 'PERCENT', value: '10.00', branchIds: [B] });
      h.repo.seed({
        code: 'VENCIDO',
        kind: 'PERCENT',
        value: '10.00',
        endsAt: local('2026-11-01T00:00:00'),
      });
      h.repo.seed({ code: 'APAGADO', kind: 'PERCENT', value: '10.00', active: false });
      const applied = await h.service.quote(undefined, h.body({ couponCode: ' sushi10 ' }));
      expect(applied.coupon).toEqual({ status: 'APPLIED' });
      expect(applied.discountTotal).toBe('17.00');
      const responses = [];
      for (const code of ['NOEXISTE', 'OTRA', 'VENCIDO', 'APAGADO', '!!formato inválido!!']) {
        const q = await h.service.quote(undefined, h.body({ couponCode: code }));
        responses.push(JSON.stringify({ ...q, quote: null }));
        expect(q.coupon).toEqual({ status: 'NOT_APPLIED' });
        expect(q.discountTotal).toBe('0.00');
      }
      expect(new Set(responses).size).toBe(1);
      expect(responses.join('')).not.toMatch(
        /EXPIRED|NOT_STARTED|OUTSIDE_SCHEDULE|BRANCH_NOT_ELIGIBLE|CODE_REQUIRED|NO_SAVING|UNKNOWN/,
      );
    });

    it('un cupón sin ahorro (precio bajo) también es NOT_APPLIED', async () => {
      h.repo.seed({ code: 'CERO', kind: 'PERCENT', value: '10.00', productIds: [P3] });
      const q = await h.service.quote(undefined, h.body({ couponCode: 'CERO' }));
      expect(q.coupon).toEqual({ status: 'NOT_APPLIED' });
    });

    it('fila 15: una promoción por línea (la de mayor ahorro); no se apilan', async () => {
      const small = h.repo.seed({ kind: 'PERCENT', value: '10.00' });
      const big = h.repo.seed({ kind: 'PERCENT', value: '30.00' });
      h.repo.seed({ code: 'MONTO', kind: 'FIXED_AMOUNT', value: '5.00' });
      const q = await h.service.quote(undefined, h.body({ couponCode: 'MONTO' }));
      expect(q.lines[0]).toMatchObject({ promotionId: big.id, discount: '51.00' });
      expect(q.lines[0]?.promotionId).not.toBe(small.id);
      expect(q.discountTotal).toBe('51.00');
      expect(q.coupon).toEqual({ status: 'NOT_APPLIED' }); // el cupón no ganó la línea
    });

    it('PROMOTIONS_TRUNCATED se avisa y no se confunde con cupón inválido', async () => {
      const original = h.candidates.load.bind(h.candidates);
      vi.spyOn(h.candidates, 'load').mockImplementation(async (...args) => ({
        ...(await original(...args)),
        truncated: true,
      }));
      const q = await h.service.quote(undefined, h.body());
      expect(q.notices).toEqual([{ code: 'PROMOTIONS_TRUNCATED' }]);
      expect(q.canProceed).toBe(true);
    });
  });

  describe('fila 17: clientView solo avisa', () => {
    it('PRICE_CHANGED: cobra SIEMPRE el precio del servidor y avisa con previousUnitPrice', async () => {
      const q = await h.service.quote(
        undefined,
        h.body({ clientView: { lines: [{ index: 0, unitPrice: '80.00' }], total: '160.00' } }),
      );
      expect(q.lines[0]).toMatchObject({
        status: 'PRICE_CHANGED',
        unitPrice: '85.00',
        previousUnitPrice: '80.00',
        lineTotal: '170.00',
      });
      expect(q.total).toBe('170.00');
      expect(q.canProceed).toBe(true); // comprable
      expect(q.notices).toEqual([
        { code: 'PRICE_CHANGED', lineIndex: 0 },
        { code: 'TOTAL_CHANGED' },
      ]);
      expect(q.blockers).toEqual([]);
    });

    it('un clientView alterado no cambia ningún importe respecto de no enviarlo', async () => {
      const bare = await h.service.quote(undefined, h.body());
      const forged = await h.service.quote(
        undefined,
        h.body({ clientView: { lines: [{ index: 0, unitPrice: '0.01' }], total: '0.01' } }),
      );
      const strip = (q: typeof bare) => ({
        subtotal: q.subtotal,
        discountTotal: q.discountTotal,
        total: q.total,
        unit: q.lines[0]?.unitPrice,
        lineTotal: q.lines[0]?.lineTotal,
      });
      expect(strip(forged)).toEqual(strip(bare));
    });

    it('precio igual y total igual: sin avisos; índice fuera de rango se ignora', async () => {
      const q = await h.service.quote(
        undefined,
        h.body({
          clientView: {
            lines: [
              { index: 0, unitPrice: '85.00' },
              { index: 9, unitPrice: '1.00' },
            ],
            total: '170.00',
          },
        }),
      );
      expect(q.notices).toEqual([]);
      expect(q.lines[0]?.status).toBe('OK');
    });
  });

  describe('fila 20: semáforo', () => {
    it('saturado => 503 CHECKOUT_BUSY con código y mensaje fijos', async () => {
      const gate = new DbGate(1, 0, 10, checkoutBusy);
      const hh = checkoutHarness({ gate });
      let release: () => void = () => undefined;
      const hold = gate.run(() => new Promise<void>((resolve) => (release = resolve)));
      const e = await hh.service.quote(undefined, hh.body()).catch((x: unknown) => x);
      expect(statusOf(e)).toBe(503);
      expect(codeOf(e)).toBe('CHECKOUT_BUSY');
      release();
      await hold;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(gate.inFlight).toBe(0);
      await expect(hh.service.quote(undefined, hh.body())).resolves.toMatchObject({
        canProceed: true,
      });
    });

    it('un error reintentable de BD (P2024) se traduce a CHECKOUT_BUSY; otros errores no', async () => {
      h.availability.canAcceptOrderNow.mockRejectedValueOnce(
        Object.assign(new Error('x'), { code: 'P2024' }),
      );
      const busy = await h.service.quote(undefined, h.body()).catch((x: unknown) => x);
      expect(codeOf(busy)).toBe('CHECKOUT_BUSY');
      h.availability.canAcceptOrderNow.mockRejectedValueOnce(new Error('boom'));
      const other = await h.service.quote(undefined, h.body()).catch((x: unknown) => x);
      expect(codeOf(other)).toBeUndefined();
      expect(other).toBeInstanceOf(Error);
    });

    it('libera el cupo también cuando la cotización falla', async () => {
      await h.service
        .quote(undefined, h.body({ cart: { branchId: mid(555), lines: h.body().cart.lines } }))
        .catch(() => undefined);
      expect(h.gate.inFlight).toBe(0);
    });
  });

  describe('fila 22: sin N+1', () => {
    it('30 líneas con selecciones: lecturas constantes (<= presupuesto), una consulta por lote', async () => {
      const x = seedExtras(h, P1);
      const lines = Array.from({ length: 30 }, (_, i) => ({
        productId: [P1, P2, P3][i % 3] as string,
        quantity: 1 + (i % 3),
        selections: i % 3 === 0 ? [{ groupId: x.group, optionId: x.o1, quantity: 1 as const }] : [],
      }));
      h.repo.seed({ kind: 'PERCENT', value: '10.00' });
      const q = await h.service.quote(
        principal('user-1'),
        h.body({
          cart: { branchId: A, lines },
          fulfillment: { type: 'DELIVERY', customerAddressId: ADDR_OWN },
          couponCode: 'X',
        }),
      );
      expect(q.lines).toHaveLength(30);
      expect(h.world.count('resolveMany')).toBe(1);
      expect(h.visibleCalls.n).toBe(1);
      expect(h.modifiersRepo.count('findOffersMany')).toBe(1);
      expect(h.modifiersRepo.count('findOffer')).toBe(0);
      expect(h.repo.calls.filter((c) => c === 'findCandidates')).toHaveLength(1);
      expect(h.availability.canAcceptOrderNow).toHaveBeenCalledTimes(1);
      expect(h.coverage.check).toHaveBeenCalledTimes(1);
      expect(h.addresses.get).toHaveBeenCalledTimes(1);
      expect(h.queryCount()).toBeLessThanOrEqual(10);
    });
  });

  describe('fila 21: token en la respuesta', () => {
    it('solo con canProceed y secreto; firma válida y sujeto distinto entre invitado y cliente', async () => {
      const guest = await h.service.quote(undefined, h.body());
      const user = await h.service.quote(principal('user-1'), h.body());
      expect(guest.quote.token).toMatch(/^v1\./);
      const g = verifyQuoteToken(guest.quote.token as string, SECRET, h.clock.now().getTime());
      const u = verifyQuoteToken(user.quote.token as string, SECRET, h.clock.now().getTime());
      expect(g.ok && u.ok).toBe(true);
      if (g.ok && u.ok) {
        expect(g.payload.sub).toBe('guest');
        expect(u.payload.sub).not.toBe('guest');
        expect(g.payload).toMatchObject({
          branchId: A,
          type: 'PICKUP',
          provider: null,
          subtotal: '170.00',
          discountTotal: '0.00',
          deliveryFee: '0.00',
          total: '170.00',
        });
        expect(g.payload.exp - g.payload.iat).toBe(600);
        expect(g.payload.inputHash).toBe(u.payload.inputHash); // misma entrada canónica
      }
      expect(JSON.stringify(guest.quote.token)).not.toContain('user-1');
    });

    it('secreto ausente o de menos de 32 caracteres => token null aunque canProceed sea true', async () => {
      for (const secret of [undefined, '', 'corto', 'x'.repeat(31)]) {
        const weak = checkoutHarness({ secret });
        const q = await weak.service.quote(undefined, weak.body());
        expect(q.canProceed).toBe(true);
        expect(q.quote.token).toBeNull();
      }
    });

    it('sin secreto => token null aunque canProceed sea true', async () => {
      const nos = checkoutHarness();
      const q = await nos.service.quote(undefined, nos.body());
      expect(q.canProceed).toBe(true);
      expect(q.quote.token).toBeNull();
    });

    it('la huella no depende del orden de las líneas ni del formato del cupón, pero sí de la entrada', async () => {
      const l1 = { productId: P1, quantity: 1, selections: [] };
      const l2 = { productId: P2, quantity: 2, selections: [] };
      const hashOf = async (lines: (typeof l1)[], extra: object = {}) => {
        const q = await h.service.quote(
          undefined,
          h.body({ cart: { branchId: A, lines }, ...extra }),
        );
        const v = verifyQuoteToken(q.quote.token as string, SECRET, h.clock.now().getTime());
        return v.ok ? v.payload.inputHash : 'x';
      };
      expect(await hashOf([l1, l2])).toBe(await hashOf([l2, l1]));
      expect(await hashOf([l1, l2], { couponCode: ' abc ' })).toBe(
        await hashOf([l2, l1], { couponCode: 'ABC' }),
      );
      expect(await hashOf([l1, l2])).not.toBe(await hashOf([l1, l2], { couponCode: 'ABC' }));
      expect(await hashOf([l1, l2])).not.toBe(await hashOf([l1, { ...l2, quantity: 3 }]));
    });
  });

  describe('fila 1: topes de entrada', () => {
    const lineOf = (quantity: number, selections = 0) => ({
      productId: P1,
      quantity,
      selections: Array.from({ length: selections }, (_, i) => ({
        groupId: mid(i),
        optionId: mid(i + 1000),
        quantity: 1 as const,
      })),
    });
    it.each([
      ['31 líneas', Array.from({ length: 31 }, () => lineOf(1))],
      ['201 unidades', Array.from({ length: 3 }, () => lineOf(67))],
      ['31 selecciones en una línea', [lineOf(1, 31)]],
      ['301 selecciones en total', Array.from({ length: 11 }, () => lineOf(1, 28))],
    ])('%s => 400 QUOTE_LIMITS_EXCEEDED sin consultar la BD', async (_name, lines) => {
      const e = await h.service
        .quote(undefined, h.body({ cart: { branchId: A, lines } }))
        .catch((x: unknown) => x);
      expect(statusOf(e)).toBe(400);
      expect(codeOf(e)).toBe('QUOTE_LIMITS_EXCEEDED');
      expect(h.availability.canAcceptOrderNow).not.toHaveBeenCalled();
    });

    it('exactamente en el tope (30 líneas, 200 unidades) se cotiza', async () => {
      const lines = Array.from({ length: 30 }, (_, i) => lineOf(i < 20 ? 7 : 3));
      const sum = lines.reduce((a, l) => a + l.quantity, 0);
      expect(sum).toBeLessThanOrEqual(200);
      const q = await h.service.quote(undefined, h.body({ cart: { branchId: A, lines } }));
      expect(q.lines).toHaveLength(30);
    });

    it('combinaciones incoherentes de fulfillment => 400', async () => {
      for (const fulfillment of [
        { type: 'PICKUP', municipalityId: MUNI_MIXCO },
        { type: 'PICKUP', deliveryProvider: 'OWN' },
        { type: 'DELIVERY' },
        { type: 'DELIVERY', customerAddressId: ADDR_OWN, municipalityId: MUNI_MIXCO },
        { type: 'DELIVERY', customerAddressId: ADDR_OWN, zone: 'Zona 1' },
      ]) {
        const e = await h.service
          .quote(principal(), h.body({ fulfillment: fulfillment as never }))
          .catch((x: unknown) => x);
        expect(statusOf(e)).toBe(400);
      }
    });
  });

  describe('quoteWithEvidence (F20, aditivo)', () => {
    it('quote() es el mismo resultado que quoteWithEvidence().quote', async () => {
      const a = await h.service.quote(undefined, h.body());
      const b = await h.service.quoteWithEvidence(undefined, h.body());
      expect(b.quote).toEqual(a);
    });

    it('evidencia = payload del token (sin vigencia) con linesHash; null si no canProceed o sin secreto', async () => {
      const { quote, evidence } = await h.service.quoteWithEvidence(undefined, h.body());
      const verified = verifyQuoteToken(quote.quote.token as string, SECRET, NOW.getTime());
      expect(verified.ok).toBe(true);
      const { v, iat, exp, ...rest } = (verified.ok ? verified.payload : {}) as Record<
        string,
        unknown
      >;
      expect([v, typeof iat, typeof exp]).toEqual([1, 'number', 'number']);
      expect(evidence).toEqual(rest);
      expect(evidence?.linesHash).toEqual(expect.any(String));

      h.state.accepted = false;
      const blocked = await h.service.quoteWithEvidence(undefined, h.body());
      expect(blocked.evidence).toBeNull();
      expect(blocked.quote.quote.token).toBeNull();

      const noSecret = checkoutHarness({ secret: undefined });
      const r = await noSecret.service.quoteWithEvidence(undefined, noSecret.body());
      expect(r.evidence).toBeNull();
      expect(r.quote.quote.token).toBeNull();
    });

    it('linesHash cambia si cambia el precio de una línea; sin cambios es estable', async () => {
      const first = await h.service.quoteWithEvidence(undefined, h.body());
      const again = await h.service.quoteWithEvidence(undefined, h.body());
      expect(again.evidence?.linesHash).toBe(first.evidence?.linesHash);
      h.world.seedProduct({ ...(h.world.products.get(P1) as FakeProduct), basePrice: '86.00' });
      const changed = await h.service.quoteWithEvidence(undefined, h.body());
      expect(changed.evidence?.linesHash).not.toBe(first.evidence?.linesHash);
    });

    it('el lugar resuelto: PICKUP => null; municipio + zona; dirección guardada con su texto', async () => {
      expect((await h.service.quoteWithEvidence(undefined, h.body())).resolved.place).toBeNull();
      h.cover.result = coverageResult({ own: ownZone('15.00') });
      const byZone = await h.service.quoteWithEvidence(
        undefined,
        h.body({
          fulfillment: { type: 'DELIVERY', municipalityId: MUNI_GUATEMALA, zone: ' zona  10 ' },
        }),
      );
      expect(byZone.resolved.place).toEqual({
        municipalityId: MUNI_GUATEMALA,
        municipalityName: 'Guatemala',
        zone: 'Zona 10',
        savedAddress: null,
      });
      const owner = principal('user-1');
      h.ownerOf.set(ADDR_OWN, 'user-1');
      const saved = await h.service.quoteWithEvidence(
        owner,
        h.body({ fulfillment: { type: 'DELIVERY', customerAddressId: ADDR_OWN } }),
      );
      expect(saved.resolved.place).toMatchObject({
        municipalityName: 'Guatemala',
        zone: 'Zona 10',
        savedAddress: {
          addressLine: 'Calle 1',
          referenceNote: null,
          latitude: null,
          longitude: null,
        },
      });
    });
  });
});
