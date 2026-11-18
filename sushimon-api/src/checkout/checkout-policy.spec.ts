import { coverageResult, ownZone } from '../../test/support/checkout-harness.js';
import {
  assertFulfillmentShape,
  assertQuoteLimits,
  centsToMoney,
  classifyLine,
  decideDelivery,
  moneyToCents,
} from './checkout-policy.js';

describe('checkout-policy (F19)', () => {
  describe('dinero en centavos', () => {
    it('moneyToCents / centsToMoney son inversas y rechazan formatos inválidos', () => {
      for (const v of ['0.00', '0.05', '85.00', '99999.99', '999999999.99']) {
        expect(centsToMoney(moneyToCents(v) as number)).toBe(v);
      }
      for (const v of ['85', '85.0', '-1.00', '1e3', '1,00', ' 1.00', '1.000']) {
        expect(moneyToCents(v)).toBeNull();
      }
      expect(() => centsToMoney(-1)).toThrow();
      expect(() => centsToMoney(1.5)).toThrow();
    });
  });

  describe('assertQuoteLimits', () => {
    it('acepta los topes exactos y rechaza el siguiente', () => {
      expect(() =>
        assertQuoteLimits(Array.from({ length: 30 }, () => ({ quantity: 6, selections: [] }))),
      ).not.toThrow();
      expect(() =>
        assertQuoteLimits(Array.from({ length: 31 }, () => ({ quantity: 1, selections: [] }))),
      ).toThrow();
      expect(() =>
        assertQuoteLimits([
          { quantity: 99, selections: [] },
          { quantity: 99, selections: [] },
          { quantity: 3, selections: [] },
        ]),
      ).toThrow();
      expect(() =>
        assertQuoteLimits([{ quantity: 1, selections: new Array(30).fill(0) }]),
      ).not.toThrow();
      expect(() =>
        assertQuoteLimits([{ quantity: 1, selections: new Array(31).fill(0) }]),
      ).toThrow();
      const ten = Array.from({ length: 10 }, () => ({
        quantity: 1,
        selections: new Array(30).fill(0),
      }));
      expect(() => assertQuoteLimits(ten)).not.toThrow(); // 300 en total
      expect(() => assertQuoteLimits([...ten, { quantity: 1, selections: [0] }])).toThrow();
    });
  });

  describe('assertFulfillmentShape', () => {
    it('PICKUP sin extras; DELIVERY con exactamente uno de address/municipio', () => {
      expect(() => assertFulfillmentShape({ type: 'PICKUP' })).not.toThrow();
      expect(() => assertFulfillmentShape({ type: 'PICKUP', zone: null })).toThrow();
      expect(() =>
        assertFulfillmentShape({
          type: 'DELIVERY',
          municipalityId: 'm',
          zone: 'Zona 1',
          deliveryProvider: 'OWN',
        }),
      ).not.toThrow();
      expect(() =>
        assertFulfillmentShape({ type: 'DELIVERY', customerAddressId: 'a' }),
      ).not.toThrow();
      expect(() => assertFulfillmentShape({ type: 'DELIVERY' })).toThrow();
      expect(() =>
        assertFulfillmentShape({ type: 'DELIVERY', customerAddressId: 'a', municipalityId: 'm' }),
      ).toThrow();
      expect(() =>
        assertFulfillmentShape({ type: 'DELIVERY', customerAddressId: 'a', zone: null }),
      ).toThrow();
    });
  });

  describe('classifyLine: precedencia', () => {
    const ok = { status: 'OK' as const, extraTotal: '0.00', items: [] };
    const base = {
      offer: { state: 'OK' as const, price: '85.00' },
      extras: ok,
      effectiveUnitCents: 8500,
      clientUnitCents: null,
    };
    const invalid = (code: string) => ({
      status: 'INVALID' as const,
      violations: [{ path: 'p', code, message: 'm' }],
    });

    it('cada estado', () => {
      expect(classifyLine(base)).toBe('OK');
      expect(classifyLine({ ...base, offer: undefined })).toBe('NOT_FOUND');
      expect(classifyLine({ ...base, offer: { state: 'UNKNOWN', price: null } })).toBe('NOT_FOUND');
      expect(classifyLine({ ...base, extras: { status: 'NOT_FOUND' } })).toBe('NOT_FOUND');
      expect(classifyLine({ ...base, offer: { state: 'HIDDEN', price: '1.00' } })).toBe('INACTIVE');
      expect(classifyLine({ ...base, offer: { state: 'SOLD_OUT', price: '1.00' } })).toBe(
        'UNAVAILABLE',
      );
      expect(classifyLine({ ...base, extras: invalid('MODIFIER_INACTIVE') })).toBe(
        'OPTION_UNAVAILABLE',
      );
      expect(classifyLine({ ...base, extras: invalid('MODIFIER_NOT_IN_GROUP') })).toBe(
        'OPTION_UNAVAILABLE',
      );
      for (const code of [
        'MODIFIER_REQUIRED',
        'MODIFIER_TOO_MANY',
        'MODIFIER_GROUP_NOT_ON_PRODUCT',
        'MODIFIER_DUPLICATED',
        'MODIFIER_SELECTION_INVALID',
      ]) {
        expect(classifyLine({ ...base, extras: invalid(code) })).toBe('MODIFIER_INVALID');
      }
      expect(classifyLine({ ...base, clientUnitCents: 8000 })).toBe('PRICE_CHANGED');
      expect(classifyLine({ ...base, clientUnitCents: 8500 })).toBe('OK');
    });

    it('NOT_FOUND > INACTIVE > UNAVAILABLE > OPTION_UNAVAILABLE > MODIFIER_INVALID > PRICE_CHANGED', () => {
      const all = { ...base, clientUnitCents: 1, extras: invalid('MODIFIER_REQUIRED') };
      expect(classifyLine(all)).toBe('MODIFIER_INVALID');
      expect(classifyLine({ ...all, extras: invalid('MODIFIER_INACTIVE') })).toBe(
        'OPTION_UNAVAILABLE',
      );
      expect(classifyLine({ ...all, offer: { state: 'SOLD_OUT', price: '1.00' } })).toBe(
        'UNAVAILABLE',
      );
      expect(classifyLine({ ...all, offer: { state: 'HIDDEN', price: '1.00' } })).toBe('INACTIVE');
      expect(classifyLine({ ...all, offer: { state: 'UNKNOWN', price: null } })).toBe('NOT_FOUND');
    });
  });

  describe('decideDelivery', () => {
    it('OWN seleccionable: tarifa de la zona; PedidosYa nunca', () => {
      const d = decideDelivery(coverageResult({ own: ownZone('12.34') }), undefined);
      expect(d).toMatchObject({ selectedProvider: 'OWN', feeCents: 1234, blockers: [] });
      expect(d.options.map((o) => [o.provider, o.selectable])).toEqual([
        ['PEDIDOSYA', false],
        ['OWN', true],
      ]);
    });

    it('OWN AVAILABLE con tarifa inválida no es seleccionable (fail-closed)', () => {
      const d = decideDelivery(
        coverageResult({ own: { ...ownZone(), baseFee: 'abc' } }),
        undefined,
      );
      expect(d.selectedProvider).toBeNull();
      expect(d.feeCents).toBeNull();
      expect(d.blockers).toEqual(['DELIVERY_UNVERIFIED']);
    });

    it('OWN AVAILABLE pero flag apagado (dato incoherente) no es seleccionable', () => {
      const d = decideDelivery(
        coverageResult({ own: { ...ownZone(), enabled: false } }),
        undefined,
      );
      expect(d.selectedProvider).toBeNull();
    });

    it('PedidosYa nunca aporta tarifa aunque un adaptador devuelva AVAILABLE', () => {
      for (const integrationStatus of ['MOCK', 'LIVE', 'BLOCKED_EXTERNAL'] as const) {
        const d = decideDelivery(
          coverageResult({
            pedidosya: { coverageStatus: 'AVAILABLE', integrationStatus, reason: undefined },
          }),
          undefined,
        );
        expect(d.feeCents).toBeNull();
        expect(d.selectedProvider).toBeNull();
        expect(d.options[0]).toMatchObject({ selectable: false, customerFee: null });
        expect(d.blockers).toEqual(['DELIVERY_UNVERIFIED']);
      }
    });

    it('simulated solo con MOCK', () => {
      const mock = decideDelivery(
        coverageResult({ pedidosya: { integrationStatus: 'MOCK' } }),
        undefined,
      );
      expect(mock.options[0]?.simulated).toBe(true);
      const live = decideDelivery(
        coverageResult({ pedidosya: { integrationStatus: 'LIVE' } }),
        undefined,
      );
      expect(live.options[0]?.simulated).toBe(false);
    });

    it('un UNAVAILABLE simulado no cuenta como «no cubre» (DELIVERY_UNVERIFIED, no UNAVAILABLE)', () => {
      const d = decideDelivery(
        coverageResult({
          own: { enabled: true, coverageStatus: 'UNAVAILABLE', reason: 'NO_ZONE_COVERAGE' },
          pedidosya: {
            coverageStatus: 'UNAVAILABLE',
            integrationStatus: 'MOCK',
            reason: undefined,
          },
        }),
        undefined,
      );
      expect(d.blockers).toEqual(['DELIVERY_UNVERIFIED']);
    });

    it('PedidosYa UNAVAILABLE real y OWN sin zona => DELIVERY_UNAVAILABLE', () => {
      const d = decideDelivery(
        coverageResult({
          own: { enabled: true, coverageStatus: 'UNAVAILABLE', reason: 'NO_ZONE_COVERAGE' },
          pedidosya: {
            coverageStatus: 'UNAVAILABLE',
            integrationStatus: 'LIVE',
            reason: undefined,
          },
        }),
        undefined,
      );
      expect(d.blockers).toEqual(['DELIVERY_UNAVAILABLE']);
    });

    it('ningún proveedor habilitado => DELIVERY_UNAVAILABLE', () => {
      const d = decideDelivery(coverageResult({ pedidosya: { enabled: false } }), undefined);
      expect(d.blockers).toEqual(['DELIVERY_UNAVAILABLE']);
    });

    it('un proveedor pedido y no seleccionable no se sustituye', () => {
      const d = decideDelivery(coverageResult({ own: ownZone() }), 'PEDIDOSYA');
      expect(d).toMatchObject({
        selectedProvider: null,
        feeCents: null,
        blockers: ['DELIVERY_PROVIDER_NOT_SELECTABLE'],
      });
    });
  });
});
