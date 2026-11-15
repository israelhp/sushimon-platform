import type { HttpException } from '@nestjs/common';
import { A, coverageHarness, INACTIVE, MISSING } from '../../test/support/coverage-harness.js';
import { MUN_MIXCO, MUN_MISSING } from '../../test/support/fake-coverage-repo.js';
import type { CourierCoveragePort } from './courier-coverage.port.js';
import { MockPedidosYaCoverageAdapter } from './mock-pedidosya-coverage.adapter.js';
import type { PedidosYaMockScenario } from '../config/env.js';

async function failure(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('no falló');
}
const body = (e: HttpException) =>
  e.getResponse() as { code?: string; violations?: { path: string; code: string }[] };

const mock = (s: PedidosYaMockScenario) => new MockPedidosYaCoverageAdapter(s);

describe('DeliveryCoverageService', () => {
  describe('estado por defecto (integración bloqueada): escenario E', () => {
    it('sucursal con defaults: PEDIDOSYA UNKNOWN/BLOCKED_EXTERNAL, OWN apagado, eligibility PENDING, sin simulación', async () => {
      const h = coverageHarness();
      const r = await h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO });
      expect(r.providers.PEDIDOSYA).toEqual({
        enabled: true,
        coverageStatus: 'UNKNOWN',
        integrationStatus: 'BLOCKED_EXTERNAL',
        quoteStatus: 'NOT_AVAILABLE',
        reason: 'INTEGRATION_NOT_CONFIGURED',
      });
      expect(r.providers.OWN).toEqual({
        enabled: false,
        coverageStatus: 'UNAVAILABLE',
        deliveryZoneId: null,
        baseFee: null,
        currency: 'GTQ',
        matchedBy: null,
        reason: 'PROVIDER_DISABLED',
      });
      expect(r.eligibility).toEqual({
        status: 'PENDING',
        confirmedProviders: [],
        pendingProviders: ['PEDIDOSYA'],
        simulated: false,
      });
      expect(r.zone).toBeNull();
      expect(r.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('no existe ningún booleano covered ni campo de costos del cliente', async () => {
      const h = coverageHarness();
      const r = await h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO });
      expect(JSON.stringify(r)).not.toMatch(/"covered"|"fee"|"deliveryFee"|"total"/);
    });
  });

  describe('escenarios A–G con el mock y zonas propias reales', () => {
    const scenario = async (
      s: PedidosYaMockScenario,
      own: 'off' | 'available' | 'unavailable',
      pedidosyaEnabled = true,
    ) => {
      const h = coverageHarness(mock(s));
      h.repo.setSettings(A, { ownDeliveryZonesEnabled: own !== 'off', pedidosyaEnabled });
      if (own === 'available') {
        h.repo.addZone({ branchId: A, municipalityId: MUN_MIXCO, baseFee: '18.00' });
      }
      return h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO });
    };

    it.each([
      ['A', 'available', 'off', 'CONFIRMED', ['PEDIDOSYA'], []],
      ['B', 'available', 'available', 'CONFIRMED', ['PEDIDOSYA', 'OWN'], []],
      ['C', 'unavailable', 'available', 'CONFIRMED', ['OWN'], []],
      ['D', 'unavailable', 'off', 'NONE', [], []],
      ['E', 'unknown', 'off', 'PENDING', [], ['PEDIDOSYA']],
      ['F', 'unknown', 'available', 'CONFIRMED', ['OWN'], ['PEDIDOSYA']],
      ['G', 'unknown', 'unavailable', 'PENDING', [], ['PEDIDOSYA']],
    ] as const)('%s', async (_name, py, own, status, confirmed, pending) => {
      const r = await scenario(py, own);
      expect(r.eligibility).toEqual({
        status,
        confirmedProviders: confirmed,
        pendingProviders: pending,
        simulated: true,
      });
      expect(r.providers.PEDIDOSYA.integrationStatus).toBe('MOCK');
    });

    it('OWN AVAILABLE trae zona y tarifa del servidor (string exacto)', async () => {
      const r = await scenario('available', 'available');
      expect(r.providers.OWN).toMatchObject({
        enabled: true,
        coverageStatus: 'AVAILABLE',
        baseFee: '18.00',
        matchedBy: 'MUNICIPALITY',
        currency: 'GTQ',
      });
      expect(r.providers.OWN.deliveryZoneId).toEqual(expect.any(String));
    });

    it('OWN encendido sin zona => UNAVAILABLE con NO_ZONE_COVERAGE', async () => {
      const r = await scenario('unavailable', 'unavailable');
      expect(r.providers.OWN).toMatchObject({
        enabled: true,
        coverageStatus: 'UNAVAILABLE',
        reason: 'NO_ZONE_COVERAGE',
        matchedBy: null,
      });
    });

    it('PedidosYa deshabilitado: no se consulta, UNKNOWN + PROVIDER_DISABLED, sin pendientes ni simulación', async () => {
      const checkCoverage = vi.fn();
      const port: CourierCoveragePort = { integrationStatus: 'MOCK', checkCoverage };
      const h = coverageHarness(port);
      h.repo.setSettings(A, { pedidosyaEnabled: false });
      const r = await h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO });
      expect(checkCoverage).not.toHaveBeenCalled();
      expect(r.providers.PEDIDOSYA).toMatchObject({
        enabled: false,
        coverageStatus: 'UNKNOWN',
        reason: 'PROVIDER_DISABLED',
      });
      expect(r.eligibility).toEqual({
        status: 'NONE',
        confirmedProviders: [],
        pendingProviders: [],
        simulated: false,
      });
    });
  });

  describe('prioridad de zonas y normalización de la zona recibida', () => {
    const base = (h: ReturnType<typeof coverageHarness>) => {
      h.repo.setSettings(A, { ownDeliveryZonesEnabled: true });
      return {
        general: h.repo.addZone({ branchId: A, municipalityId: MUN_MIXCO, baseFee: '25.00' }),
        z4: h.repo.addZone({
          branchId: A,
          municipalityId: MUN_MIXCO,
          zoneLabel: 'Zona 4',
          zoneKey: 'zona 4',
          baseFee: '12.00',
        }),
      };
    };

    it('zona específica gana; la etiqueta se compara sin acentos ni mayúsculas ni espacios extra', async () => {
      const h = coverageHarness();
      const { z4 } = base(h);
      const r = await h.coverage.check({
        branchId: A,
        municipalityId: MUN_MIXCO,
        zone: '  ZONA   4 ',
      });
      expect(r.providers.OWN).toMatchObject({
        deliveryZoneId: z4.id,
        baseFee: '12.00',
        matchedBy: 'ZONE',
      });
      expect(r.zone).toBe('ZONA 4');
    });

    it('zona informada sin específica cae a la general; sin zona aplica la general', async () => {
      const h = coverageHarness();
      const { general } = base(h);
      for (const zone of ['Zona 9', null, undefined, '   ']) {
        const r = await h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO, zone });
        expect(r.providers.OWN).toMatchObject({
          deliveryZoneId: general.id,
          matchedBy: 'MUNICIPALITY',
          baseFee: '25.00',
        });
      }
    });

    it('una zona inactiva se ignora como si no existiera (no excluye a la general)', async () => {
      const h = coverageHarness();
      const { general, z4 } = base(h);
      z4.active = false;
      const r = await h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO, zone: 'Zona 4' });
      expect(r.providers.OWN).toMatchObject({
        deliveryZoneId: general.id,
        matchedBy: 'MUNICIPALITY',
      });
    });

    it('solo zona específica y zona distinta => UNAVAILABLE NO_ZONE_COVERAGE', async () => {
      const h = coverageHarness();
      h.repo.setSettings(A, { ownDeliveryZonesEnabled: true });
      h.repo.addZone({
        branchId: A,
        municipalityId: MUN_MIXCO,
        zoneLabel: 'Zona 4',
        zoneKey: 'zona 4',
      });
      const r = await h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO, zone: 'Zona 5' });
      expect(r.providers.OWN).toMatchObject({
        coverageStatus: 'UNAVAILABLE',
        reason: 'NO_ZONE_COVERAGE',
      });
    });

    it('zona con carácter de control o >60 => 400', async () => {
      const h = coverageHarness();
      for (const zone of ['Zona\u0000', 'z'.repeat(61)]) {
        const e = await failure(h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO, zone }));
        expect(e.getStatus()).toBe(400);
      }
    });
  });

  describe('errores de referencia (422)', () => {
    it('sucursal inexistente o inactiva => 422 BRANCH_NOT_AVAILABLE idéntico', async () => {
      const h = coverageHarness();
      const missing = await failure(
        h.coverage.check({ branchId: MISSING, municipalityId: MUN_MIXCO }),
      );
      const inactive = await failure(
        h.coverage.check({ branchId: INACTIVE, municipalityId: MUN_MIXCO }),
      );
      for (const e of [missing, inactive]) {
        expect(e.getStatus()).toBe(422);
        expect(body(e).code).toBe('BRANCH_NOT_AVAILABLE');
        expect(body(e).violations?.[0]?.path).toBe('branchId');
      }
      expect(body(missing)).toEqual(body(inactive));
    });

    it('municipio inexistente => 422 MUNICIPALITY_NOT_FOUND', async () => {
      const h = coverageHarness();
      const e = await failure(h.coverage.check({ branchId: A, municipalityId: MUN_MISSING }));
      expect(e.getStatus()).toBe(422);
      expect(body(e).code).toBe('MUNICIPALITY_NOT_FOUND');
      expect(body(e).violations?.[0]?.path).toBe('municipalityId');
    });
  });

  describe('fallos del proveedor (D18): UNKNOWN, nunca UNAVAILABLE ni 5xx', () => {
    it('excepción del puerto => UNKNOWN + PROVIDER_ERROR; OWN se evalúa igual', async () => {
      const port: CourierCoveragePort = {
        integrationStatus: 'BLOCKED_EXTERNAL',
        checkCoverage: () => Promise.reject(new TypeError('cuerpo secreto del proveedor')),
      };
      const h = coverageHarness(port);
      h.repo.setSettings(A, { ownDeliveryZonesEnabled: true });
      h.repo.addZone({ branchId: A, municipalityId: MUN_MIXCO });
      const r = await h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO });
      expect(r.providers.PEDIDOSYA).toMatchObject({
        coverageStatus: 'UNKNOWN',
        reason: 'PROVIDER_ERROR',
      });
      expect(JSON.stringify(r)).not.toContain('secreto');
      expect(r.providers.OWN.coverageStatus).toBe('AVAILABLE');
      expect(r.eligibility.status).toBe('CONFIRMED');
    });

    it('el mensaje del error del proveedor no llega a los logs (solo el nombre de la clase)', async () => {
      const { Logger } = await import('@nestjs/common');
      const port: CourierCoveragePort = {
        integrationStatus: 'BLOCKED_EXTERNAL',
        checkCoverage: () => Promise.reject(new RangeError('token=abc123')),
      };
      const h = coverageHarness(port);
      const warn = vi.spyOn(Logger.prototype, 'warn');
      await h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO });
      const logged = warn.mock.calls.map((c) => String(c[0])).join(' ');
      expect(logged).toContain('RangeError');
      expect(logged).not.toContain('abc123');
    });

    it('puerto que no responde antes del tope => UNKNOWN + PROVIDER_TIMEOUT', async () => {
      vi.useFakeTimers();
      try {
        const port: CourierCoveragePort = {
          integrationStatus: 'BLOCKED_EXTERNAL',
          checkCoverage: () => new Promise(() => undefined),
        };
        const h = coverageHarness(port, 500);
        const pending = h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO });
        await vi.advanceTimersByTimeAsync(499);
        let settled = false;
        void pending.then(() => (settled = true));
        await Promise.resolve();
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        const r = await pending;
        expect(r.providers.PEDIDOSYA).toMatchObject({
          coverageStatus: 'UNKNOWN',
          reason: 'PROVIDER_TIMEOUT',
        });
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('respuesta inválida del puerto (estado desconocido o vacío) => UNKNOWN + PROVIDER_ERROR', async () => {
      for (const bad of [{ status: 'COVERED' }, null, undefined]) {
        const port = {
          integrationStatus: 'BLOCKED_EXTERNAL',
          checkCoverage: () => Promise.resolve(bad),
        } as unknown as CourierCoveragePort;
        const h = coverageHarness(port);
        const r = await h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO });
        expect(r.providers.PEDIDOSYA).toMatchObject({
          coverageStatus: 'UNKNOWN',
          reason: 'PROVIDER_ERROR',
        });
      }
    });

    it('un motivo desconocido del adaptador no se reenvía (solo nuestros códigos)', async () => {
      const port = {
        integrationStatus: 'BLOCKED_EXTERNAL',
        checkCoverage: () =>
          Promise.resolve({
            provider: 'PEDIDOSYA',
            status: 'UNKNOWN',
            integrationStatus: 'BLOCKED_EXTERNAL',
            reason: 'TEXTO_DEL_PROVEEDOR',
          }),
      } as unknown as CourierCoveragePort;
      const h = coverageHarness(port);
      const r = await h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO });
      expect(r.providers.PEDIDOSYA.reason).toBeUndefined();
      expect(JSON.stringify(r)).not.toContain('TEXTO_DEL_PROVEEDOR');
    });

    it.each([
      ['timeout', 'PROVIDER_TIMEOUT'],
      ['provider_error', 'PROVIDER_ERROR'],
      ['invalid_request', 'INVALID_REQUEST'],
    ] as const)(
      'mock %s => UNKNOWN + %s (pendiente, no confirmado ni sin cobertura)',
      async (s, reason) => {
        const h = coverageHarness(mock(s));
        const r = await h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO });
        expect(r.providers.PEDIDOSYA).toMatchObject({ coverageStatus: 'UNKNOWN', reason });
        expect(r.eligibility.pendingProviders).toEqual(['PEDIDOSYA']);
      },
    );
  });

  describe('presupuesto de consultas', () => {
    it('OWN apagado: 1 consulta de contexto y 0 de zonas', async () => {
      const h = coverageHarness();
      await h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO });
      expect(h.repo.queries).toEqual({ context: 1, candidates: 0, settings: 0 });
    });

    it('OWN encendido: 1 de contexto + 1 de zonas, sin releer el flag', async () => {
      const h = coverageHarness();
      h.repo.setSettings(A, { ownDeliveryZonesEnabled: true });
      await h.coverage.check({ branchId: A, municipalityId: MUN_MIXCO, zone: 'Zona 4' });
      expect(h.repo.queries).toEqual({ context: 1, candidates: 1, settings: 0 });
    });
  });
});
