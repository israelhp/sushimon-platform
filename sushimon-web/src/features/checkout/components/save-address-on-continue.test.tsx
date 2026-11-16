import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { CheckoutProvider } from '../checkout-context';
import { CHECKOUT_STORAGE_KEY } from '../checkout-model';
import { CheckoutFlow } from './CheckoutFlow';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

const NEW_USER = { email: 'invitado.nuevo@ejemplo.com', name: 'Invitado Nuevo' };
const POST_ADDRESS = /^\/v1\/me\/addresses$/;

const storedDraft = (step: number, line = '9a calle 5-55') =>
  JSON.stringify({
    step,
    contact: { name: 'Invitado Nuevo', phone: '5555-1234', email: NEW_USER.email },
    address: {
      department: 'Guatemala',
      municipality: 'Guatemala',
      zone: '10',
      line,
      references: '',
    },
    addressId: 'other',
    notes: '',
    pickupBranchId: null,
    deliveryBranchId: null,
    payment: 'cash',
  });

async function setup(draft = storedDraft(2)) {
  window.sessionStorage.setItem(CHECKOUT_STORAGE_KEY, draft);
  const spy = createSpyClient();
  const view = await renderStore(
    <CheckoutProvider>
      <CheckoutFlow />
    </CheckoutProvider>,
    { wrapClient: spy.wrap },
  );
  await act(async () => {
    view.api().cart.add('dumplings', 1);
    view.api().mode.setMode({
      type: 'delivery',
      when: { kind: 'now' },
      branchId: null,
      address: null,
    });
    view.api().session.signInCustomer(NEW_USER);
  });
  return { ...view, spy };
}

/**
 * La cuenta nueva no tiene teléfono (el prefill lo deja vacío): el primer «Continuar» solo muestra el error y abre los
 * campos; se completa y recién entonces se avanza (el guardado NO ocurre mientras el paso tenga errores).
 */
type User = ReturnType<typeof userEvent.setup>;
const continueOnce = async (user: User) =>
  user.click((await screen.findAllByRole('button', { name: /Continuar a/ }))[0]!);
async function continueFromDelivery(user: User) {
  await continueOnce(user);
  const phone = await screen.findByRole('textbox', { name: /Número de teléfono/ });
  await user.type(phone, '55551234');
  await continueOnce(user);
}

beforeEach(() => {
  window.scrollTo = vi.fn();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('checkout · guardar la dirección al continuar desde Entrega (F05)', () => {
  it('con «guardar» marcado, crea la dirección UNA vez (municipio del catálogo real) y avisa; no se repite al ir y volver', async () => {
    const user = userEvent.setup();
    const { spy } = await setup();
    await screen.findByRole('checkbox', { name: /Guardar también en Mis direcciones/ });
    await continueFromDelivery(user);

    await waitFor(() => expect(spy.count('POST', POST_ADDRESS)).toBe(1));
    expect(await screen.findByText('Dirección guardada en Mis direcciones.')).toBeVisible();

    // Volver a Entrega y continuar otra vez: no se duplica.
    await user.click(screen.getAllByRole('button', { name: /Volver a/ })[0]!);
    await continueOnce(user);
    expect(spy.count('POST', POST_ADDRESS)).toBe(1);
  });

  it('sin marcar «guardar» no crea nada', async () => {
    const user = userEvent.setup();
    const { spy } = await setup();
    await user.click(
      await screen.findByRole('checkbox', { name: /Guardar también en Mis direcciones/ }),
    );
    await continueFromDelivery(user);
    await screen.findByRole('heading', { level: 1, name: /Envío/ });
    expect(spy.count('POST', POST_ADDRESS)).toBe(0);
  });

  it('si el guardado falla avisa, NO bloquea el checkout y permite reintentar', async () => {
    const user = userEvent.setup();
    const { spy } = await setup();
    const gate = spy.hold('POST', POST_ADDRESS);
    await screen.findByRole('checkbox', { name: /Guardar también en Mis direcciones/ });
    await continueFromDelivery(user);
    await waitFor(() => expect(gate.held()).toBe(true));
    gate.fail(new ApiError(500, 'INTERNAL', 'x'));

    expect(
      await screen.findByText(/No pudimos guardar la dirección en Mis direcciones/),
    ).toBeVisible();
    // El checkout siguió al paso de Envío.
    expect(await screen.findByRole('heading', { level: 1, name: /Envío/ })).toBeVisible();

    // Reintento: al volver y continuar, se intenta de nuevo (la firma se liberó).
    await user.click(screen.getAllByRole('button', { name: /Volver a/ })[0]!);
    await continueOnce(user);
    await waitFor(() => expect(spy.count('POST', POST_ADDRESS)).toBe(2));
    expect(await screen.findByText('Dirección guardada en Mis direcciones.')).toBeVisible();
  });

  it('con el municipio fuera del catálogo avisa de forma explícita (no silenciosa) y continúa', async () => {
    const user = userEvent.setup();
    const draft = JSON.parse(storedDraft(2));
    draft.address = { ...draft.address, municipality: 'Municipio Inventado', zone: '' };
    const { spy } = await setup(JSON.stringify(draft));
    await screen.findByRole('checkbox', { name: /Guardar también en Mis direcciones/ });
    await continueFromDelivery(user);
    expect(await screen.findByText(/no encontramos su municipio en el catálogo/)).toBeVisible();
    expect(spy.count('POST', POST_ADDRESS)).toBe(0);
  });
});
