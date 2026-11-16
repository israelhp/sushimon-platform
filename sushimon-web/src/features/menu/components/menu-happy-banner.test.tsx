import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HappyHourPhase } from '@/features/promos/happy-hour';
import type { StorePromotion } from '@/lib/data-access/models';
import { renderStore } from '@/test/store-providers';
import { MenuHappyBanner } from './menu-happy-banner';

const promotion: StorePromotion = {
  id: 'happy-hour',
  name: 'Happy Hour',
  description: null,
  requiresCode: false,
  isHappyHour: true,
  dineInOnly: true,
  state: 'upcoming',
  validFrom: '2026-10-01T06:00:00.000Z',
  validUntil: '2027-01-01T06:00:00.000Z',
  schedule: [1, 2, 3, 4].map((weekday) => ({ weekday, startsAt: '15:00', endsAt: '18:00' })),
  nextStartsAt: '2026-11-11T21:00:00.000Z',
  nextEndsAt: null,
  productScope: 'SELECTED',
};
let state: { promotion?: StorePromotion; phase: HappyHourPhase | null };

vi.mock('@/features/promos/use-happy-hour', () => ({
  useHappyHour: () => ({
    ...state,
    generatedAt: '2026-11-11T20:25:00.000Z',
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

beforeEach(() => {
  state = { promotion, phase: { kind: 'upcoming', startsAt: '2026-11-11T21:00:00.000Z' } };
});

describe('MenuHappyBanner según lo que informa la API', () => {
  it('antes del horario muestra días y horas sin insignia', async () => {
    await renderStore(<MenuHappyBanner />);
    const link = screen.getByRole('link', { name: /Happy Hour/ });
    expect(link).toHaveAttribute('href', '/promociones');
    expect(link).toHaveTextContent(
      'Lunes a jueves · 3:00 p. m. – 6:00 p. m. · Solo en restaurante',
    );
    expect(screen.queryByText('En curso')).not.toBeInTheDocument();
  });

  it('vigente marca "En curso"', async () => {
    state = {
      promotion: { ...promotion, state: 'live' },
      phase: { kind: 'live', endsAt: '2026-11-12T00:00:00.000Z' },
    };
    await renderStore(<MenuHappyBanner />);
    expect(screen.getByText('En curso')).toBeInTheDocument();
  });

  it('sin Happy Hour no muestra nada', async () => {
    state = { promotion: undefined, phase: null };
    await renderStore(<MenuHappyBanner />);
    expect(screen.queryByRole('link', { name: /Happy Hour/ })).not.toBeInTheDocument();
  });
});
