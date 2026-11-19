import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { OrderCreated, OrderReceipt } from '@/lib/data-access/models';
import { withShortcuts, type DataClient, type RequestOptions } from '@/lib/data-access/types';
import { renderStore } from '@/test/store-providers';
import { resetConfirmationMemory, saveConfirmation } from '@/features/checkout/confirmation-store';
import { ReceiptScreen } from './receipt-screen';

/** F23 · recibo NO fiscal imprimible (matriz #53–#56, #78, #80–#82): contenido, ausencia de campos prohibidos, errores y credenciales. */
const HISTORY = '00000000-0000-4000-8000-000000479850';
const DEMO = { email: 'cliente@ejemplo.com', name: 'Cliente Demo' };
type View = Awaited<ReturnType<typeof renderStore>>;
const signIn = (view: View) => act(async () => view.api().session.signInCustomer(DEMO));

const receipt = (over: Partial<OrderReceipt> = {}): OrderReceipt => ({
  fiscalStatus: 'NOT_FISCAL',
  displayNumber: 'MON-001042',
  status: 'delivered',
  publicStatus: 'completed',
  placedAt: '2026-11-18T03:30:00.000Z',
  generatedAt: '2026-11-18T05:00:00.000Z',
  timeZone: 'America/Guatemala',
  currency: 'GTQ',
  branch: { name: 'Sucursal 1', address: 'Vía 5, Zona 4', phone: '2222-3333' },
  fulfillment: { type: 'PICKUP', provider: null },
  address: null,
  contact: { fullName: 'Ana López', phoneMasked: '****1234' },
  lines: [
    {
      productName: 'Dumplings',
      quantity: 2,
      unitPrice: '40.00',
      modifiers: [{ name: 'Salsa extra', extraPrice: '3.00' }],
      extrasPerUnit: '3.00',
      lineSubtotal: '86.00',
      discount: '0.00',
      lineTotal: '86.00',
      notes: 'Sin ajonjolí',
    },
  ],
  promotions: [],
  notes: null,
  subtotal: '86.00',
  extrasTotal: '6.00',
  discountTotal: '0.00',
  deliveryFee: '0.00',
  total: '86.00',
  payment: { methodPreference: 'cash', status: 'NOT_STARTED' },
  ...over,
});

function receiptClient(
  respond: (o: RequestOptions) => OrderReceipt | ApiError,
  log?: { path: string; o: RequestOptions }[],
) {
  return (): DataClient =>
    withShortcuts('http', async <T,>(path: string, o: RequestOptions = {}) => {
      log?.push({ path, o });
      if (!path.endsWith('/receipt')) throw new ApiError(404, 'not_found', path);
      const r = respond(o);
      if (r instanceof ApiError) throw r;
      return r as T;
    });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetConfirmationMemory();
});
afterEach(() => vi.restoreAllMocks());

