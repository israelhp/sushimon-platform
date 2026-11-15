import { A, coverageHarness } from '../../test/support/coverage-harness.js';
import { MUN_MIXCO, MUN_VN } from '../../test/support/fake-coverage-repo.js';

describe('OwnDeliveryCoverageService', () => {
  it('flag apagado (sin fila = default) => UNAVAILABLE PROVIDER_DISABLED SIN consultar zonas', async () => {
    const h = coverageHarness();
    h.repo.addZone({ branchId: A, municipalityId: MUN_MIXCO });
    const r = await h.own.evaluate({ branchId: A, municipalityId: MUN_MIXCO });
    expect(r).toEqual({
      status: 'UNAVAILABLE',
      deliveryZoneId: null,
      baseFee: null,
      currency: 'GTQ',
      matchedBy: null,
      reason: 'PROVIDER_DISABLED',
    });
    expect(h.repo.queries.candidates).toBe(0);
  });

  it('flag encendido: específica > general; una sola consulta acotada', async () => {
    const h = coverageHarness();
    h.repo.setSettings(A, { ownDeliveryZonesEnabled: true });
    h.repo.addZone({ branchId: A, municipalityId: MUN_MIXCO, baseFee: '30.00' });
    const z = h.repo.addZone({
      branchId: A,
      municipalityId: MUN_MIXCO,
      zoneLabel: 'Zona 1',
      zoneKey: 'zona 1',
      baseFee: '10.50',
    });
    const r = await h.own.evaluate({ branchId: A, municipalityId: MUN_MIXCO, zone: 'ZONA 1' });
    expect(r).toMatchObject({
      status: 'AVAILABLE',
      deliveryZoneId: z.id,
      baseFee: '10.50',
      matchedBy: 'ZONE',
    });
    expect(h.repo.queries.candidates).toBe(1);
  });

  it('no mezcla municipios ni sucursales', async () => {
    const h = coverageHarness();
    h.repo.setSettings(A, { ownDeliveryZonesEnabled: true });
    h.repo.addZone({ branchId: A, municipalityId: MUN_VN });
    h.repo.addZone({ branchId: 'otra', municipalityId: MUN_MIXCO });
    const r = await h.own.evaluate({ branchId: A, municipalityId: MUN_MIXCO });
    expect(r).toMatchObject({ status: 'UNAVAILABLE', reason: 'NO_ZONE_COVERAGE' });
  });

  it('`ownEnabled` explícito evita releer settings', async () => {
    const h = coverageHarness();
    await h.own.evaluate({ branchId: A, municipalityId: MUN_MIXCO, ownEnabled: true });
    expect(h.repo.queries.settings).toBe(0);
  });
});
