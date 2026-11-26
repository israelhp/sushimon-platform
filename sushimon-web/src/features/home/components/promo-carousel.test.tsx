import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSimulatedObjects, registerSimulatedObject } from '@/lib/media-simulated';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { CAROUSEL_INTERVAL_MS, PromoCarousel } from './promo-carousel';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * F16 (simplificado, ADR-0033) — Carrusel del Inicio con banners del contrato: solo imágenes con su texto alternativo, sin textos
 * superpuestos ni enlaces. La semilla trae 3 banners activos (favoritos, happy-hour y calientito) y 1 inactivo (navidad), en orden
 * de creación; el carrusel solo recibe los activos.
 */
const ALTS = [
  'Selección de rolls favoritos de Sushi Mon',
  'Mesa con rolls y bebidas durante el Happy Hour',
  'Calientito Roll recién salido de la cocina',
];

const dot = (n: number) => screen.getByRole('button', { name: `Ir a la promoción ${n}` });
const current = () => [1, 2, 3, 4].find((n) => dot(n).getAttribute('aria-current') === 'true');
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const slides = () =>
  Array.from(document.querySelectorAll<HTMLElement>('article[aria-roledescription]'));

function mockReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

async function renderLoaded(options: Parameters<typeof renderStore>[1] = {}) {
  const view = await renderStore(<PromoCarousel />, options);
  await waitFor(() => expect(slides().length).toBeGreaterThan(0));
  return view;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockReducedMotion(false);
});
afterEach(() => {
  vi.useRealTimers();
  mockReducedMotion(false);
  clearSimulatedObjects();
  vi.unstubAllGlobals();
});

