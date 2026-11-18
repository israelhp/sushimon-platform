import { Logger } from '@nestjs/common';
import { MAX_CANDIDATES, PromotionCandidatesService } from './promotion-candidates.service.js';
import type { PromotionsRepository } from './promotions.repository.js';

const BRANCH = '00000000-0000-4000-8000-000000007001';
const OTHER = '00000000-0000-4000-8000-000000007002';
const row = (i: number) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  code: null,
  kind: 'PERCENT',
  value: '10.00',
  startsAt: new Date(0),
  endsAt: new Date(9e12),
  dineInOnly: false,
  active: true,
  branchIds: [],
  productIds: [],
  schedule: [],
});

describe('PromotionCandidatesService: aviso de truncado (F19)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('trunca a 200 y avisa como máximo una vez por minuto y sucursal', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const rows = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => row(i));
    const repo = { findCandidates: vi.fn().mockResolvedValue(rows) };
    const service = new PromotionCandidatesService(repo as unknown as PromotionsRepository);
    const at = new Date('2026-11-16T22:00:00Z');
    const first = await service.load(BRANCH, at);
    expect(first.truncated).toBe(true);
    expect(first.promotions).toHaveLength(MAX_CANDIDATES);
    await service.load(BRANCH, at);
    await service.load(BRANCH, at);
    expect(warn).toHaveBeenCalledTimes(1);
    await service.load(OTHER, at); // otra sucursal avisa
    expect(warn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(61_000);
    await service.load(BRANCH, at);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(String(warn.mock.calls[0]?.[0])).not.toMatch(/SUSHI|código/i);
  });

  it('sin truncado no avisa', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const repo = { findCandidates: vi.fn().mockResolvedValue([row(1)]) };
    const service = new PromotionCandidatesService(repo as unknown as PromotionsRepository);
    expect((await service.load(BRANCH, new Date())).truncated).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
