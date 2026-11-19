import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { CheckoutQuote, CheckoutQuoteRequest } from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';
import { withShortcuts, type DataClient, type RequestOptions } from '@/lib/data-access/types';
import type { MockScenario } from '@/mocks/scenarios';
import type { MockStore } from '@/mocks/store';
import { cartInput } from '@/test/cart';
import { renderStore } from '@/test/store-providers';
import { CheckoutPage } from './CheckoutPage';

const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/checkout',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: routerReplace }),
}));

/** F19 · estados de la cotización en el checkout, con la respuesta del mock ajustada por prueba (paridad de forma). */
type Patch = (quote: CheckoutQuote, callIndex: number, body: CheckoutQuoteRequest) => CheckoutQuote;
interface Tap {
  bodies: CheckoutQuoteRequest[];
  /** Solicitudes a `POST /v1/orders` (F20): ruta, clave de idempotencia y cuerpo. */
  orderCalls: string[];
  orderRequests: { key: string; body: { quoteToken: string } & Record<string, unknown> }[];
  /** Retiene la respuesta de la llamada `n` (1-based) hasta `release()`. */
  hold: (n: number) => () => void;
  wrapClient: (base: DataClient) => DataClient;
}
function tap({
  patch,
  kind = 'mock',
  failWith,
}: {
  patch?: Patch;
  kind?: 'mock' | 'http';
  failWith?: (n: number, body: CheckoutQuoteRequest) => ApiError | null;
} = {}): Tap {
  const bodies: CheckoutQuoteRequest[] = [];
  const holds = new Map<number, Promise<void>>();
  const orderCalls: string[] = [];
  const orderRequests: Tap['orderRequests'] = [];
  return {
    bodies,
    orderCalls,
    orderRequests,
    hold: (n) => {
      let release!: () => void;
      holds.set(n, new Promise<void>((r) => (release = r)));
      return release;
    },
    wrapClient: (base) =>
      withShortcuts(kind, async <T,>(path: string, options: RequestOptions = {}) => {
        if (path === '/v1/orders' && options.method === 'POST') {
          orderCalls.push(path);
          orderRequests.push({
            key: options.headers?.['Idempotency-Key'] ?? '',
            body: options.body as Tap['orderRequests'][number]['body'],
          });
        }
        if (path !== paths.checkoutQuote()) return base.request<T>(path, options);
        const n = bodies.push(options.body as CheckoutQuoteRequest);
        await holds.get(n);
        const error = failWith?.(n, options.body as CheckoutQuoteRequest);
        if (error) throw error;
        const quote = await base.request<CheckoutQuote>(path, options);
        return (patch ? patch(quote, n, options.body as CheckoutQuoteRequest) : quote) as T;
      }),
  };
}

beforeEach(() => {
  routerReplace.mockClear();
  delete window.__sushimonMockFaults;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
});

async function openCheckout(
  t: Tap,
  {
    type = 'pickup',
    lines = [['dumplings', 1]],
    scenario,
    locale,
    prepareStore,
  }: {
    type?: 'pickup' | 'delivery';
    lines?: [string, number][];
    scenario?: MockScenario;
    locale?: 'es' | 'en';
    prepareStore?: (s: MockStore) => void;
  } = {},
) {
  const view = await renderStore(<CheckoutPage />, {
    wrapClient: t.wrapClient,
    scenario,
    locale,
    prepareStore,
  });
  await act(async () => {
    for (const [id, qty] of lines) view.api().cart.add(cartInput(id, qty));
    view.api().mode.setMode({ type, when: { kind: 'now' }, branchId: 'sucursal-1', address: null });
  });
  return view;
}
const btn = (name: RegExp) => screen.getAllByRole('button', { name })[0]!;
const next = async (user: UserEvent, name: RegExp) => {
  await waitFor(() => expect(btn(name)).not.toHaveAttribute('aria-disabled', 'true'));
  await user.click(btn(name));
};
async function toShipping(user: UserEvent) {
  await next(user, /Continuar a entrega/i);
  await next(user, /Continuar a envío/i);
  await screen.findByRole('heading', { level: 1, name: 'Envío' });
}
async function toStep3(user: UserEvent) {
  await next(user, /Continuar a entrega/i);
  await next(user, /Continuar a envío/i);
  await screen.findByRole('heading', { level: 1, name: 'Envío' });
}
const total = () => screen.getAllByTestId('summary-total')[0]!;
const patchLine = (
  q: CheckoutQuote,
  over: Partial<CheckoutQuote['lines'][number]>,
): CheckoutQuote => ({
  ...q,
  lines: q.lines.map((l, i) => (i === 0 ? { ...l, ...over } : l)),
});

