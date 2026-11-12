import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderStore } from '@/test/store-providers';
import { CAROUSEL_INTERVAL_MS, PromoCarousel } from './promo-carousel';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

const dot = (n: number) => screen.getByRole('button', { name: `Ir a la promoción ${n}` });
const current = () => [1, 2, 3, 4].find((n) => dot(n).getAttribute('aria-current') === 'true');
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function mockReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockReducedMotion(false);
});
afterEach(() => {
  vi.useRealTimers();
  mockReducedMotion(false);
});

describe('PromoCarousel', () => {
  it('muestra 4 diapositivas accesibles y la primera activa', async () => {
    await renderStore(<PromoCarousel />);
    expect(screen.getByRole('region', { name: 'Promociones' })).toHaveAttribute(
      'aria-roledescription',
      'carrusel',
    );
    const slides = Array.from(
      document.querySelectorAll<HTMLElement>('article[aria-roledescription="diapositiva"]'),
    );
    expect(slides.map((el) => el.getAttribute('aria-label'))).toEqual([
      '1 de 4',
      '2 de 4',
      '3 de 4',
      '4 de 4',
    ]);
    // Solo la diapositiva actual es interactiva.
    expect(slides.map((el) => el.hasAttribute('inert'))).toEqual([false, true, true, true]);
    expect(current()).toBe(1);
    expect(screen.getByRole('button', { name: 'Promoción siguiente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Promoción anterior' })).toBeInTheDocument();
  });

  it('avanza sola cada 6 s y vuelve al inicio', async () => {
    await renderStore(<PromoCarousel />);
    await advance(CAROUSEL_INTERVAL_MS);
    expect(current()).toBe(2);
    await advance(CAROUSEL_INTERVAL_MS);
    expect(current()).toBe(3);
    await advance(CAROUSEL_INTERVAL_MS);
    expect(current()).toBe(4);
    await advance(CAROUSEL_INTERVAL_MS);
    expect(current()).toBe(1);
  });

  it('flechas y puntos cambian la diapositiva y reinician la cuenta', async () => {
    await renderStore(<PromoCarousel />);
    fireEvent.click(screen.getByRole('button', { name: 'Promoción anterior' }));
    expect(current()).toBe(4);
    fireEvent.click(dot(2));
    expect(current()).toBe(2);
    await advance(CAROUSEL_INTERVAL_MS - 100);
    expect(current()).toBe(2);
    await advance(200);
    expect(current()).toBe(3);
  });

  it('el botón de pausa detiene el avance y permite reanudar', async () => {
    await renderStore(<PromoCarousel />);
    const pause = screen.getByRole('button', { name: 'Pausar carrusel' });
    fireEvent.click(pause);
    expect(screen.getByRole('button', { name: 'Reanudar carrusel' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await advance(CAROUSEL_INTERVAL_MS * 3);
    expect(current()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reanudar carrusel' }));
    await advance(CAROUSEL_INTERVAL_MS);
    expect(current()).toBe(2);
  });

  it('se pausa con el puntero o el foco encima y sigue al salir', async () => {
    await renderStore(<PromoCarousel />);
    const region = screen.getByRole('region', { name: 'Promociones' });
    fireEvent.mouseEnter(region);
    await advance(CAROUSEL_INTERVAL_MS * 2);
    expect(current()).toBe(1);
    fireEvent.mouseLeave(region);
    await advance(CAROUSEL_INTERVAL_MS);
    expect(current()).toBe(2);

    fireEvent.focus(dot(3));
    await advance(CAROUSEL_INTERVAL_MS * 2);
    expect(current()).toBe(2);
  });

  it('con prefers-reduced-motion no avanza solo ni ofrece pausa', async () => {
    mockReducedMotion(true);
    await renderStore(<PromoCarousel />);
    await advance(CAROUSEL_INTERVAL_MS * 3);
    expect(current()).toBe(1);
    expect(screen.queryByRole('button', { name: 'Pausar carrusel' })).not.toBeInTheDocument();
    // La navegación manual sigue disponible.
    fireEvent.click(dot(3));
    expect(current()).toBe(3);
  });
});
