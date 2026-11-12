import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockScenario } from '@/mocks/scenarios';
import { renderStore } from '@/test/store-providers';
import { CheckoutPage } from './CheckoutPage';

vi.mock('next/navigation', () => ({
  usePathname: () => '/checkout',
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const PAN = '4242424242424242';

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
});

interface OpenOptions {
  lines?: [string, number][];
  type?: 'pickup' | 'delivery';
  scenario?: MockScenario;
}

async function openCheckout({
  lines = [['dumplings', 1]],
  type = 'pickup',
  scenario,
}: OpenOptions = {}) {
  const view = await renderStore(<CheckoutPage />, { scenario });
  await act(async () => {
    for (const [id, qty] of lines) view.api().cart.add(id, qty);
    view.api().mode.setMode({ type, when: { kind: 'now' }, branchId: null, address: null });
  });
  return view;
}

const heading = () => screen.getByRole('heading', { level: 1 });
/** El botón de acción existe dos veces (resumen de escritorio y barra móvil); basta con una. */
const next = (user: UserEvent, name: RegExp) =>
  user.click(screen.getAllByRole('button', { name })[0]!);

async function toStep(user: UserEvent, target: 'Entrega' | 'Envío' | 'Pago' | 'Confirmación') {
  const order = ['Entrega', 'Envío', 'Pago', 'Confirmación'] as const;
  for (const name of order) {
    await next(user, new RegExp(`Continuar a ${name}`, 'i'));
    await screen.findByRole('heading', { level: 1, name });
    if (name === target) return;
  }
}

async function payByCard(user: UserEvent) {
  await toStep(user, 'Confirmación');
  await next(user, /Pagar ahora/);
  return screen.findByRole('dialog', { name: 'Pasarela de pago' });
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
    expect(screen.getByText('No disponible por ahora')).toBeInTheDocument();
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
    expect(screen.getAllByTestId('summary-total')[0]).toHaveTextContent('Q53.00');
    await user.click(screen.getByRole('button', { name: 'Agregar uno de Dumplings' }));
    await waitFor(() =>
      expect(screen.getAllByTestId('summary-total')[0]).toHaveTextContent('Q106.00'),
    );
  });
});

