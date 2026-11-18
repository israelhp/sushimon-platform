import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import type { PlaceState } from '../use-place-order';
import { PlacementStatus, placementLiveKey } from './PlacementStatus';

const show = (state: PlaceState, locale: 'es' | 'en' = 'es') =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'en' ? en : es}
      timeZone="America/Guatemala"
    >
      <PlacementStatus
        state={state}
        onRetry={vi.fn()}
        onAcceptChange={vi.fn()}
        onCancelChange={vi.fn()}
        lineName={() => 'Dumplings'}
      />
    </NextIntlClientProvider>,
  );
const failed = (
  failure: PlaceState extends infer S ? (S extends { failure: infer F } ? F : never) : never,
): PlaceState => ({
  status: 'failed',
  failure,
});

describe('PlacementStatus (F20)', () => {
  it('U6: CHECKOUT_BLOCKED lista los bloqueos con su mensaje por código (es/en) y, sin bloqueos, un respaldo claro', () => {
    const blockers = [
      { code: 'BRANCH_CLOSED', scope: 'BRANCH' as const },
      { code: 'UNAVAILABLE', scope: 'LINE' as const, lineIndex: 0 },
    ];
    const { unmount } = show(failed({ kind: 'blocked', blockers }));
    const alert = screen.getByRole('alert');
    expect(within(alert).getAllByRole('listitem')).toHaveLength(2);
    expect(alert).toHaveTextContent(es.checkout.quote.blockers.BRANCH_CLOSED);
    expect(alert).toHaveTextContent(
      es.checkout.quote.blockers.UNAVAILABLE.replace('{name}', 'Dumplings'),
    );
    unmount();
    show(failed({ kind: 'blocked', blockers }), 'en');
    expect(screen.getByRole('alert')).toHaveTextContent(en.checkout.quote.blockers.BRANCH_CLOSED);
  });

  it('U6: sin bloqueos en el cuerpo muestra el respaldo', () => {
    show(failed({ kind: 'blocked', blockers: [] }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Revisa los productos y la entrega de tu pedido.',
    );
  });

  it('U7: el texto de «ambiguo» pide NO volver a crear el pedido y reintentar', () => {
    show(failed({ kind: 'ambiguous' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No vuelvas a crear el pedido: pulsa Reintentar y lo comprobaremos sin duplicarlo.',
    );
    expect(screen.getByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
  });

  it('U4: los avisos blandos (vencida, inválida, clave) NO abren una región viva: se anuncian en la región única del checkout', () => {
    for (const kind of ['quoteExpired', 'quoteInvalid', 'keyReused'] as const) {
      const { container, unmount } = show(failed({ kind }));
      expect(container.querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
      expect(placementLiveKey(failed({ kind }))).toBeTruthy();
      unmount();
    }
    expect(placementLiveKey({ status: 'sending', retrying: true })).toBe('retrying');
    expect(placementLiveKey({ status: 'idle' })).toBeNull();
  });

  it('QUOTE_CHANGED abre un alertdialog con el nuevo total', () => {
    show(
      failed({
        kind: 'quoteChanged',
        changes: [{ field: 'total', previous: '106.00', current: '108.00' }],
        quote: { total: '108.00', quote: { token: 't' } } as never,
      }),
    );
    const dialog = screen.getByRole('alertdialog', { name: 'El total de tu pedido cambió' });
    expect(within(dialog).getByTestId('changed-total')).toHaveTextContent('Q108.00');
    expect(dialog).toHaveTextContent('Antes: Q106.00');
  });
});