/** Borrador con contacto válido (con la API real no hay datos de demostración que lo precarguen). */
const seedDraft = (step: number, payment: 'card' | 'cash' = 'cash') =>
  window.sessionStorage.setItem(
    'monsushi-checkout-v1',
    JSON.stringify({
      step,
      contact: { name: 'Ana López', phone: '5555-1234', email: 'ana@ejemplo.com' },
      address: {
        department: 'Guatemala',
        municipality: 'Guatemala',
        zone: '10',
        line: '6a avenida 10-50',
        references: '',
      },
      addressId: 'other',
      payment,
    }),
  );
const blockedBtn = (name: RegExp) => expect(btn(name)).toHaveAttribute('aria-disabled', 'true');
const live = () => screen.getByTestId('quote-live');

async function toPay(user: UserEvent) {
  for (const name of ['entrega', 'envío', 'pago']) {
    await next(user, new RegExp(`Continuar a ${name}`, 'i'));
  }
}

/** U1: el checkout NO renderiza «pedido recibido»: anuncia en la región viva única y navega a `/pedidos/[id]` (dueño único). */
const received = async (text = 'Recibimos tu pedido') => {
  await waitFor(() => expect(screen.getByTestId('quote-live')).toHaveTextContent(text), {
    timeout: 8000,
  });
  await waitFor(
    () => expect(routerReplace).toHaveBeenCalledWith(expect.stringMatching(/^\/pedidos\/0000/)),
    { timeout: 8000 },
  );
  expect(routerReplace).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('order-received')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: /Recibimos tu pedido|received your order/i }),
  ).not.toBeInTheDocument();
};

