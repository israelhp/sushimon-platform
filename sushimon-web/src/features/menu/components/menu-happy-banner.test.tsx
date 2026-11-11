import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HappyHourPhase } from '@/features/promos/happy-hour';
import type { Promotion } from '@/lib/data-access/models';
import { PROMOTION_SEEDS } from '@/mocks/fixtures/promotions';
import { renderStore } from '@/test/store-providers';
import { MenuHappyBanner } from './menu-happy-banner';

const promotion: Promotion = {
  ...PROMOTION_SEEDS.find((p) => p.id === 'happy-hour')!,
  status: 'current',
};
let state: { promotion?: Promotion; phase: HappyHourPhase | null };

vi.mock('@/features/promos/use-happy-hour', () => ({
  useHappyHour: () => ({ ...state, now: null, isPending: false, isError: false, refetch: vi.fn() }),
}));

beforeEach(() => {
  state = { promotion, phase: { kind: 'today', startsAt: '15:00' } };
});

describe('MenuHappyBanner según el horario', () => {
  it('antes del horario muestra días y horas sin insignia', async () => {
    await renderStore(<MenuHappyBanner />);
    const link = screen.getByRole('link', { name: /Happy Hour/ });
    expect(link).toHaveAttribute('href', '/promociones');
    expect(link).toHaveTextContent(
      'Lunes a jueves · 3:00 p. m. – 6:00 p. m. · Solo en restaurante',
    );
    expect(screen.queryByText('En curso')).not.toBeInTheDocument();
  });

  it('dentro del horario marca "En curso"', async () => {
    state = { promotion, phase: { kind: 'live', endsAt: '18:00' } };
    await renderStore(<MenuHappyBanner />);
    expect(screen.getByText('En curso')).toBeInTheDocument();
  });

  it('vencida marca "Finalizada"', async () => {
    state = { promotion, phase: { kind: 'expired', on: '2026-11-10' } };
    await renderStore(<MenuHappyBanner />);
    expect(screen.getByText('Finalizada')).toBeInTheDocument();
  });

  it('sin promoción no muestra nada', async () => {
    state = { promotion: undefined, phase: null };
    await renderStore(<MenuHappyBanner />);
    expect(screen.queryByRole('link', { name: /Happy Hour/ })).not.toBeInTheDocument();
  });
});
