import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockScenario } from '@/mocks/scenarios';
import type { MockStore } from '@/mocks/store';
import { cartInput } from '@/test/cart';
import { renderStore } from '@/test/store-providers';
import { CheckoutPage } from './CheckoutPage';

vi.mock('next/navigation', () => ({
  usePathname: () => '/checkout',
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
});

interface OpenOptions {
  lines?: [string, number][];
  scenario?: MockScenario;
  prepareStore?: (store: MockStore) => void;
}

async function openCheckout({
  lines = [['dumplings', 1]],
  scenario,
  prepareStore,
}: OpenOptions = {}) {
  const view = await renderStore(<CheckoutPage />, { scenario, prepareStore });
  await act(async () => {
    for (const [id, qty] of lines) view.api().cart.add(cartInput(id, qty));
    view.api().mode.setMode({ type: 'delivery', branchId: 'sucursal-1', address: null });
  });
  return view;
}

const heading = () => screen.getByRole('heading', { level: 1 });
/** El botón de acción existe dos veces (resumen de escritorio y barra móvil); basta con una. */
const next = async (user: UserEvent, name: RegExp) => {
  // F18: «Continuar» espera la revalidación del carrito (precios, disponibilidad y extras de la sucursal).
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name })[0]).not.toHaveAttribute('aria-disabled', 'true'),
  );
  await user.click(screen.getAllByRole('button', { name })[0]!);
};

async function toStep(user: UserEvent, target: 'Entrega' | 'Envío' | 'Pago' | 'Confirmación') {
  const order = ['Entrega', 'Envío', 'Pago', 'Confirmación'] as const;
  for (const name of order) {
    await next(user, new RegExp(`Continuar a ${name}`, 'i'));
    await screen.findByRole('heading', { level: 1, name });
    if (name === target) return;
  }
}