describe('checkout · cotización del servidor (F19)', () => {
  it('cargando: esqueleto, importes aún no definitivos, región en vivo «Actualizando importes…» y «Continuar» bloqueado con su motivo', async () => {
    const user = userEvent.setup();
    const t = tap();
    const release = t.hold(1);
    await openCheckout(t);
    await next(user, /Continuar a entrega/i);
    await next(user, /Continuar a envío/i);
    await screen.findByRole('heading', { level: 1, name: 'Envío' });
    expect(screen.getAllByTestId('summary-skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('summary-total')).not.toBeInTheDocument();
    expect(live()).toHaveTextContent('Actualizando importes…');
    blockedBtn(/Continuar a pago/i);
    // A1: aria-disabled (NO disabled: sigue enfocable) y el motivo visible está enlazado con aria-describedby.
    expect(btn(/Continuar a pago/i)).not.toBeDisabled();
    const reasonId = btn(/Continuar a pago/i).getAttribute('aria-describedby')!;
    expect(document.getElementById(reasonId)).toHaveTextContent('Calculando importes…');
    await act(async () => release());
    await waitFor(() =>
      expect(btn(/Continuar a pago/i)).not.toHaveAttribute('aria-disabled', 'true'),
    );
    expect(total()).toHaveTextContent('Q53.00');
    expect(live()).toHaveTextContent('Total actualizado: Q53.00');
    expect(screen.queryByTestId('summary-skeleton')).not.toBeInTheDocument();
  });

  it('A1: bloqueado y «Continuar» → el foco va al primer bloqueo; solo calculando, a la frase del motivo; no avanza', async () => {
    const user = userEvent.setup();
    const t = tap({
      patch: (q) => ({
        ...q,
        total: null,
        canProceed: false,
        blockers: [{ code: 'DELIVERY_UNAVAILABLE', scope: 'FULFILLMENT' }],
      }),
    });
    await openCheckout(t, { type: 'delivery' });
    await toStep3(user);
    const alert = await screen.findByRole('alert');
    await waitFor(() =>
      expect(btn(/Continuar a pago/i).getAttribute('aria-describedby')).toBeTruthy(),
    );
    expect(
      document.getElementById(btn(/Continuar a pago/i).getAttribute('aria-describedby')!),
    ).toHaveTextContent('Hay un problema con tu pedido: revísalo arriba.');
    await user.click(btn(/Continuar a pago/i));
    expect(alert).toHaveFocus();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Envío');
  });

  it('vigente: los importes son los del servidor, el cuerpo no lleva importes y se rotula «Simulación»', async () => {
    const user = userEvent.setup();
    const t = tap();
    await openCheckout(t, { lines: [['dumplings', 2]] });
    await toShipping(user);
    await waitFor(() => expect(total()).toHaveTextContent('Q106.00'));
    const summary = screen.getAllByRole('region', { name: /Resumen/i })[0]!;
    expect(within(summary).getByText('Simulación')).toBeInTheDocument();
    expect(within(summary).getByTestId('summary-fee')).toHaveTextContent('Sin costo');
    // M1: ni el desglose ni el resumen llevan regiones en vivo propias.
    expect(summary.querySelector('[aria-live], [role="status"]')).toBeNull();
    const body = t.bodies.at(-1)!;
    expect(body.fulfillment).toEqual({ type: 'PICKUP' });
    expect(body.cart.lines).toEqual([{ productId: 'dumplings', quantity: 2, selections: [] }]);
    expect(body.clientView?.lines).toEqual([{ index: 0, unitPrice: '53.00' }]);
    expect(JSON.stringify(body)).not.toMatch(/"(price|fee|total|discount)"/);
  });

  it('A2: al recotizar se conserva la última respuesta atenuada y «Actualizando…», el botón sigue bloqueado y no se muestra como vigente', async () => {
    const user = userEvent.setup();
    const t = tap();
    const view = await openCheckout(t, { lines: [['dumplings', 1]] });
    await toShipping(user);
    await waitFor(() => expect(total()).toHaveTextContent('Q53.00'));
    const release = t.hold(t.bodies.length + 1);
    const lineId = view.api().cart.lines[0]!.lineId;
    await act(async () => view.api().cart.increment(lineId));
    await waitFor(() =>
      expect(screen.getAllByTestId('summary-updating')[0]).toHaveTextContent('Actualizando…'),
    );
    // Sigue visible el último total de la misma sesión, atenuado, pero NO habilita nada.
    expect(total()).toHaveTextContent('Q53.00');
    expect(total().closest('[data-updating]')).not.toBeNull();
    blockedBtn(/Continuar a pago/i);
    expect(live()).toHaveTextContent('Actualizando importes…');
    await act(async () => release());
    await waitFor(() => expect(total()).toHaveTextContent('Q106.00'));
    expect(screen.queryByTestId('summary-updating')).not.toBeInTheDocument();
    // M6: el cambio de total se muestra y se anuncia.
    expect(screen.getAllByTestId('summary-total-changed')[0]).toHaveTextContent(
      'Total actualizado: de Q53.00 a Q106.00',
    );
    expect(live()).toHaveTextContent('Total actualizado: Q106.00');
  });

  it('precio cambiado: aviso con la diferencia, no bloquea, NO toca el carrito hasta «Actualizar precio» y recotiza', async () => {
    const user = userEvent.setup();
    const t = tap({
      patch: (q, n) =>
        n === 1
          ? {
              ...patchLine(q, { status: 'PRICE_CHANGED', previousUnitPrice: '50.00' }),
              notices: [{ code: 'PRICE_CHANGED', lineIndex: 0 }],
            }
          : q,
    });
    const view = await openCheckout(t);
    await toShipping(user);
    const notice = await screen.findByText(/el precio cambió de Q50\.00 a Q53\.00 por unidad/);
    expect(notice).toBeInTheDocument();
    expect(btn(/Continuar a pago/i)).not.toHaveAttribute('aria-disabled', 'true');
    expect(view.api().cart.lines[0]!.display.unitCents).toBe(5300);
    const calls = t.bodies.length;
    await user.click(screen.getByRole('button', { name: /Actualizar el precio de Dumplings/ }));
    await waitFor(() => expect(t.bodies.length).toBeGreaterThan(calls));
    await waitFor(() => expect(screen.queryByText(/el precio cambió de/)).not.toBeInTheDocument());
  });

  it('línea agotada en el servidor: total «—», bloqueo con su motivo, «Continuar» bloqueado y «Revisar mi pedido» lleva al paso 1', async () => {
    const user = userEvent.setup();
    const t = tap({
      patch: (q) => ({
        ...patchLine(q, {
          status: 'UNAVAILABLE',
          unitPrice: null,
          extrasPerUnit: null,
          lineSubtotal: null,
          discount: null,
          lineTotal: null,
        }),
        total: null,
        canProceed: false,
        blockers: [{ code: 'UNAVAILABLE', scope: 'LINE', lineIndex: 0 }],
      }),
    });
    await openCheckout(t);
    await toStep3(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Dumplings: agotado en esta sucursal.');
    expect(total()).toHaveTextContent('—');
    expect(screen.getAllByText('El total aún no se puede calcular.').length).toBeGreaterThan(0);
    blockedBtn(/Continuar a pago/i);
    await user.click(within(alert).getByRole('button', { name: 'Revisar mi pedido' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tu pedido' })).toBeInTheDocument();
  });

  it('dirección incompleta: bloqueo propio con «Completar dirección» y sin total', async () => {
    const user = userEvent.setup();
    const t = tap({
      patch: (q) => ({
        ...q,
        deliveryFee: null,
        total: null,
        canProceed: false,
        blockers: [{ code: 'ADDRESS_INCOMPLETE', scope: 'FULFILLMENT' }],
      }),
    });
    await openCheckout(t, { type: 'delivery' });
    await toStep3(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Falta la zona o el municipio de tu dirección.');
    blockedBtn(/Continuar a pago/i);
    await user.click(within(alert).getByRole('button', { name: 'Completar dirección' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrega' })).toBeInTheDocument();
  });

  it('a domicilio: radios nativos; PedidosYa «Por verificar» deshabilitado, sin tarifa y sin solicitudes; el foco se conserva al recotizar', async () => {
    const user = userEvent.setup();
    const t = tap();
    const view = await openCheckout(t, { type: 'delivery' });
    await toStep3(user);
    const own = await screen.findByRole('radio', { name: /Entrega propia/ });
    const py = screen.getByRole('radio', { name: /PedidosYa/ });
    expect(own).toBeChecked();
    expect(own).toHaveAttribute('data-status', 'available');
    expect(py).not.toBeChecked();
    expect(py).toBeDisabled();
    expect(py).toHaveAccessibleName(expect.stringContaining('Por verificar'));
    expect(py).not.toHaveAccessibleName(expect.stringContaining('Disponible'));
    expect(py).not.toHaveAccessibleName(expect.stringContaining('Tarifa'));
    // M4: el nombre no repite el grupo ni lleva «Seleccionada».
    expect(own).not.toHaveAccessibleName(expect.stringContaining('Seleccionada'));
    const calls = t.bodies.length;
    await user.click(py);
    expect(t.bodies.length).toBe(calls);
    // Recalcular (cambia el carrito) con el foco en el radio: las opciones siguen montadas y el foco no se pierde.
    const release = t.hold(calls + 1);
    own.focus();
    await act(async () => view.api().cart.increment(view.api().cart.lines[0]!.lineId));
    await waitFor(() => expect(t.bodies.length).toBe(calls + 1));
    expect(screen.getByRole('radio', { name: /Entrega propia/ })).toBe(own);
    expect(own).toHaveFocus();
    expect(own.closest('fieldset')).toHaveAttribute('aria-busy', 'true');
    await act(async () => release());
    await waitFor(() => expect(own.closest('fieldset')).not.toHaveAttribute('aria-busy'));
    expect(own).toBeChecked();
    expect(own).toHaveFocus();
  });

  it('M5: aunque el servidor marcara PedidosYa como seleccionable, no se puede elegir ni se presenta como disponible', async () => {
    const user = userEvent.setup();
    const t = tap({
      patch: (q) => ({
        ...q,
        fulfillment: {
          ...q.fulfillment,
          delivery: q.fulfillment.delivery && {
            ...q.fulfillment.delivery,
            options: q.fulfillment.delivery.options.map((o) =>
              o.provider === 'PEDIDOSYA'
                ? {
                    ...o,
                    selectable: true,
                    coverageStatus: 'AVAILABLE' as const,
                    customerFee: '10.00',
                  }
                : o,
            ),
          },
        },
      }),
    });
    await openCheckout(t, { type: 'delivery' });
    await toStep3(user);
    const py = await screen.findByRole('radio', { name: /PedidosYa/ });
    expect(py).toBeDisabled();
    expect(py).not.toHaveAccessibleName(expect.stringContaining('Tarifa'));
    expect(py).not.toHaveAccessibleName(expect.stringContaining('Disponible'));
    expect(screen.queryByText(/integración pendiente de documentación/)).not.toBeInTheDocument();
    expect(screen.getByText('Entrega con PedidosYa: aún no disponible.')).toBeInTheDocument();
  });

  it('error de API: mensaje claro, «Continuar» bloqueado con motivo y «Reintentar» recotiza', async () => {
    const user = userEvent.setup();
    const t = tap({
      failWith: (n) =>
        n === 1
          ? new ApiError(422, 'unprocessable', 'x', undefined, undefined, 'BRANCH_NOT_AVAILABLE')
          : null,
    });
    await openCheckout(t);
    await next(user, /Continuar a entrega/i);
    await next(user, /Continuar a envío/i);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Esta sucursal no está disponible. Elige otra sucursal.');
    blockedBtn(/Continuar a pago/i);
    expect(live()).toHaveTextContent('Error: no se pudo calcular el total.');
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() =>
      expect(btn(/Continuar a pago/i)).not.toHaveAttribute('aria-disabled', 'true'),
    );
    expect(t.bodies).toHaveLength(2);
  });

  it('429 sin cupón: «Reintentar» espera (aria-disabled) y no se reintenta solo', async () => {
    const user = userEvent.setup();
    const t = tap({
      failWith: () =>
        new ApiError(
          429,
          'too_many_requests',
          'x',
          undefined,
          undefined,
          'RATE_LIMITED',
          undefined,
          3,
        ),
    });
    await openCheckout(t);
    await next(user, /Continuar a entrega/i);
    await next(user, /Continuar a envío/i);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Demasiados intentos');
    const retry = within(alert).getByRole('button', { name: /Reintentar en \d s/ });
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    await user.click(retry);
    expect(t.bodies).toHaveLength(1);
  });

  it('A3 cupón: no cotiza al escribir; «Aplicar»/Enter aplica; NOT_APPLIED genérico con aria-invalid solo tras responder; «Quitar»', async () => {
    const user = userEvent.setup();
    const t = tap();
    await openCheckout(t, { lines: [['dumplings', 2]] });
    await toShipping(user);
    await waitFor(() =>
      expect(btn(/Continuar a pago/i)).not.toHaveAttribute('aria-disabled', 'true'),
    );
    const input = screen.getByLabelText(/Cupón de descuento/);
    const calls = t.bodies.length;
    await user.type(input, 'xxxx');
    // Escribir NO cotiza ni bloquea «Continuar», y todavía no hay error en el campo.
    expect(t.bodies.length).toBe(calls);
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(btn(/Continuar a pago/i)).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(await screen.findByText('Este cupón no es válido para tu pedido.')).toBeInTheDocument();
    expect(t.bodies.map((b) => b.couponCode).filter(Boolean)).toEqual(['XXXX']);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('data-skip-focus');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    expect(btn(/Continuar a pago/i)).not.toHaveAttribute('aria-disabled', 'true');

    // Quitar: vuelve a cotizar sin cupón y limpia el campo.
    await user.click(screen.getByRole('button', { name: 'Quitar' }));
    await waitFor(() => expect(t.bodies.at(-1)?.couponCode).toBeUndefined());
    expect(input).toHaveValue('');
    expect(input).not.toHaveAttribute('aria-invalid');

    // Enter aplica un cupón válido.
    await user.type(input, 'bienvenido10{Enter}');
    await screen.findByText('Cupón aplicado.');
    expect(screen.getAllByTestId('summary-discount')[0]).toHaveTextContent('−Q10.60');
    expect(total()).toHaveTextContent('Q95.40');
    expect(screen.getAllByTestId('summary-total-changed')[0]).toHaveTextContent(
      'de Q106.00 a Q95.40',
    );
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('A3: un 429 de la cotización CON cupón es un error LOCAL del campo y la cotización sin cupón sigue habilitada', async () => {
    const user = userEvent.setup();
    const t = tap({
      failWith: (_n, body) =>
        body.couponCode
          ? new ApiError(
              429,
              'too_many_requests',
              'x',
              undefined,
              undefined,
              'RATE_LIMITED',
              undefined,
              5,
            )
          : null,
    });
    await openCheckout(t);
    await toShipping(user);
    await waitFor(() =>
      expect(btn(/Continuar a pago/i)).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await user.type(screen.getByLabelText(/Cupón de descuento/), 'BIENVENIDO10');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(await screen.findByText(/Demasiados intentos con cupones/)).toBeInTheDocument();
    // La cotización sin cupón es la vigente: sin alerta global y con «Continuar» habilitado.
    await waitFor(() =>
      expect(btn(/Continuar a pago/i)).not.toHaveAttribute('aria-disabled', 'true'),
    );
    expect(screen.queryByText(/Demasiados intentos\. Espera/)).not.toBeInTheDocument();
    expect(t.bodies.at(-1)?.couponCode).toBeUndefined();
  });

  it('cotización vencida: aviso, «Continuar» bloqueado, recotiza sola y vuelve a habilitar', async () => {
    const user = userEvent.setup();
    const t = tap({
      patch: (q, n) =>
        n === 1
          ? {
              ...q,
              quote: {
                ...q.quote,
                expiresAt: new Date(Date.parse(q.quote.generatedAt) + 1200).toISOString(),
              },
            }
          : q,
    });
    await openCheckout(t);
    await next(user, /Continuar a entrega/i);
    await next(user, /Continuar a envío/i);
    await waitFor(() =>
      expect(btn(/Continuar a pago/i)).not.toHaveAttribute('aria-disabled', 'true'),
    );
    const release = t.hold(2);
    expect(
      (await screen.findAllByText('La cotización venció. Calculando de nuevo…')).length,
    ).toBeGreaterThan(0);
    blockedBtn(/Continuar a pago/i);
    await act(async () => release());
    await waitFor(() =>
      expect(btn(/Continuar a pago/i)).not.toHaveAttribute('aria-disabled', 'true'),
    );
  });

  it('M3: elegir otra sucursal en Envío no cambia el radio hasta confirmar el cambio del carrito; el aviso recibe el foco y bloquea', async () => {
    const user = userEvent.setup();
    const t = tap();
    const view = await openCheckout(t);
    await toShipping(user);
    await waitFor(() => expect(total()).toHaveTextContent('Q53.00'));
    await user.click(screen.getByRole('radio', { name: /Sucursal 2/ }));
    expect(view.api().mode.mode.branchId).toBe('sucursal-2');
    expect(screen.getByRole('radio', { name: /Sucursal 1/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /Sucursal 2/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    const notice = await screen.findByText(/El carrito es de otra sucursal/);
    expect(notice.closest('[data-focus-error]')).not.toBeNull();
    blockedBtn(/Continuar a pago/i);
    expect(
      document.getElementById(btn(/Continuar a pago/i).getAttribute('aria-describedby')!),
    ).toHaveTextContent('Resuelve el cambio de sucursal');
  });

  it('B1: sucursal cerrada con la API real (sin «Programar»): pista «Elige otra sucursal» y botón a la lista', async () => {
    const user = userEvent.setup();
    seedDraft(3);
    const t = tap({ kind: 'http' });
    await openCheckout(t, { scenario: 'branch-closed' });
    await screen.findByRole('heading', { level: 1, name: 'Envío' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('La sucursal está cerrada en este momento');
    expect(within(alert).queryByRole('button', { name: 'Programar' })).not.toBeInTheDocument();
    expect(alert).toHaveTextContent('Elige otra sucursal que esté abierta.');
    await user.click(within(alert).getByRole('button', { name: 'Ver sucursales' }));
    expect(document.getElementById('checkout-branch-list')).toHaveFocus();
  });

  it('M2: «Datos de demostración» en la lista de sucursales solo con datos simulados', async () => {
    seedDraft(3);
    const t = tap({ kind: 'http' });
    await openCheckout(t);
    await screen.findByRole('heading', { level: 1, name: 'Envío' });
    expect(screen.queryByText('Datos de demostración')).not.toBeInTheDocument();
  });

  it('es/en: los bloqueos se traducen por código estable', async () => {
    const user = userEvent.setup();
    const t = tap({
      patch: (q) => ({
        ...q,
        total: null,
        canProceed: false,
        blockers: [{ code: 'DELIVERY_UNAVAILABLE', scope: 'FULFILLMENT' }],
      }),
    });
    await openCheckout(t, { type: 'delivery', locale: 'en' });
    await next(user, /Continue to delivery/i);
    await next(user, /Continue to shipping/i);
    expect(
      await screen.findByText(/Home delivery is not available for this address/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pick up at the branch' })).toBeInTheDocument();
    expect(screen.getByTestId('quote-live')).toBeInTheDocument();
  });

  it('con la API real (http) el horario programado se deshabilita con aviso (P42) y no hay rótulo de simulación en Entrega', async () => {
    const user = userEvent.setup();
    const t = tap({ kind: 'http' });
    await openCheckout(t);
    await next(user, /Continuar a entrega/i);
    expect(screen.getByRole('button', { name: 'Programar' })).toBeDisabled();
    expect(screen.getByText('Programar pedidos estará disponible pronto.')).toBeInTheDocument();
    const summary = screen.getAllByRole('region', { name: /Resumen/i })[0]!;
    expect(within(summary).queryByText('Simulación')).not.toBeInTheDocument();
  });

  /** Con la API real (`http`) hasta «Confirmación» con efectivo; el pedido se confirma contra el mock de `POST /v1/orders`. */
  async function toReviewHttp(t: Tap) {
    const user = userEvent.setup();
    seedDraft(4);
    await openCheckout(t);
    await screen.findByRole('heading', { level: 1, name: 'Pago' });
    await next(user, /Continuar a confirmación/i);
    await screen.findByRole('heading', { level: 1, name: 'Confirmación' });
    return user;
  }

  it('F24 (http): Pago ofrece SOLO efectivo (sin elegir), sin «Simulación», con la instrucción y sin tarjeta ni transferencia', async () => {
    seedDraft(4);
    await openCheckout(tap({ kind: 'http' }));
    await screen.findByRole('heading', { level: 1, name: 'Pago' });
    const region = screen.getByRole('region', { name: 'Pago' });
    expect(within(region).queryByText('Simulación')).not.toBeInTheDocument();
    expect(within(region).queryAllByRole('radio')).toHaveLength(0);
    expect(within(region).getByText('Efectivo')).toBeInTheDocument();
    expect(
      within(region).getByText(/Realiza el pago en efectivo cuando recojas tu pedido/),
    ).toBeInTheDocument();
    expect(region.textContent).not.toMatch(/tarjeta|transferencia|neonet|comprobante/i);
  });

  it('F20 (http): la confirmación ya no dice «próximamente» ni «Simulación»; confirma con el quoteToken, la clave y el cuerpo sin importes', async () => {
    const t = tap({ kind: 'http' });
    const user = await toReviewHttp(t);
    expect(screen.queryByText('Simulación')).not.toBeInTheDocument();
    expect(screen.queryByText(/estará disponible próximamente/)).not.toBeInTheDocument();
    const place = btn(/Realizar pedido/);
    await waitFor(() => expect(place).not.toHaveAttribute('aria-disabled', 'true'));
    await user.click(place);
    await received();
    expect(t.orderRequests).toHaveLength(1);
    const { key, body } = t.orderRequests[0]!;
    expect(key).toMatch(/^[A-Za-z0-9_-]{22,128}$/);
    expect(body.quoteToken).toMatch(/^mockq\./);
    expect(body.paymentMethodPreference).toBe('cash');
    expect(body.contact).toMatchObject({ fullName: 'Ana López', phone: '5555-1234' });
    expect(JSON.stringify(body)).not.toMatch(/"(total|price|subtotal|deliveryFee|status|paid)"/);
  });

  it('F20: éxito => carrito vacío y la clave de intento descartada; la credencial de invitado queda SOLO en sessionStorage', async () => {
    const t = tap({ kind: 'http' });
    const user = await toReviewHttp(t);
    await user.click(btn(/Realizar pedido/));
    await received();
    expect(
      JSON.parse(window.localStorage.getItem('monsushi-cart-v2') ?? '{"lines":[]}').lines,
    ).toEqual([]);
    expect(window.sessionStorage.getItem('monsushi-order-attempt')).toBeNull();
    const orderKeys = Object.keys(window.sessionStorage).filter(
      (k) => k.startsWith('monsushi-order-') && k !== 'monsushi-order-attempt',
    );
    expect(orderKeys).toHaveLength(1);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('smo_');
  });

  it('F20: doble clic => un solo POST /v1/orders', async () => {
    const t = tap({ kind: 'http' });
    const user = await toReviewHttp(t);
    const place = btn(/Realizar pedido/);
    await waitFor(() => expect(place).not.toHaveAttribute('aria-disabled', 'true'));
    await user.dblClick(place);
    await received();
    expect(t.orderCalls).toHaveLength(1);
  });

  it('F20: error de red => reintenta con la MISMA clave y no vacía el carrito hasta el éxito', async () => {
    window.__sushimonMockFaults = { 'POST /v1/orders': ['lost-response'] };
    const t = tap({ kind: 'http' });
    const user = await toReviewHttp(t);
    await user.click(btn(/Realizar pedido/));
    await received();
    expect(t.orderRequests).toHaveLength(2);
    expect(t.orderRequests[1]!.key).toBe(t.orderRequests[0]!.key);
    // El servidor creó UN solo pedido (el reintento devolvió el mismo).
    expect((await screen.findByTestId('quote-live')).textContent).toMatch(/Recibimos/);
  });

  it('F20: QUOTE_CHANGED => diálogo con el nuevo total; no reenvía solo; «Aceptar y confirmar» envía con otro token y otra clave', async () => {
    window.__sushimonMockFaults = { 'POST /v1/orders': ['price-change'] };
    const t = tap({ kind: 'http' });
    const user = await toReviewHttp(t);
    await user.click(btn(/Realizar pedido/));
    const dialog = await screen.findByRole('alertdialog', { name: 'El total de tu pedido cambió' });
    expect(within(dialog).getByTestId('changed-total')).toHaveTextContent('Q');
    expect(t.orderRequests).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem('monsushi-cart-v2')!).lines).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Aceptar y confirmar' }));
    await received();
    expect(t.orderRequests).toHaveLength(2);
    expect(t.orderRequests[1]!.body.quoteToken).not.toBe(t.orderRequests[0]!.body.quoteToken);
    expect(t.orderRequests[1]!.key).not.toBe(t.orderRequests[0]!.key);
  });

  it('F20: QUOTE_CHANGED y «Revisar mi pedido» => cierra, recotiza y conserva el carrito', async () => {
    window.__sushimonMockFaults = { 'POST /v1/orders': ['price-change'] };
    const t = tap({ kind: 'http' });
    const user = await toReviewHttp(t);
    const quotesBefore = t.bodies.length;
    await user.click(btn(/Realizar pedido/));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Revisar mi pedido' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(t.bodies.length).toBeGreaterThan(quotesBefore));
    expect(t.orderRequests).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem('monsushi-cart-v2')!).lines).toHaveLength(1);
  });

  it('F20: QUOTE_EXPIRED => mensaje, recotiza y vuelve a pedir confirmación (carrito intacto)', async () => {
    window.__sushimonMockFaults = { 'POST /v1/orders': ['expired'] };
    const t = tap({ kind: 'http' });
    const user = await toReviewHttp(t);
    const quotesBefore = t.bodies.length;
    await user.click(btn(/Realizar pedido/));
    expect((await screen.findAllByText(/Tu cotización venció/)).length).toBeGreaterThan(0);
    // U4: una sola región aria-live en el checkout (la de importes/confirmación/paso).
    expect(screen.getAllByTestId('quote-live')).toHaveLength(1);
    expect(
      document.querySelectorAll('#paso-actual [aria-live], #paso-actual [role="status"]'),
    ).toHaveLength(0);
    expect(screen.getByTestId('quote-live')).toHaveTextContent(/Tu cotización venció/);
    await waitFor(() => expect(t.bodies.length).toBeGreaterThan(quotesBefore));
    expect(JSON.parse(window.localStorage.getItem('monsushi-cart-v2')!).lines).toHaveLength(1);
    const place = btn(/Realizar pedido/);
    await waitFor(() => expect(place).not.toHaveAttribute('aria-disabled', 'true'));
    await user.click(place);
    await received();
    expect(t.orderRequests[1]!.key).not.toBe(t.orderRequests[0]!.key);
  });

  it('F20: 429 con Retry-After => «Reintentar» inactivo mientras espera; ORDERS_UNAVAILABLE => sin reintento automático', async () => {
    window.__sushimonMockFaults = { 'POST /v1/orders': ['rate-limited'] };
    const t = tap({ kind: 'http' });
    const user = await toReviewHttp(t);
    await user.click(btn(/Realizar pedido/));
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(within(alert).getByText(/Demasiados intentos/)).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: /Reintentar/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(t.orderRequests).toHaveLength(1);
  });

  it('F20: ORDERS_UNAVAILABLE => «no podemos recibir pedidos ahora», una sola solicitud y carrito intacto', async () => {
    window.__sushimonMockFaults = { 'POST /v1/orders': ['unavailable'] };
    const t = tap({ kind: 'http' });
    const user = await toReviewHttp(t);
    await user.click(btn(/Realizar pedido/));
    expect(await screen.findByText(/No podemos recibir pedidos ahora/)).toBeInTheDocument();
    expect(t.orderRequests).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem('monsushi-cart-v2')!).lines).toHaveLength(1);
    expect(
      screen.queryByRole('heading', { name: '¡Recibimos tu pedido!' }),
    ).not.toBeInTheDocument();
  });

  it('F20: sin token en la cotización (servidor sin secreto) la confirmación queda bloqueada con su motivo y NO llama a POST /v1/orders', async () => {
    const t = tap({
      kind: 'http',
      patch: (q) => ({ ...q, quote: { ...q.quote, token: null } }),
    });
    const user = await toReviewHttp(t);
    const place = btn(/Realizar pedido/);
    await waitFor(() => expect(place).toHaveAttribute('aria-disabled', 'true'));
    expect(document.getElementById(place.getAttribute('aria-describedby')!)).toHaveTextContent(
      'Actualizando la cotización para poder confirmar tu pedido.',
    );
    await user.click(place);
    expect(t.orderCalls).toEqual([]);
  });

  it('U8/U10 (http): la fila de pago de la revisión dice «Efectivo» con la instrucción de cobro (nada se marca pagado)', async () => {
    const user = await toReviewHttp(tap({ kind: 'http' }));
    void user;
    expect(screen.getByText('Efectivo')).toBeInTheDocument();
    expect(
      screen.getByText('Realiza el pago en efectivo cuando recojas tu pedido en la sucursal.'),
    ).toBeInTheDocument();
  });

  it('U10 (mock): la nota de la revisión no lleva su propia insignia (la lleva el resumen)', async () => {
    const user = userEvent.setup();
    const t = tap();
    await openCheckout(t);
    await toPay(user);
    await next(user, /Continuar a confirmación/i);
    const note = await screen.findByText(/no se crea ningún pedido ni cobro real/);
    expect(note.querySelector('.demo-badge')).toBeNull();
  });

  it('F20 (en): textos en inglés del pedido recibido', async () => {
    const t = tap({ kind: 'http' });
    seedDraft(5);
    await openCheckout(t, { locale: 'en' });
    const place = (await screen.findAllByRole('button', { name: /Place order/ }))[0]!;
    await waitFor(() => expect(place).not.toHaveAttribute('aria-disabled', 'true'));
    await userEvent.setup().click(place);
    await received('We received your order');
  });

  it('B3: la confirmación muestra el proveedor elegido y el cupón aplicado (simulación con datos de demostración)', async () => {
    const user = userEvent.setup();
    const t = tap();
    await openCheckout(t, { type: 'delivery', lines: [['dumplings', 2]] });
    await toStep3(user);
    await screen.findByRole('radio', { name: /Entrega propia/ });
    await user.type(screen.getByLabelText(/Cupón de descuento/), 'bienvenido10{Enter}');
    await screen.findByText('Cupón aplicado.');
    for (const name of ['pago', 'confirmación'])
      await next(user, new RegExp(`Continuar a ${name}`, 'i'));
    await screen.findByRole('heading', { level: 1, name: 'Confirmación' });
    expect(screen.getByText(/Cupón BIENVENIDO10/)).toBeInTheDocument();
    expect(screen.getByText(/Entrega: Entrega propia/)).toBeInTheDocument();
  });

  it('el paso final sigue SIMULADO con datos de demostración: «Realizar pedido» crea el pedido de demostración', async () => {
    const user = userEvent.setup();
    const t = tap();
    await openCheckout(t);
    await toPay(user);
    await next(user, /Continuar a confirmación/i);
    await next(user, /Realizar pedido/);
    expect(await screen.findByRole('heading', { name: '¡Pedido registrado!' })).toBeInTheDocument();
  });
});