describe('Recibo (F23) · contenido', () => {
  it('muestra marca, sucursal, número, fecha de Guatemala, líneas con extras y notas, totales en Q, pago honesto y la leyenda no fiscal', async () => {
    const view = await renderStore(<ReceiptScreen orderId={HISTORY} />, {
      wrapClient: receiptClient(() => receipt()),
    });
    await signIn(view);
    expect(await screen.findByTestId('receipt-number')).toHaveTextContent('MON-001042');
    const page = screen.getByTestId('receipt');
    expect(page).toHaveAttribute('data-fiscal', 'NOT_FISCAL');
    expect(page).toHaveTextContent('Sushi Mon');
    expect(page).toHaveTextContent('Sucursal 1');
    expect(page).toHaveTextContent('Vía 5, Zona 4');
    // 2026-11-18T03:30Z = 17 nov 2026, 9:30 p. m. en Guatemala.
    expect(page).toHaveTextContent(/17 nov 2026/);
    expect(page).toHaveTextContent('hora de Guatemala');
    expect(page).toHaveTextContent('2 × Dumplings');
    expect(page).toHaveTextContent('Salsa extra (+Q3.00)');
    expect(page).toHaveTextContent('Nota: Sin ajonjolí');
    expect(screen.getByTestId('receipt-total')).toHaveTextContent('Q86.00');
    expect(screen.getByTestId('receipt-payment')).toHaveTextContent('Sin pago registrado');
    expect(page).toHaveTextContent('Método elegido: efectivo');
    expect(screen.getByTestId('receipt-legend')).toHaveTextContent(
      'Este documento es un recibo informativo del pedido. No es una factura ni un documento fiscal.',
    );
    // Nunca «pagado», factura, NIT, FEL ni SAT.
    expect(page.textContent).not.toMatch(/pagado|NIT|\bFEL\b|\bSAT\b|factura fiscal/i);
    expect(document.title).toBe('Recibo MON-001042');
  });

  it('a domicilio: dirección del snapshot y el proveedor tal cual (PedidosYa sin estados externos); sin entrega propia inventada', async () => {
    const view = await renderStore(<ReceiptScreen orderId={HISTORY} />, {
      wrapClient: receiptClient(() =>
        receipt({
          fulfillment: { type: 'DELIVERY', provider: 'PEDIDOSYA' },
          address: {
            municipalityName: 'Guatemala',
            zone: 'Zona 10',
            addressLine: '6a avenida 10-50',
            referenceNote: 'Portón negro',
          },
          deliveryFee: '15.00',
          total: '101.00',
        }),
      ),
    });
    await signIn(view);
    const page = await screen.findByTestId('receipt');
    expect(page).toHaveTextContent('6a avenida 10-50');
    expect(page).toHaveTextContent('Zona 10');
    expect(page).toHaveTextContent('Referencia: Portón negro');
    expect(page).toHaveTextContent('PedidosYa (servicio externo)');
    expect(page).toHaveTextContent('Entrega');
    expect(page).not.toHaveTextContent('Entrega propia');
  });

  it('descuento y promociones solo cuando existen', async () => {
    const view = await renderStore(<ReceiptScreen orderId={HISTORY} />, {
      wrapClient: receiptClient(() =>
        receipt({
          promotions: [{ name: 'Happy Hour', amount: '10.00' }],
          discountTotal: '10.00',
          total: '76.00',
        }),
      ),
    });
    await signIn(view);
    const page = await screen.findByTestId('receipt');
    expect(page).toHaveTextContent('Happy Hour');
    expect(page).toHaveTextContent('−Q10.00');
    expect(page).toHaveTextContent('Incluye extras: Q6.00');
  });

  it.each([
    ['rejected', 'Este pedido fue rechazado por la sucursal. No hay ningún pago registrado.'],
    ['cancelled', 'Este pedido fue cancelado. No hay ningún pago registrado.'],
  ] as const)('%s: banner con el estado, sin motivo y sin afirmar pago', async (status, text) => {
    const view = await renderStore(<ReceiptScreen orderId={HISTORY} />, {
      wrapClient: receiptClient(() => receipt({ status, publicStatus: status })),
    });
    await signIn(view);
    expect(await screen.findByTestId('receipt-negative')).toHaveTextContent(text);
    expect(screen.getByTestId('receipt-payment')).toHaveTextContent('Sin pago registrado');
    expect(screen.getByTestId('receipt').textContent).not.toMatch(/motivo/i);
  });

  it('rechazado con un estado de pago distinto de NOT_STARTED: texto neutro, nunca «ningún pago registrado»', async () => {
    const view = await renderStore(<ReceiptScreen orderId={HISTORY} />, {
      wrapClient: receiptClient(() =>
        receipt({
          status: 'rejected',
          publicStatus: 'rejected',
          payment: { methodPreference: null, status: 'PAID' as unknown as 'NOT_STARTED' },
        }),
      ),
    });
    await signIn(view);
    const banner = await screen.findByTestId('receipt-negative');
    expect(banner).toHaveTextContent('Este pedido fue rechazado por la sucursal.');
    expect(banner).toHaveTextContent('Consulta el estado del pago con la sucursal');
    expect(banner.textContent).not.toMatch(/ningún pago/i);
    expect(screen.getByTestId('receipt-payment')).not.toHaveTextContent('Sin pago registrado');
  });

  it('el DOM no contiene tokens, ids internos, correo ni teléfono completo; el teléfono llega enmascarado', async () => {
    const view = await renderStore(<ReceiptScreen orderId={HISTORY} />, {
      wrapClient: receiptClient(() => receipt()),
    });
    await signIn(view);
    await screen.findByTestId('receipt');
    const html = screen.getByTestId('receipt').innerHTML;
    expect(html).not.toContain('smo_');
    expect(html).not.toContain(HISTORY);
    expect(html).not.toMatch(/@/);
    expect(html).not.toContain('5555-1234');
    expect(screen.getByTestId('receipt')).toHaveTextContent('****1234');
  });

  it('en inglés: leyenda, pago y estado traducidos', async () => {
    const view = await renderStore(<ReceiptScreen orderId={HISTORY} />, {
      locale: 'en',
      wrapClient: receiptClient(() => receipt()),
    });
    await signIn(view);
    expect(await screen.findByTestId('receipt-legend')).toHaveTextContent(
      'This document is an informational receipt for the order. It is not an invoice or a tax document.',
    );
    expect(screen.getByTestId('receipt-payment')).toHaveTextContent('No payment recorded');
    expect(screen.getByTestId('print-receipt')).toHaveTextContent('Print / save as PDF');
    expect(document.title).toBe('Receipt MON-001042');
  });

  it('contra el mock real (pedido histórico de la cuenta demo): recibo con PedidosYa y los snapshots', async () => {
    const view = await renderStore(<ReceiptScreen orderId={HISTORY} />);
    await signIn(view);
    expect(await screen.findByTestId('receipt-number')).toHaveTextContent('MON-479850');
    expect(screen.getByTestId('receipt')).toHaveTextContent('Roll de Temporada');
    expect(screen.getByTestId('receipt')).toHaveTextContent('PedidosYa (servicio externo)');
    expect(screen.getByText('Simulación')).toBeInTheDocument();
  });
});