describe('checkout · entrega y validaciones', () => {
  it('valida contacto: errores asociados con aria-describedby y foco al primer inválido', async () => {
    const user = userEvent.setup();
    await openCheckout();
    await toStep(user, 'Entrega');
    await user.click(screen.getByRole('button', { name: 'Cambiar' }));
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
    await openCheckout({ type: 'delivery' });
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

  it('permite programar el pedido con día y hora disponibles', async () => {
    const user = userEvent.setup();
    const view = await openCheckout();
    await toStep(user, 'Entrega');
    await user.click(screen.getByRole('button', { name: 'Programar' }));
    expect(await screen.findByText('Día')).toBeInTheDocument();
    expect(view.api().mode.mode.when.kind).toBe('scheduled');
    // Mínimo 45 min de anticipación en pasos de 30: son las 2:25 p. m., el primero es 3:30 p. m.
    expect(screen.getByRole('button', { name: '3:30 p. m.' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: '3:00 p. m.' })).not.toBeInTheDocument();
  });
});

describe('checkout · envío y cobertura', () => {
  it('muestra la tarifa por zona y el tiempo estimado (simulado)', async () => {
    const user = userEvent.setup();
    await openCheckout({ type: 'delivery' });
    await toStep(user, 'Envío');
    expect(await screen.findByTestId('shipping-fee')).toHaveTextContent('Q15.00');
    expect(screen.getByText(/Zona cercana · Sucursal 1/)).toBeInTheDocument();
    expect(screen.getByText('Tiempo estimado de entrega: 30–40 min')).toBeInTheDocument();
    expect(screen.getAllByText('Simulación').length).toBeGreaterThan(0);
    // Resumen: Q53 + Q15 de envío.
    expect(screen.getAllByTestId('summary-total')[0]).toHaveTextContent('Q68.00');
  });

  it('sin cobertura no se puede continuar y se ofrece recoger en sucursal', async () => {
    const user = userEvent.setup();
    const view = await openCheckout({ type: 'delivery' });
    await toStep(user, 'Entrega');
    await user.click(screen.getAllByRole('button', { name: 'Cambiar' })[1]!);
    await user.selectOptions(await screen.findByLabelText('Departamento'), 'Escuintla');
    await next(user, /Continuar a envío/i);
    expect(
      await screen.findByText(/Por el momento no contamos con una estimación/),
    ).toBeInTheDocument();
    expect(screen.getByText('Sin cobertura de envío por ahora')).toBeInTheDocument();

    await next(user, /Continuar a pago/i);
    expect(heading()).toHaveTextContent('Envío');

    await user.click(screen.getByRole('button', { name: 'Recoger en sucursal' }));
    expect(view.api().mode.mode.type).toBe('pickup');
    expect(await screen.findByText('¿En qué sucursal lo recogés?')).toBeInTheDocument();
    await next(user, /Continuar a pago/i);
    expect(await screen.findByRole('heading', { level: 1, name: 'Pago' })).toBeInTheDocument();
  });

  it('con la sucursal cerrada solo se puede programar', async () => {
    const user = userEvent.setup();
    const view = await openCheckout({ scenario: 'branch-closed' });
    await toStep(user, 'Envío');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sucursal 1 está cerrada en este momento');
    await next(user, /Continuar a pago/i);
    expect(heading()).toHaveTextContent('Envío');

    await user.click(within(alert).getByRole('button', { name: 'Programar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrega' })).toBeInTheDocument();
    expect(view.api().mode.mode.when.kind).toBe('scheduled');
    await next(user, /Continuar a envío/i);
    await screen.findByRole('heading', { level: 1, name: 'Envío' });
    await next(user, /Continuar a pago/i);
    expect(await screen.findByRole('heading', { level: 1, name: 'Pago' })).toBeInTheDocument();
  });
});

describe('checkout · pedido en efectivo', () => {
  it('completa los 5 pasos, crea el pedido, vacía el carrito y guarda "Tu último pedido"', async () => {
    const user = userEvent.setup();
    const view = await openCheckout({ lines: [['dumplings', 2]] });
    await toStep(user, 'Pago');
    await user.click(screen.getByRole('radio', { name: /Efectivo/ }));
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
    expect(screen.getByRole('link', { name: 'Seguir mi pedido' })).toHaveAttribute(
      'href',
      `/pedidos/${number}`,
    );
    expect(screen.getByRole('link', { name: /Reportalo/ })).toHaveAttribute(
      'href',
      `/incidencias?pedido=${number}`,
    );
    expect(screen.getByText('Simulación')).toBeInTheDocument();

    expect(view.api().cart.count).toBe(0);
    expect(window.sessionStorage.getItem('monsushi-checkout-v1')).toBeNull();
    const last = JSON.parse(window.localStorage.getItem('monsushi-last-order-v1')!);
    expect(last).toMatchObject({ id: number, total: 106 });
  });

  it('si fallan los datos muestra un aviso con reintento y no pierde el carrito', async () => {
    const view = await openCheckout({ scenario: 'error' });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(view.api().cart.count).toBe(1);
  });
});

describe('checkout · pago con tarjeta NeoNet (simulado)', () => {
  it('abre la pasarela rotulada como simulación y aprueba con la tarjeta 4242', async () => {
    const user = userEvent.setup();
    const view = await openCheckout();
    const dialog = await payByCard(user);
    expect(within(dialog).getByText('Demo / Sin cobro real')).toBeInTheDocument();
    expect(within(dialog).getByText(/No es una integración oficial/)).toBeInTheDocument();
    expect(within(dialog).getByText('•••• •••• •••• 4242')).toBeInTheDocument();
    expect(view.api().cart.count).toBe(1);

    await user.click(within(dialog).getByRole('button', { name: /Simular pago/ }));
    expect(await within(dialog).findByText('Pago aprobado')).toBeInTheDocument();
    expect(within(dialog).getByText('Tarjeta •••• 4242')).toBeInTheDocument();
    expect(within(dialog).getByText(/^DEMO-\d{6}$/)).toBeInTheDocument();
    // Ya no hay campos ni datos de la tarjeta en pantalla.
    expect(document.body.textContent).not.toContain('4242 4242 4242 4242');
    expect(document.body.textContent).not.toContain(PAN);
    expect(within(dialog).queryByLabelText('CVV')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Consultar pedido' }));
    expect(await screen.findByRole('heading', { name: '¡Pedido pagado!' })).toBeInTheDocument();
    expect(
      screen.getAllByText('Pagado — Pendiente de aceptación del restaurante').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/Tarjeta de crédito o débito — NeoNet \(Demo\) · DEMO-/),
    ).toBeInTheDocument();
    expect(view.api().cart.count).toBe(0);
  });

  it('valida los datos de la tarjeta con errores asociados y foco al primer campo', async () => {
    const user = userEvent.setup();
    await openCheckout();
    const dialog = await payByCard(user);
    const number = within(dialog).getByLabelText('Número de tarjeta');
    await user.clear(number);
    await user.type(number, '4111111111111111');
    await user.clear(within(dialog).getByLabelText('CVV'));
    await user.click(within(dialog).getByRole('button', { name: /Simular pago/ }));
    expect(number).toHaveAttribute('aria-invalid', 'true');
    expect(number).toHaveAttribute('aria-describedby', 'nn-number-error');
    expect(within(dialog).getByText(/solo acepta tarjetas de prueba/)).toBeInTheDocument();
    expect(within(dialog).getByText('Ingresá el CVV de 3 o 4 dígitos.')).toBeInTheDocument();
    await waitFor(() => expect(number).toHaveFocus());
  });

  it('el CVV es un campo de contraseña y ningún campo autocompleta', async () => {
    const user = userEvent.setup();
    await openCheckout();
    const dialog = await payByCard(user);
    expect(within(dialog).getByLabelText('CVV')).toHaveAttribute('type', 'password');
    for (const label of ['Número de tarjeta', 'Nombre en la tarjeta', 'Vencimiento', 'CVV']) {
      expect(within(dialog).getByLabelText(label)).toHaveAttribute('autocomplete', 'off');
    }
  });

  it('tarjeta rechazada (4000…0002): reintento y cambio a efectivo sin perder el carrito', async () => {
    const user = userEvent.setup();
    const view = await openCheckout();
    const dialog = await payByCard(user);
    await user.click(within(dialog).getByRole('button', { name: /4000 0000 0000 0002/ }));
    await user.click(within(dialog).getByRole('button', { name: /Simular pago/ }));
    expect(await within(dialog).findByText('No se pudo completar el pago')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Número de tarjeta')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('4000 0000 0000 0002 Visa');

    await user.click(within(dialog).getByRole('button', { name: 'Reintentar pago' }));
    expect(await within(dialog).findByLabelText('Número de tarjeta')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /4000 0000 0000 0002/ }));
    await user.click(within(dialog).getByRole('button', { name: /Simular pago/ }));
    await within(dialog).findByText('No se pudo completar el pago');

    await user.click(within(dialog).getByRole('button', { name: 'Cambiar método de pago' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Pago' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(view.api().cart.count).toBe(1);

    await user.click(screen.getByRole('radio', { name: /Efectivo/ }));
    await next(user, /Continuar a confirmación/i);
    await next(user, /Realizar pedido/);
    expect(await screen.findByRole('heading', { name: '¡Pedido registrado!' })).toBeInTheDocument();
    expect(view.api().cart.count).toBe(0);
  });

  it('el escenario payment-rejected fuerza el rechazo incluso con una tarjeta aprobada', async () => {
    const user = userEvent.setup();
    await openCheckout({ scenario: 'payment-rejected' });
    const dialog = await payByCard(user);
    await user.click(within(dialog).getByRole('button', { name: /Simular pago/ }));
    expect(await within(dialog).findByText('No se pudo completar el pago')).toBeInTheDocument();
  });

  it('tarjeta pendiente (4000…0077): pago en verificación y confirmación con ese estado', async () => {
    const user = userEvent.setup();
    const view = await openCheckout();
    const dialog = await payByCard(user);
    await user.click(within(dialog).getByRole('button', { name: /4000 0000 0000 0077/ }));
    await user.click(within(dialog).getByRole('button', { name: /Simular pago/ }));
    expect(
      await within(dialog).findByText('Estamos verificando el estado de tu pago'),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Consultar estado' }));
    expect(
      await within(dialog).findByText('Estamos verificando el estado de tu pago'),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Consultar pedido' }));
    expect(await screen.findByRole('heading', { name: '¡Pedido registrado!' })).toBeInTheDocument();
    expect(screen.getAllByText('Pago en verificación').length).toBeGreaterThan(0);
    expect(view.api().cart.count).toBe(0);
  });

  it('cancelar la pasarela vuelve al checkout con el carrito intacto', async () => {
    const user = userEvent.setup();
    const view = await openCheckout();
    const dialog = await payByCard(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(heading()).toHaveTextContent('Confirmación');
    expect(view.api().cart.count).toBe(1);
  });
});

describe('checkout · seguridad de los datos de tarjeta', () => {
  it('nunca guarda PAN, CVV ni PIN en localStorage ni sessionStorage', async () => {
    const user = userEvent.setup();
    await openCheckout();
    const dialog = await payByCard(user);
    await user.click(within(dialog).getByRole('button', { name: /Simular pago/ }));
    await within(dialog).findByText('Pago aprobado');

    const dump = JSON.stringify({
      local: { ...window.localStorage },
      session: { ...window.sessionStorage },
    });
    expect(dump).not.toContain(PAN);
    expect(dump).not.toContain('4242 4242');
    expect(dump).not.toMatch(/cvv|cardnumber|pin"/i);
  });

  it('el borrador del checkout (sessionStorage) no contiene datos de tarjeta aunque se escriban', async () => {
    const user = userEvent.setup();
    await openCheckout();
    const dialog = await payByCard(user);
    const cvv = within(dialog).getByLabelText('CVV');
    await user.clear(cvv);
    await user.type(cvv, '987');
    const draft = window.sessionStorage.getItem('monsushi-checkout-v1') ?? '';
    expect(draft).not.toContain('987');
    expect(draft).not.toContain(PAN);
  });
});

describe('checkout · persistencia del progreso', () => {
  it('restaura el paso y el método de pago tras recargar (sin perder lo no sensible)', async () => {
    const user = userEvent.setup();
    const first = await openCheckout();
    await toStep(user, 'Pago');
    await user.click(screen.getByRole('radio', { name: /Efectivo/ }));
    await waitFor(() =>
      expect(JSON.parse(window.sessionStorage.getItem('monsushi-checkout-v1')!)).toMatchObject({
        step: 4,
        payment: 'cash',
      }),
    );
    first.unmount();

    // Recarga de la pestaña: carrito y modo son preferencias persistentes aparte; el borrador sale de sessionStorage.
    const again = await renderStore(<CheckoutPage />);
    await act(async () => {
      again.api().cart.add('dumplings', 1);
      again.api().mode.setMode({
        type: 'pickup',
        when: { kind: 'now' },
        branchId: null,
        address: null,
      });
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Pago' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Efectivo/ })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('checkout · inglés', () => {
  it('muestra los textos en inglés', async () => {
    const view = await renderStore(<CheckoutPage />, { locale: 'en' });
    await act(async () => {
      view.api().cart.add('dumplings', 1);
      view
        .api()
        .mode.setMode({ type: 'pickup', when: { kind: 'now' }, branchId: null, address: null });
    });
    expect(await screen.findByText('Step 1 of 5')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Continue to delivery/i }).length).toBeGreaterThan(
      0,
    );
  });
});