describe('checkout · estados de pantalla', () => {
  it('con el carrito vacío muestra el estado vacío con enlace al menú', async () => {
    await renderStore(<CheckoutPage />);
    expect(
      await screen.findByRole('heading', { name: 'Tu pedido está vacío' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir al menú' })).toHaveAttribute('href', '/menu');
  });

  it('muestra el progreso accesible "Paso X de 5" y mueve el foco al título al avanzar', async () => {
    const user = userEvent.setup();
    await openCheckout();
    expect(await screen.findByRole('heading', { level: 1, name: 'Tu pedido' })).toBeInTheDocument();
    expect(screen.getByText('Paso 1 de 5')).toBeInTheDocument();
    const progress = screen.getByRole('list', { name: 'Progreso del pedido' });
    expect(within(progress).getAllByRole('listitem')).toHaveLength(5);
    expect(within(progress).getByRole('button', { name: 'Tu pedido' })).toHaveAttribute(
      'aria-current',
      'step',
    );

    await next(user, /Continuar a entrega/i);
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrega' })).toBeInTheDocument();
    expect(screen.getByText('Paso 2 de 5')).toBeInTheDocument();
    await waitFor(() => expect(heading()).toHaveFocus());
  });

  it('los productos no disponibles bloquean el avance hasta quitarlos', async () => {
    const user = userEvent.setup();
    await openCheckout({
      lines: [
        ['platanito-roll', 1],
        ['dumplings', 1],
      ],
      scenario: 'product-unavailable',
    });
    expect(await screen.findByText(/ya no están disponibles/)).toBeInTheDocument();
    expect(screen.getByText('Agotado en esta sucursal')).toBeInTheDocument();
    await next(user, /Continuar a entrega/i);
    expect(heading()).toHaveTextContent('Tu pedido');

    await user.click(screen.getByRole('button', { name: 'Eliminar Platanito Roll' }));
    await next(user, /Continuar a entrega/i);
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrega' })).toBeInTheDocument();
  });

  it('permite editar cantidades y el total del resumen solo se muestra', async () => {
    const user = userEvent.setup();
    await openCheckout({ lines: [['dumplings', 1]] });
    await screen.findAllByText('Dumplings');
    // El total es el del servidor: producto + tarifa de envío de la zona (todo pedido es a domicilio).
    await waitFor(() =>
      expect(screen.getAllByTestId('summary-total')[0]).toHaveTextContent('Q68.00'),
    );
    await user.click(screen.getByRole('button', { name: 'Agregar uno de Dumplings' }));
    await waitFor(() =>
      expect(screen.getAllByTestId('summary-total')[0]).toHaveTextContent('Q121.00'),
    );
  });
});

describe('checkout · paso 1 explica SIEMPRE el bloqueo (U2)', () => {
  it('línea agotada: «Continuar» no avanza, el motivo es una alerta y recibe el foco; el texto va en tuteo', async () => {
    const user = userEvent.setup();
    await openCheckout({ lines: [['platanito-roll', 1]], scenario: 'product-unavailable' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/ya no están disponibles en tu sucursal/);
    expect(alert).toHaveTextContent('Quítalos');
    expect(alert).not.toHaveTextContent('Quitalos');
    await user.click(screen.getAllByRole('button', { name: /Continuar a entrega/i })[0]!);
    expect(heading()).toHaveTextContent('Tu pedido');
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('sucursal del carrito distinta a la del modo de pedido: texto propio que apunta a la sucursal', async () => {
    const user = userEvent.setup();
    const view = await openCheckout();
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /Continuar a entrega/i })[0],
      ).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await act(async () => view.api().mode.update({ branchId: 'sucursal-2' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Tu pedido es de otra sucursal');
    expect(alert).not.toHaveTextContent(/Quít?alos/);
    await user.click(screen.getAllByRole('button', { name: /Continuar a entrega/i })[0]!);
    expect(heading()).toHaveTextContent('Tu pedido');
  });

  it('sin sucursal elegida: lo dice y no avanza', async () => {
    const view = await openCheckout();
    await act(async () => view.api().mode.update({ branchId: null }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Elige una sucursal para continuar.',
    );
  });

  it('el resumen lista los extras de cada línea (solo lectura) y su «Editar» mide ≥ 44 px', async () => {
    const view = await renderStore(<CheckoutPage />, { branchId: 'sucursal-1' });
    await act(async () => {
      view.api().cart.add(
        cartInput('sushi-pizza', 1, '', {
          unitCents: 7200,
          selections: [{ groupId: 'mgroup-salsa', optionId: 'mopt-ponzu', quantity: 1 }],
          options: [
            {
              groupId: 'mgroup-salsa',
              optionId: 'mopt-ponzu',
              groupName: 'Salsa',
              optionName: 'Ponzu',
              extraCents: 0,
            },
          ],
        }),
      );
      view.api().mode.setMode({
        type: 'delivery',
        branchId: 'sucursal-1',
        address: null,
      });
    });
    const summary = (await screen.findAllByRole('region', { name: /Resumen/i }))[0]!;
    expect(within(summary).getByText('+ Ponzu')).toBeInTheDocument();
    expect(within(summary).getByRole('button', { name: /Editar/ }).className).toContain(
      'min-h-[44px]',
    );
  });
});

describe('checkout · entrega y validaciones', () => {
  it('valida contacto: errores asociados con aria-describedby y foco al primer inválido', async () => {
    const user = userEvent.setup();
    await openCheckout();
    await toStep(user, 'Entrega');
    await user.click(screen.getAllByRole('button', { name: 'Cambiar' })[0]!);
    const name = await screen.findByLabelText('Nombre del cliente');
    await user.clear(name);
    await user.clear(screen.getByLabelText('Número de teléfono'));
    await user.clear(screen.getByLabelText(/^Correo/));
    await user.type(screen.getByLabelText(/^Correo/), 'no-es-correo');

    await next(user, /Continuar a envío/i);
    expect(heading()).toHaveTextContent('Entrega');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    const describedBy = name.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)).toHaveTextContent('Escribí tu nombre completo.');
    expect(screen.getByLabelText('Número de teléfono')).toHaveAttribute(
      'aria-describedby',
      'd-phone-error',
    );
    expect(
      screen.getByText('Ingresá un correo válido para recibir tu compra.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(name).toHaveFocus());

    await user.type(name, 'Ana López');
    await user.type(screen.getByLabelText('Número de teléfono'), '55551234');
    await user.clear(screen.getByLabelText(/^Correo/));
    await user.type(screen.getByLabelText(/^Correo/), 'ana@ejemplo.com');
    await next(user, /Continuar a envío/i);
    expect(await screen.findByRole('heading', { level: 1, name: 'Envío' })).toBeInTheDocument();
  });

  it('a domicilio exige zona válida (no existen la 20, 22 ni 23)', async () => {
    const user = userEvent.setup();
    await openCheckout();
    await toStep(user, 'Entrega');
    // Hay dos "Cambiar" (datos de contacto y dirección): la dirección es el segundo.
    await user.click(screen.getAllByRole('button', { name: 'Cambiar' })[1]!);
    const zone = await screen.findByLabelText('Zona');
    expect(within(zone).queryByRole('option', { name: 'Zona 22' })).not.toBeInTheDocument();
    await user.selectOptions(zone, '');
    await next(user, /Continuar a envío/i);
    expect(screen.getByLabelText('Zona')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByText('Indicá la zona.').length).toBeGreaterThan(0);
  });

  it('ADR-0036: la entrega es solo a domicilio e inmediata (no hay recoger ni programar)', async () => {
    const user = userEvent.setup();
    await openCheckout();
    await toStep(user, 'Entrega');
    expect(screen.queryByRole('button', { name: 'Programar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recoger' })).not.toBeInTheDocument();
    expect(screen.queryByText('Día')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Dirección de entrega' }),
    ).toBeInTheDocument();
  });
});

describe('checkout · sucursal que no recibe pedidos (F08, solo UI)', () => {
  async function toShipping(user: UserEvent) {
    await toStep(user, 'Entrega');
    await user.click(screen.getAllByRole('button', { name: 'Cambiar' })[0]!);
    await user.clear(await screen.findByLabelText('Nombre del cliente'));
    await user.type(screen.getByLabelText('Nombre del cliente'), 'Ana López');
    await user.clear(screen.getByLabelText('Número de teléfono'));
    await user.type(screen.getByLabelText('Número de teléfono'), '55551234');
    await user.clear(screen.getByLabelText(/^Correo/));
    await user.type(screen.getByLabelText(/^Correo/), 'ana@ejemplo.com');
    await next(user, /Continuar a envío/i);
    await screen.findByRole('heading', { level: 1, name: 'Envío' });
  }

  it('con un cierre extraordinario en curso avisa, muestra cuándo abre y bloquea el avance', async () => {
    const user = userEvent.setup();
    await openCheckout({ scenario: 'branch-closed' });
    await toStep(user, 'Entrega');
    expect(
      await screen.findByText(/No hay sucursales abiertas en este momento/),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Cambiar' })[0]!);
    await user.clear(await screen.findByLabelText('Nombre del cliente'));
    await user.type(screen.getByLabelText('Nombre del cliente'), 'Ana López');
    await user.clear(screen.getByLabelText('Número de teléfono'));
    await user.type(screen.getByLabelText('Número de teléfono'), '55551234');
    await user.clear(screen.getByLabelText(/^Correo/));
    await user.type(screen.getByLabelText(/^Correo/), 'ana@ejemplo.com');
    await next(user, /Continuar a envío/i);
    await screen.findByRole('heading', { level: 1, name: 'Envío' });
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('La sucursal está cerrada en este momento');
    // la próxima apertura la calcula el servidor (fin del cierre: mañana 1:00 p. m.)
    expect(notice).toHaveTextContent('Abre mañana a las 1:00 p. m.');
    // no se avanza a Pago mientras la sucursal no recibe pedidos (la cotización trae `BRANCH_CLOSED`)
    expect(screen.getAllByRole('button', { name: /Continuar a pago/i })[0]).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(heading()).toHaveTextContent('Envío');
  });

  it('sin cierre no muestra aviso de sucursal cerrada', async () => {
    const user = userEvent.setup();
    await openCheckout();
    await toShipping(user);
    expect(screen.queryByText(/está cerrada en este momento/)).not.toBeInTheDocument();
    await next(user, /Continuar a pago/i);
    expect(await screen.findByRole('heading', { level: 1, name: 'Pago' })).toBeInTheDocument();
  });
});

describe('checkout · envío y cobertura', () => {
  it('muestra la tarifa propia que devuelve el servidor para la zona (sin niveles ni tiempos inventados)', async () => {
    const user = userEvent.setup();
    await openCheckout();
    await toStep(user, 'Envío');
    expect(await screen.findByTestId('shipping-fee')).toHaveTextContent('Q15.00');
    expect(screen.queryByText(/Tiempo estimado de entrega/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Zona cercana/)).not.toBeInTheDocument();
    // PedidosYa NUNCA se presenta como disponible ni seleccionable (sin integración verificada).
    const py = screen.getByRole('radio', { name: /PedidosYa/ });
    expect(py).toBeDisabled();
    expect(py).toHaveAttribute('data-status', 'unknown');
    // Resumen: Q53 + Q15 de envío (valores del SERVIDOR).
    await waitFor(() =>
      expect(screen.getAllByTestId('summary-total')[0]).toHaveTextContent('Q68.00'),
    );
  });

  it('PedidosYa no verificable y sin zona propia: «no podemos confirmar»; no continúa y no ofrece recoger', async () => {
    const user = userEvent.setup();
    const view = await openCheckout();
    await toStep(user, 'Entrega');
    await user.click(screen.getAllByRole('button', { name: 'Cambiar' })[1]!);
    await user.selectOptions(
      await screen.findByLabelText('Municipio'),
      await screen.findByRole('option', { name: 'Palencia' }),
    );
    await next(user, /Continuar a envío/i);
    expect(
      await screen.findByText(/Por ahora no podemos confirmar si llegamos a esa dirección/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Por ahora no llegamos a esa dirección\./)).not.toBeInTheDocument();

    expect(screen.getAllByRole('button', { name: /Continuar a pago/i })[0]).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(heading()).toHaveTextContent('Envío');

    // Solo se informa: sin ofrecer recoger en sucursal ni programar (ADR-0036).
    expect(screen.queryByRole('button', { name: /Recoger/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Programar/ })).not.toBeInTheDocument();
    expect(view.api().mode.mode.type).toBe('delivery');
  });

  it('sin cobertura propia y PedidosYa deshabilitado: «por ahora no llegamos a esa dirección», sin alternativas', async () => {
    const user = userEvent.setup();
    await openCheckout({
      prepareStore: (store) => {
        for (const id of ['sucursal-1', 'sucursal-2', 'sucursal-3']) {
          store.deliverySettings[id] = {
            ownDeliveryZonesEnabled: true,
            pedidosyaEnabled: false,
            updatedAt: '2026-02-01T15:00:00.000Z',
          };
        }
      },
    });
    await toStep(user, 'Entrega');
    await user.click(screen.getAllByRole('button', { name: 'Cambiar' })[1]!);
    await user.selectOptions(
      await screen.findByLabelText('Municipio'),
      await screen.findByRole('option', { name: 'Palencia' }),
    );
    await next(user, /Continuar a envío/i);
    expect(await screen.findByText('Por ahora no llegamos a esa dirección.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Recoger|Programar/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Continuar a pago/i })[0]).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(heading()).toHaveTextContent('Envío');
  });

  it('un departamento sin municipios cargados avisa y exige elegir un municipio válido', async () => {
    const user = userEvent.setup();
    await openCheckout();
    await toStep(user, 'Entrega');
    await user.click(screen.getAllByRole('button', { name: 'Cambiar' })[1]!);
    await user.selectOptions(await screen.findByLabelText('Departamento'), 'Escuintla');
    expect(
      (
        await screen.findAllByText(
          /solo ofrecemos entrega a domicilio en el departamento de Guatemala/,
        )
      ).length,
    ).toBeGreaterThan(0);
    await next(user, /Continuar a envío/i);
    expect(screen.getByText('Indicá el municipio.')).toBeInTheDocument();
    expect(heading()).toHaveTextContent('Entrega');
  });

  it('con la sucursal cerrada bloquea el pedido y avisa cuándo abre, sin ofrecer programar', async () => {
    const user = userEvent.setup();
    await openCheckout({ scenario: 'branch-closed' });
    await toStep(user, 'Envío');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('La sucursal está cerrada en este momento');
    expect(alert).toHaveTextContent('Abre mañana a las 1:00 p. m.');
    expect(within(alert).queryByRole('button', { name: 'Programar' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Continuar a pago/i })[0]).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(heading()).toHaveTextContent('Envío');
  });
});

describe('checkout · pedido en efectivo', () => {
  it('completa los 5 pasos, crea el pedido, vacía el carrito y guarda "Tu último pedido"', async () => {
    const user = userEvent.setup();
    const view = await openCheckout({ lines: [['dumplings', 2]] });
    await toStep(user, 'Pago');
    await next(user, /Continuar a confirmación/i);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Confirmación' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Efectivo')).toBeInTheDocument();
    expect(screen.getByText('Te enviamos la compra a cliente@ejemplo.com')).toBeInTheDocument();

    await next(user, /Realizar pedido/);
    const title = await screen.findByRole('heading', { name: '¡Pedido registrado!' });
    expect(title).toBeInTheDocument();
    const number = screen.getByTestId('order-number').textContent!;
    expect(number).toMatch(/^MON-\d{6}$/);
    expect(
      screen.getAllByText('Recibido — Pendiente de aceptación del restaurante').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Ver detalle del pedido' })).toHaveAttribute(
      'href',
      `/pedidos/${number}`,
    );
    // F21 (M5): el seguimiento es la acción primaria y lleva al UUID del pedido simulado.
    const tracking = screen.getByRole('link', { name: 'Ver estado de mi pedido' });
    expect(tracking).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/pedidos\/[0-9a-f-]{36}\/seguimiento$/),
    );
    expect(tracking.className).toContain('btn-primary');
    expect(screen.getByRole('link', { name: /Reportalo/ })).toHaveAttribute(
      'href',
      `/incidencias?pedido=${number}`,
    );
    expect(screen.getByText('Simulación')).toBeInTheDocument();

    expect(view.api().cart.count).toBe(0);
    expect(window.sessionStorage.getItem('monsushi-checkout-v1')).toBeNull();
    const last = JSON.parse(window.localStorage.getItem('monsushi-last-order-v1')!);
    expect(last).toMatchObject({ id: number, total: 121 });
  });

  it('si fallan los datos muestra un aviso con reintento y no pierde el carrito', async () => {
    const view = await openCheckout({ scenario: 'error' });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(view.api().cart.count).toBe(1);
  });
});

describe('checkout · pago SOLO en efectivo (F24)', () => {
  const FORBIDDEN = /transferencia|tarjeta|neonet|comprobante|cuenta bancaria|pagar ahora/i;

  it('el paso Pago ofrece únicamente «Efectivo» (sin elegir), con la instrucción de entrega y el total cotizado', async () => {
    const user = userEvent.setup();
    await openCheckout({ lines: [['dumplings', 2]] });
    await toStep(user, 'Pago');
    const cash = await screen.findByTestId('payment-cash');
    expect(within(cash).getByText('Efectivo')).toBeInTheDocument();
    expect(screen.getByTestId('payment-instructions')).toHaveTextContent(
      'Realiza el pago en efectivo cuando recibas tu pedido.',
    );
    await waitFor(() => expect(screen.getByTestId('payment-total')).toHaveTextContent('Q121.00'));
    // No hay nada que elegir: sin radios, sin tarjeta, transferencia, Neonet ni comprobantes.
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
    // Nada se marca como pagado.
    expect(screen.getByText(/no se marca como pagado/)).toBeInTheDocument();
  });

  it('a domicilio (entrega propia) la instrucción es «cuando recibas tu pedido» y el total incluye el envío cotizado', async () => {
    const user = userEvent.setup();
    await openCheckout();
    await toStep(user, 'Pago');
    expect(await screen.findByTestId('payment-instructions')).toHaveTextContent(
      'Realiza el pago en efectivo cuando recibas tu pedido.',
    );
    // Q53 + Q15 de envío (valores del SERVIDOR).
    await waitFor(() => expect(screen.getByTestId('payment-total')).toHaveTextContent('Q68.00'));
  });

  it('la revisión final muestra «Efectivo» con la instrucción y el botón es «Realizar pedido» (nunca «Pagar ahora»)', async () => {
    const user = userEvent.setup();
    await openCheckout();
    await toStep(user, 'Confirmación');
    expect(screen.getAllByRole('button', { name: /Realizar pedido/ }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Realiza el pago en efectivo cuando recibas/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
  });

  it('el borrador del checkout (sessionStorage) no guarda ningún dato de pago ni de tarjeta', async () => {
    const user = userEvent.setup();
    await openCheckout();
    await toStep(user, 'Pago');
    const draft = window.sessionStorage.getItem('monsushi-checkout-v1') ?? '';
    expect(draft).not.toMatch(/card|bank|transfer|cvv|pan|pin|payment/i);
    const dump = JSON.stringify({ ...window.localStorage, ...window.sessionStorage });
    expect(dump).not.toMatch(/cvv|cardnumber|4242/i);
  });
});

describe('checkout · persistencia del progreso', () => {
  it('restaura el paso tras recargar (sin perder lo no sensible; el método ya no se guarda: solo hay efectivo)', async () => {
    const user = userEvent.setup();
    const first = await openCheckout();
    await toStep(user, 'Pago');
    await waitFor(() =>
      expect(JSON.parse(window.sessionStorage.getItem('monsushi-checkout-v1')!)).toMatchObject({
        step: 4,
      }),
    );
    first.unmount();

    // Recarga de la pestaña: carrito y modo son preferencias persistentes aparte; el borrador sale de sessionStorage.
    const again = await renderStore(<CheckoutPage />);
    await act(async () => {
      again.api().cart.add(cartInput('dumplings', 1));
      again.api().mode.setMode({
        type: 'delivery',
        branchId: 'sucursal-1',
        address: null,
      });
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Pago' })).toBeInTheDocument();
    expect(screen.getByTestId('payment-cash')).toBeInTheDocument();
  });
});

describe('checkout · inglés', () => {
  it('muestra los textos en inglés', async () => {
    const view = await renderStore(<CheckoutPage />, { locale: 'en' });
    await act(async () => {
      view.api().cart.add(cartInput('dumplings', 1));
      view.api().mode.setMode({
        type: 'delivery',
        branchId: 'sucursal-1',
        address: null,
      });
    });
    expect(await screen.findByText('Step 1 of 5')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Continue to delivery/i }).length).toBeGreaterThan(
      0,
    );
  });
});