describe('Recibo (F23) · impresión y almacenamiento', () => {
  it('window.print() solo se llama desde el botón; sin escrituras de recibo en localStorage/sessionStorage ni descargas', async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const createUrl = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl }));
    const view = await renderStore(<ReceiptScreen orderId={HISTORY} />, {
      wrapClient: receiptClient(() => receipt()),
    });
    await signIn(view);
    await screen.findByTestId('receipt');
    expect(print).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('print-receipt'));
    expect(print).toHaveBeenCalledTimes(1);
    expect(setItem.mock.calls.some(([, value]) => String(value).includes('MON-001042'))).toBe(
      false,
    );
    expect(createUrl).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
    // Los controles se ocultan al imprimir.
    expect(screen.getByTestId('print-receipt').closest('[data-print-hide]')).not.toBeNull();
    expect(screen.getByTestId('receipt-legend').closest('[data-print-hide]')).toBeNull();
  });
});

describe('Recibo (F23) · credenciales y errores', () => {
  it('invitado: la credencial viaja SOLO en X-Order-Token (nunca en la URL ni en la clave de caché)', async () => {
    const log: { path: string; o: RequestOptions }[] = [];
    const token = `smo_${'a'.repeat(43)}`;
    const created = {
      order: { id: HISTORY, displayNumber: 'MON-001042' },
      access: { guestToken: token, expiresAt: '2099-01-01T00:00:00.000Z' },
    } as unknown as OrderCreated;
    saveConfirmation(created);
    const view = await renderStore(<ReceiptScreen orderId={HISTORY} />, {
      wrapClient: receiptClient(() => receipt(), log),
    });
    await screen.findByTestId('receipt');
    const calls = log.filter((c) => c.path.endsWith('/receipt'));
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) {
      expect(call.path).toBe(`/v1/orders/${HISTORY}/receipt`);
      expect(call.o.headers).toEqual({ 'X-Order-Token': token });
    }
    expect(log.some((c) => c.path.includes('smo_'))).toBe(false);
    const keys = view.queryClient
      .getQueryCache()
      .getAll()
      .map((q) => JSON.stringify(q.queryKey));
    expect(keys.some((k) => k.includes('smo_'))).toBe(false);
    expect(keys).toContain(JSON.stringify(['orders', 'receipt', 'guest', HISTORY]));
  });

  it('sin sesión ni credencial: «no pudimos mostrar este recibo» y NINGUNA solicitud', async () => {
    const log: { path: string; o: RequestOptions }[] = [];
    await renderStore(<ReceiptScreen orderId={HISTORY} />, {
      wrapClient: receiptClient(() => receipt(), log),
    });
    expect(await screen.findByTestId('receipt-lost')).toHaveTextContent(
      'No pudimos mostrar este recibo',
    );
    expect(log.filter((c) => c.path.endsWith('/receipt'))).toHaveLength(0);
  });

  it('con sesión la clave es [orders, receipt, scope, id]', async () => {
    const view = await renderStore(<ReceiptScreen orderId={HISTORY} />, {
      wrapClient: receiptClient(() => receipt()),
    });
    await signIn(view);
    await screen.findByTestId('receipt');
    const keys = view.queryClient
      .getQueryCache()
      .getAll()
      .map((q) => JSON.stringify(q.queryKey));
    expect(keys).toContain(
      JSON.stringify(['orders', 'receipt', 'demo:cliente@ejemplo.com', HISTORY]),
    );
  });

  it.each([
    [401, /No pudimos mostrar este recibo/],
    [404, /No pudimos mostrar este recibo/],
  ])(
    '%s: acceso perdido (definitivo), sin reintento y sin pintar un estado del pedido',
    async (status, text) => {
      const view = await renderStore(<ReceiptScreen orderId={HISTORY} />, {
        wrapClient: receiptClient(() => new ApiError(status, 'x', 'no')),
      });
      await signIn(view);
      expect(await screen.findByTestId('receipt-lost')).toHaveTextContent(text);
      expect(screen.queryByTestId('receipt')).not.toBeInTheDocument();
      expect(screen.queryByTestId('print-receipt')).not.toBeInTheDocument();
    },
  );

  it('429: espera Retry-After; 503: «ocupado» con Reintentar; ambos sin convertirse en un estado de negocio', async () => {
    const user = userEvent.setup();
    let mode: 'limited' | 'busy' | 'ok' = 'limited';
    const view = await renderStore(<ReceiptScreen orderId={HISTORY} />, {
      wrapClient: receiptClient(() =>
        mode === 'limited'
          ? new ApiError(
              429,
              'too_many_requests',
              'x',
              undefined,
              undefined,
              'RATE_LIMITED',
              undefined,
              4,
            )
          : mode === 'busy'
            ? new ApiError(503, 'server_error', 'x', undefined, undefined, 'ORDERS_BUSY')
            : receipt(),
      ),
    });
    await signIn(view);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('demasiadas consultas');
    expect(within(alert).getByRole('button')).toHaveAttribute('aria-disabled', 'true');
    mode = 'busy';
    await act(async () => {
      await view.queryClient.refetchQueries({ queryKey: ['orders', 'receipt'] });
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('El servicio está ocupado'),
    );
    mode = 'ok';
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByTestId('receipt')).toBeVisible();
  });
});