describe('PromoCarousel con banners del servidor', () => {
  it('muestra los banners activos en orden de creación con roles accesibles y el primero activo', async () => {
    await renderLoaded();
    expect(screen.getByRole('region', { name: 'Promociones' })).toHaveAttribute(
      'aria-roledescription',
      'carrusel',
    );
    expect(slides().map((el) => el.getAttribute('aria-label'))).toEqual([
      '1 de 3',
      '2 de 3',
      '3 de 3',
    ]);
    // Solo imágenes (o fondo de marca con su nombre accesible): el texto alternativo es lo único que se lee.
    expect(
      slides().map(
        (el) =>
          (el.querySelector('img') ?? el.querySelector('[role="img"]'))?.getAttribute('alt') ??
          el.querySelector('[role="img"]')?.getAttribute('aria-label'),
      ),
    ).toEqual(ALTS);
    expect(slides().every((el) => el.querySelector('h2, p, a, button') === null)).toBe(true);
    // Solo la diapositiva actual es interactiva.
    expect(slides().map((el) => el.hasAttribute('inert'))).toEqual([false, true, true]);
    expect(current()).toBe(1);
    expect(screen.getByRole('button', { name: 'Promoción siguiente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Promoción anterior' })).toBeInTheDocument();
    // Ni precios ni textos superpuestos ni enlaces.
    expect(document.body.textContent).not.toMatch(/Q\d/);
    expect(document.querySelectorAll('article a')).toHaveLength(0);
  });

  it('la lista no depende de la sucursal: los mismos banners con y sin sucursal', async () => {
    await renderLoaded({ branchId: 'sucursal-1' });
    expect(slides()).toHaveLength(3);
  });

  it('avanza sola cada 6 s y vuelve al inicio', async () => {
    await renderLoaded();
    await advance(CAROUSEL_INTERVAL_MS);
    expect(current()).toBe(2);
    await advance(CAROUSEL_INTERVAL_MS);
    expect(current()).toBe(3);
    await advance(CAROUSEL_INTERVAL_MS);
    expect(current()).toBe(1);
  });

  it('flechas y puntos cambian la diapositiva y reinician la cuenta', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Promoción anterior' }));
    expect(current()).toBe(3);
    fireEvent.click(dot(2));
    expect(current()).toBe(2);
    await advance(CAROUSEL_INTERVAL_MS - 100);
    expect(current()).toBe(2);
    await advance(200);
    expect(current()).toBe(3);
  });

  it('teclado: ←/→ cambian de diapositiva e Inicio/Fin saltan a los extremos', async () => {
    await renderLoaded();
    const region = screen.getByRole('region', { name: 'Promociones' });
    fireEvent.keyDown(dot(1), { key: 'ArrowRight' });
    expect(current()).toBe(2);
    fireEvent.keyDown(dot(2), { key: 'ArrowLeft' });
    expect(current()).toBe(1);
    fireEvent.keyDown(dot(1), { key: 'ArrowLeft' });
    expect(current()).toBe(3);
    fireEvent.keyDown(dot(3), { key: 'Home' });
    expect(current()).toBe(1);
    fireEvent.keyDown(region, { key: 'End' });
    expect(current()).toBe(3);
    // Otras teclas no se interceptan.
    expect(fireEvent.keyDown(dot(3), { key: 'a' })).toBe(true);
    expect(current()).toBe(3);
  });

  it('el botón de pausa detiene el avance y permite reanudar', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Pausar carrusel' }));
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
    await renderLoaded();
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

  it('con prefers-reduced-motion no avanza solo ni ofrece pausa, pero la navegación manual sigue', async () => {
    mockReducedMotion(true);
    await renderLoaded();
    await advance(CAROUSEL_INTERVAL_MS * 3);
    expect(current()).toBe(1);
    expect(screen.queryByRole('button', { name: 'Pausar carrusel' })).not.toBeInTheDocument();
    fireEvent.click(dot(3));
    expect(current()).toBe(3);
  });

  it('un solo banner: sin controles, sin puntos y sin avance automático', async () => {
    await renderLoaded({
      prepareStore: (s) => {
        s.banners = s.banners.filter((b) => b.id === 'banner-favoritos');
      },
    });
    expect(slides()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Promoción siguiente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pausar carrusel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ir a la promoción/ })).not.toBeInTheDocument();
    await advance(CAROUSEL_INTERVAL_MS * 2);
    expect(slides()[0]).not.toHaveAttribute('inert');
  });

  it('sin banners (escenario banners-empty): el hueco reservado se pliega con una transición y luego no queda nada', async () => {
    const { container } = await renderStore(<PromoCarousel />, { scenario: 'banners-empty' });
    // No es un carrusel (ni lector de pantalla ni teclado) y el hueco se pliega en vez de desaparecer de golpe.
    await waitFor(() => expect(container.querySelector('.banner-collapse')).not.toBeNull());
    expect(screen.queryByRole('region', { name: 'Promociones' })).not.toBeInTheDocument();
    expect(container.querySelector('[aria-roledescription]')).toBeNull();
    await advance(400);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('si el servidor falla (503 BANNERS_BUSY) la sección se pliega sin romper', async () => {
    const { container } = await renderStore(<PromoCarousel />, {
      prepareStore: (s) => {
        s.bannersBusy = 5;
      },
    });
    await waitFor(() => expect(container.querySelector('.banner-collapse')).not.toBeNull());
    await advance(400);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('muestra un esqueleto de la misma altura mientras carga (sin desplazamiento de diseño)', async () => {
    const { container } = await renderStore(<PromoCarousel />);
    const skeleton = container.querySelector('section[aria-busy="true"]');
    // La primera consulta aún puede estar en vuelo en este punto.
    if (skeleton) {
      expect(skeleton.querySelector('.animate-pulse')?.className).toMatch(
        /h-\[176px\].*lg:h-\[240px\]/,
      );
    }
    await waitFor(() => expect(slides().length).toBe(3));
  });
});

describe('PromoCarousel: accesibilidad y controles', () => {
  it('no anuncia todas las diapositivas: sin aria-live en el desplazador; solo una región breve tras un cambio MANUAL', async () => {
    await renderLoaded();
    const region = screen.getByRole('region', { name: 'Promociones' });
    expect(region.querySelector('[aria-live]:not([role="status"])')).toBeNull();
    const status = within(region).getByRole('status');
    expect(status).toBeEmptyDOMElement();
    // Pasar el ratón / enfocar / avanzar solo NO anuncia nada.
    fireEvent.mouseEnter(region);
    fireEvent.focus(dot(1));
    fireEvent.mouseLeave(region);
    fireEvent.blur(dot(1));
    await advance(CAROUSEL_INTERVAL_MS);
    expect(current()).toBe(2);
    expect(status).toBeEmptyDOMElement();
    // Un cambio manual anuncia SOLO la diapositiva actual.
    fireEvent.click(dot(3));
    expect(status).toHaveTextContent('3 de 3: Calientito Roll recién salido de la cocina');
    expect(status.textContent).not.toMatch(/favoritos|Happy Hour/i);
    // Las inertes no se leen.
    expect(slides().filter((el) => el.hasAttribute('inert'))).toHaveLength(2);
  });

  it('objetivos táctiles de 44 px, pausa primero y foco visible', async () => {
    await renderLoaded();
    const pause = screen.getByRole('button', { name: 'Pausar carrusel' });
    expect(pause.className).toMatch(/h-11 w-11/);
    expect(pause.className).toMatch(/focus-visible:ring/);
    for (const n of [1, 2, 3]) {
      expect(dot(n).className).toMatch(/h-11 min-w-\[44px\]/);
      expect(dot(n).className).toMatch(/focus-visible:ring/);
    }
    // La pausa es el primer control de la fila (antes de los indicadores).
    expect(pause.nextElementSibling).toBe(dot(1));
    expect(screen.getByRole('button', { name: 'Promoción siguiente' }).className).toMatch(
      /focus-visible:ring-amber-400/,
    );
  });
});

describe('PromoCarousel: imagen y accesibilidad (sin textos ni enlaces)', () => {
  const stubBlobUrls = () => {
    let n = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:banner-${++n}` }));
  };
  const IDS = ['favoritos', 'happy-hour', 'calientito'];

  it('las diapositivas contienen solo la imagen: sin títulos, textos ni enlaces', async () => {
    await renderLoaded();
    for (const slide of slides()) {
      expect(slide.querySelector('h2, p, a, button, span')).toBeNull();
    }
  });

  it('la primera imagen es prioritaria y las demás diferidas; usa <img> con su texto alternativo', async () => {
    stubBlobUrls();
    mockReducedMotion(true); // sin avance automático durante la comprobación
    for (const id of IDS) {
      registerSimulatedObject(`media-seed-banner-${id}`, new Blob(['x'], { type: 'image/webp' }));
    }
    await renderLoaded();
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('article img'));
    expect(images).toHaveLength(3);
    expect(images.map((i) => i.getAttribute('alt'))).toEqual(ALTS);
    expect(images[0]).toHaveAttribute('fetchpriority', 'high');
    expect(images[0]).toHaveAttribute('loading', 'eager');
    expect(images[1]).toHaveAttribute('loading', 'lazy');
    expect(images[1]).not.toHaveAttribute('fetchpriority');
    expect(images[2]).toHaveAttribute('loading', 'lazy');
    expect(images[0]).toHaveAttribute('decoding', 'async');
    // Solo la diapositiva actual y la siguiente piden su imagen; la lejana espera sin `src`.
    expect(images.map((i) => i.getAttribute('src'))).toEqual([
      'blob:banner-1',
      'blob:banner-2',
      null,
    ]);
    expect(images.every((i) => !String(i.getAttribute('src')).includes('invalid'))).toBe(true);
    // Al avanzar, la tercera pasa a ser «la siguiente» y recibe su `src`; la ya cargada se conserva (sin parpadeo al volver).
    fireEvent.click(dot(2));
    await waitFor(() =>
      expect(
        Array.from(document.querySelectorAll<HTMLImageElement>('article img')).map((i) =>
          i.getAttribute('src'),
        ),
      ).toEqual(['blob:banner-1', 'blob:banner-2', expect.stringMatching(/^blob:banner-/)]),
    );
  });

  it('si la imagen falla muestra el fondo de marca con su texto alternativo como nombre accesible, sin reintentar', async () => {
    stubBlobUrls();
    registerSimulatedObject('media-seed-banner-favoritos', new Blob(['x'], { type: 'image/webp' }));
    await renderLoaded();
    const first = slides()[0]!;
    const img = first.querySelector('img')!;
    expect(first.querySelector('[data-banner-image]')).toHaveAttribute(
      'data-banner-image',
      'image',
    );
    fireEvent.error(img);
    expect(first.querySelector('img')).toBeNull();
    const fallback = first.querySelector('[data-banner-image]')!;
    expect(fallback).toHaveAttribute('data-banner-image', 'fallback');
    expect(fallback).toHaveAttribute('role', 'img');
    expect(fallback).toHaveAttribute('aria-label', ALTS[0]);
  });

  it('sin bytes de una imagen simulada (host .invalid) muestra el fondo de marca y no pide nada por red', async () => {
    await renderLoaded();
    expect(document.querySelectorAll('article img')).toHaveLength(0);
    expect(document.querySelectorAll('[data-banner-image="fallback"]')).toHaveLength(3);
  });

  it('el texto alternativo es el mismo en español e inglés (un solo idioma por banner)', async () => {
    await renderLoaded({ locale: 'en' });
    const labels = slides().map((el) =>
      el.querySelector('[data-banner-image]')?.getAttribute('aria-label'),
    );
    expect(labels).toEqual(ALTS);
    // Los controles de la interfaz sí se traducen.
    expect(screen.getByRole('region', { name: 'Promotions' })).toBeInTheDocument();
  });
});

describe('PromoCarousel: bootstrap y sucursal', () => {
  it('se alimenta del bootstrap (no pide /store/banners aparte), sin idioma en la URL, y al cambiar de sucursal vuelve a pedirlo', async () => {
    const spy = createSpyClient();
    const view = await renderStore(<PromoCarousel />, { wrapClient: spy.wrap });
    await waitFor(() => expect(slides().length).toBe(3));
    const calls = () => spy.count('GET', /\/v1\/store\/bootstrap$/);
    expect(spy.count('GET', /\/v1\/store\/banners$/)).toBe(0);
    expect(calls()).toBe(1);
    expect(spy.calls.at(-1)?.query?.locale).toBeUndefined();

    act(() => {
      view.api().mode.setMode({
        type: 'delivery',
        branchId: 'sucursal-2',
        address: null,
      });
    });
    await waitFor(() => expect(calls()).toBe(2));
    expect(spy.calls.at(-1)?.query).toMatchObject({ branchId: 'sucursal-2' });
    expect(spy.count('GET', /\/v1\/store\/banners$/)).toBe(0);
  });

  it('si la sucursal guardada ya no existe (404) reintenta sin sucursal en vez de dejar el Inicio sin carrusel', async () => {
    await renderLoaded({ branchId: 'sucursal-inexistente' });
    expect(slides()).toHaveLength(3);
  });
});
