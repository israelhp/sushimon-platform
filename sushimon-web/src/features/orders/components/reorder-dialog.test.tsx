import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type {
  OrderReorderIssue,
  OrderReorderLine,
  OrderReorderPreview,
} from '@/lib/data-access/models';
import { withShortcuts, type DataClient, type RequestOptions } from '@/lib/data-access/types';
import { useProductSheet } from '@/features/catalog/product-sheet-context';
import { cartInput } from '@/test/cart';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { ReorderDialog } from './reorder-dialog';

/** F23 · «Volver a pedir» (matriz #58–#63, #81–#82): diagnósticos, combinación con el carrito F18, errores y accesibilidad. */
const HISTORY = '00000000-0000-4000-8000-000000479850';
const ACTIVE = '00000000-0000-4000-8000-000000490217';
const DEMO = { email: 'cliente@ejemplo.com', name: 'Cliente Demo' };
type View = Awaited<ReturnType<typeof renderStore>>;
const signIn = (view: View) => act(async () => view.api().session.signInCustomer(DEMO));

const issue = (
  code: OrderReorderIssue['code'],
  extra: Partial<OrderReorderIssue> = {},
): OrderReorderIssue => ({
  code,
  severity: 'warning',
  ...extra,
});

function line(n: number, over: Partial<OrderReorderLine> = {}): OrderReorderLine {
  return {
    lineNo: n,
    status: 'AVAILABLE',
    original: {
      productName: `Producto ${n}`,
      quantity: 1,
      unitPrice: '10.00',
      extrasPerUnit: '0.00',
      modifiers: [],
      notes: null,
    },
    current: { unitPrice: '10.00', extrasPerUnit: '0.00' },
    issues: [],
    candidate: {
      line: { productId: `prod-${n}`, quantity: 1, selections: [] },
      slug: `prod-${n}`,
      note: null,
      display: { name: `Producto ${n}`, imageUrl: null, unitPrice: '10.00', options: [] },
    },
    ...over,
  };
}

function preview(
  lines: OrderReorderLine[],
  over: Partial<OrderReorderPreview> = {},
): OrderReorderPreview {
  const available = lines.filter((l) => l.status === 'AVAILABLE');
  return {
    generatedAt: '2026-11-19T12:00:00.000Z',
    source: {
      displayNumber: 'MON-001042',
      status: 'delivered',
      fulfillmentType: 'PICKUP',
      deliveryProvider: null,
      placedAt: '2026-11-01T12:00:00.000Z',
    },
    branch: {
      originalBranchId: 'sucursal-1',
      requestedBranchId: 'sucursal-1',
      sameBranch: true,
      name: 'Sucursal 1',
      active: true,
      acceptingOrders: true,
      reason: 'OPEN',
      nextOpensAt: null,
    },
    lines,
    summary: {
      lines: lines.length,
      available: available.length,
      needsConfiguration: lines.filter((l) => l.status === 'NEEDS_CONFIGURATION').length,
      unavailable: lines.filter((l) => l.status === 'UNAVAILABLE').length,
      priceChanged: 0,
      units: available.length,
      estimatedSubtotal: `${available.length * 10}.00`,
      canAddAny: available.length > 0,
    },
    ...over,
  };
}

/** Responde SOLO la vista previa con `respond`; el resto (sucursales, etc.) pasa al mock. */
function previewClient(
  respond: (body: { branchId?: string }) => OrderReorderPreview | ApiError,
  log: RequestOptions[] = [],
) {
  return (base: DataClient): DataClient =>
    withShortcuts('mock', async <T,>(path: string, o: RequestOptions = {}) => {
      if (!path.endsWith('/reorder-preview')) return base.request<T>(path, o);
      log.push(o);
      const r = respond((o.body ?? {}) as { branchId?: string });
      if (r instanceof ApiError) throw r;
      return r as T;
    });
}

function SheetProbe() {
  const sheet = useProductSheet();
  return <p data-testid="sheet">{sheet.productId ?? 'closed'}</p>;
}

function Harness({ orderId = HISTORY, inProgress }: { orderId?: string; inProgress?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SheetProbe />
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      {open ? (
        <ReorderDialog
          orderId={orderId}
          displayNumber="MON-001042"
          inProgress={inProgress}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Inicia sesión y abre el diálogo (como en la app: la sesión existe ANTES de consultar). */
async function openDialog(view: View, name = 'Volver a pedir') {
  await signIn(view);
  return openOnly(name);
}
async function openOnly(name = 'Volver a pedir') {
  await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
  return screen.findByRole('dialog', { name });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('Volver a pedir (F23) · diagnóstico contra el mock real', () => {
  it('línea íntegra, precio cambiado (antes → ahora) y producto retirado; no se añade lo no disponible', async () => {
    const user = userEvent.setup();
    const spy = createSpyClient();
    const view = await renderStore(<Harness />, { wrapClient: spy.wrap });
    const dialog = await openDialog(view);
    expect(await within(dialog).findByText('Basado en el pedido MON-001042')).toBeVisible();
    await within(dialog).findByTestId('group-AVAILABLE');
    expect(within(dialog).getByTestId('price-change')).toHaveTextContent(
      'Antes Q42.00 → ahora Q46.00 por unidad',
    );
    const gone = within(dialog).getByTestId('group-UNAVAILABLE');
    expect(gone).toHaveTextContent('Roll de Temporada');
    expect(gone).toHaveTextContent('Este producto ya no se vende.');
    expect(within(dialog).getByTestId('reorder-estimate')).toHaveTextContent(/^Q\d/);

    await user.click(within(dialog).getByRole('button', { name: 'Añadir al carrito' }));
    expect(view.api().cart.lines.map((l) => l.productId)).toEqual([
      'la-suegra-roll',
      'loco-ribs',
      'helados-asiaticos',
    ]);
    expect(view.api().cart.lines.find((l) => l.productId === 'la-suegra-roll')?.note).toBe(
      'Salsa aparte',
    );
    // Aviso accesible, cajón del carrito abierto y diálogo cerrado.
    expect(
      await screen.findByText(
        /Añadimos 3 productos\. Los precios, promociones y la entrega se calcularán al pagar\./,
      ),
    ).toBeVisible();
    expect(view.api().shell.cartOpen).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'Volver a pedir' })).not.toBeInTheDocument();
    // Nunca crea pedidos ni cotiza desde aquí.
    expect(
      spy.calls.filter((c) => c.method === 'POST' && !c.path.endsWith('/reorder-preview')),
    ).toEqual([]);
    expect(spy.calls.some((c) => c.path.includes('/checkout') || c.path === '/v1/orders')).toBe(
      false,
    );
    // Vista previa = una sola solicitud POST de solo lectura.
    expect(spy.calls.filter((c) => c.path.endsWith('/reorder-preview'))).toHaveLength(1);
  });

  it('pedido en curso: pide confirmar «¿Pedir otro igual?» ANTES de consultar', async () => {
    const user = userEvent.setup();
    const spy = createSpyClient();
    const view = await renderStore(<Harness orderId={ACTIVE} inProgress />, {
      wrapClient: spy.wrap,
    });
    const dialog = await openDialog(view);
    expect(
      within(dialog).getByText('Este pedido sigue en curso. ¿Pedir otro igual?'),
    ).toBeVisible();
    expect(spy.calls.some((c) => c.path.endsWith('/reorder-preview'))).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Sí, pedir otro igual' }));
    await within(dialog).findByRole('button', { name: /Añadir al carrito/ });
    expect(spy.calls.filter((c) => c.path.endsWith('/reorder-preview'))).toHaveLength(1);
  });

  it('si el estado no se conocía y el servidor dice «en curso», pide confirmar antes de mostrar líneas', async () => {
    const view = await renderStore(<Harness />, {
      wrapClient: previewClient(() =>
        preview([line(1)], {
          source: {
            displayNumber: 'MON-001042',
            status: 'preparing',
            fulfillmentType: 'PICKUP',
            deliveryProvider: null,
            placedAt: '2026-11-01T12:00:00.000Z',
          },
        }),
      ),
    });
    const dialog = await openDialog(view);
    expect(
      await within(dialog).findByText('Este pedido sigue en curso. ¿Pedir otro igual?'),
    ).toBeVisible();
    expect(screen.queryByTestId('reorder-line')).not.toBeInTheDocument();
  });
});

describe('Volver a pedir (F23) · combinar con el carrito', () => {
  const fixture = () => previewClient(() => preview([line(1), line(2)]));

  it('misma sucursal: «Añadir» suma por defecto; «Reemplazar» exige confirmación con el conteo y «Volver» no cambia nada', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Harness />, { wrapClient: fixture() });
    await signIn(view);
    act(() => {
      view.api().cart.add(cartInput('dumplings', 2));
      view.api().cart.add(cartInput('california-roll', 1));
    });
    const dialog = await openOnly();
    const add = await within(dialog).findByRole('radio', { name: 'Añadir a mi carrito' });
    expect(add).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: 'Reemplazar mi carrito' }));
    await user.click(within(dialog).getByRole('button', { name: 'Reemplazar mi carrito' }));
    const confirm = within(dialog).getByTestId('replace-confirm');
    expect(confirm).toHaveTextContent('Se quitarán 2 productos de tu carrito.');
    expect(view.api().cart.lines).toHaveLength(2); // nada se tocó todavía
    await user.click(within(dialog).getByRole('button', { name: 'Volver' }));
    expect(view.api().cart.lines).toHaveLength(2);
    await user.click(within(dialog).getByRole('button', { name: 'Reemplazar mi carrito' }));
    await user.click(within(dialog).getByRole('button', { name: 'Sí, reemplazar' }));
    expect(view.api().cart.lines.map((l) => l.slug)).toEqual(['prod-1', 'prod-2']);
  });

  it('misma sucursal con «Añadir»: se suma al carrito existente (unificación de F18)', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Harness />, { wrapClient: fixture() });
    await signIn(view);
    act(() => {
      view.api().cart.add(cartInput('dumplings', 2));
    });
    const dialog = await openOnly();
    await user.click(await within(dialog).findByRole('button', { name: 'Añadir al carrito' }));
    expect(view.api().cart.lines.map((l) => l.slug)).toEqual(['dumplings', 'prod-1', 'prod-2']);
    expect(view.api().cart.count).toBe(4);
  });

  it('carrito de OTRA sucursal: se explica, solo se ofrece reemplazar CON confirmación y cancelar deja el carrito intacto', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Harness />, { wrapClient: fixture() });
    await signIn(view);
    act(() => {
      view.api().cart.add(cartInput('dumplings', 2, '', { branchId: 'sucursal-2' }));
    });
    const dialog = await openOnly();
    expect(await within(dialog).findByTestId('cart-other-branch')).toHaveTextContent(
      'Tu carrito es de otra sucursal y no se pueden mezclar',
    );
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Añadir al carrito' }),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Reemplazar mi carrito' }));
    expect(within(dialog).getByTestId('replace-confirm')).toHaveTextContent(
      'Se quitará 1 producto de tu carrito.',
    );
    expect(view.api().cart.branchId).toBe('sucursal-2');
    await user.click(within(dialog).getByRole('button', { name: 'Volver' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(view.api().cart.branchId).toBe('sucursal-2');
    expect(view.api().cart.lines.map((l) => l.slug)).toEqual(['dumplings']);
  });

  it('carrito de otra sucursal + «Sí, reemplazar»: queda SOLO este pedido en su sucursal', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Harness />, { wrapClient: fixture() });
    await signIn(view);
    act(() => {
      view.api().cart.add(cartInput('dumplings', 2, '', { branchId: 'sucursal-2' }));
    });
    const dialog = await openOnly();
    await user.click(await within(dialog).findByRole('button', { name: 'Reemplazar mi carrito' }));
    await user.click(within(dialog).getByRole('button', { name: 'Sí, reemplazar' }));
    expect(view.api().cart.branchId).toBe('sucursal-1');
    expect(view.api().cart.lines.map((l) => l.slug)).toEqual(['prod-1', 'prod-2']);
  });

  it('tope excedido (99 por configuración): se rechaza con el mensaje de F18, sin recortar y el diálogo sigue abierto', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Harness />, {
      wrapClient: previewClient(() =>
        preview([
          line(1, {
            candidate: {
              ...line(1).candidate!,
              line: { productId: 'dumplings', quantity: 5, selections: [] },
              slug: 'dumplings',
            },
          }),
        ]),
      ),
    });
    await signIn(view);
    act(() => {
      view.api().cart.add(cartInput('dumplings', 97));
    });
    const dialog = await openOnly();
    await user.click(await within(dialog).findByRole('button', { name: 'Añadir al carrito' }));
    expect(await screen.findByText('Máximo 99 unidades de una misma configuración.')).toBeVisible();
    expect(view.api().cart.count).toBe(97);
    expect(screen.getByRole('dialog', { name: 'Volver a pedir' })).toBeVisible();
  });
});

describe('Volver a pedir (F23) · diagnósticos del servidor', () => {
  const diag = () =>
    preview([
      line(1),
      line(2, {
        status: 'AVAILABLE',
        issues: [
          {
            code: 'PRICE_CHANGED',
            severity: 'info',
            previousUnitPrice: '42.00',
            currentUnitPrice: '46.00',
          },
          { code: 'QUANTITY_ADJUSTED', severity: 'info', from: 120, to: 99 },
          { code: 'NOTE_DROPPED', severity: 'info' },
        ],
      }),
      line(3, {
        status: 'NEEDS_CONFIGURATION',
        issues: [
          issue('OPTION_REMOVED', { optionName: 'Anguila' }),
          issue('OPTION_INACTIVE', { optionName: 'Crunch' }),
          issue('GROUP_RULE_CHANGED', { groupName: 'Extras' }),
          issue('REQUIRED_SELECTION_MISSING', { groupName: 'Salsa' }),
        ],
      }),
      line(4, {
        status: 'UNAVAILABLE',
        candidate: null,
        current: null,
        issues: [issue('PRODUCT_REMOVED', { severity: 'blocking' })],
      }),
      line(5, {
        status: 'UNAVAILABLE',
        candidate: null,
        current: null,
        issues: [issue('PRODUCT_INACTIVE', { severity: 'blocking' })],
      }),
      line(6, {
        status: 'UNAVAILABLE',
        candidate: null,
        issues: [issue('PRODUCT_OUT_OF_STOCK', { severity: 'blocking' })],
      }),
    ]);

  it('muestra TODOS los diagnósticos con texto (es) y estados Disponible / Necesita que lo configures / No disponible', async () => {
    const view = await renderStore(<Harness />, { wrapClient: previewClient(diag) });
    const dialog = await openDialog(view);
    await within(dialog).findByTestId('group-NEEDS_CONFIGURATION');
    const text = dialog.textContent ?? '';
    for (const expected of [
      'Antes Q42.00 → ahora Q46.00 por unidad',
      'La cantidad se ajustó de 120 a 99.',
      'No copiamos tu nota anterior',
      'La opción «Anguila» ya no se ofrece con este producto.',
      'La opción «Crunch» no está disponible por ahora.',
      'Las reglas de «Extras» cambiaron: elige de nuevo tus opciones.',
      'Ahora este producto pide elegir «Salsa».',
      'Este producto ya no se vende.',
      'Este producto no está disponible por ahora.',
      'Agotado en esta sucursal.',
      'Disponible',
      'Necesita que lo configures',
      'No disponible',
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect(within(dialog).getByTestId('group-AVAILABLE')).toHaveTextContent(
      '2 productos se añadirán al carrito',
    );
  });

  it('NEEDS_CONFIGURATION no se añade sola: «Configurar» abre la ficha del producto y el carrito sigue intacto', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Harness />, { wrapClient: previewClient(diag) });
    const dialog = await openDialog(view);
    await user.click(await within(dialog).findByRole('button', { name: 'Configurar Producto 3' }));
    expect(screen.getByTestId('sheet')).toHaveTextContent('prod-3');
    expect(screen.queryByRole('dialog', { name: 'Volver a pedir' })).not.toBeInTheDocument();
    expect(view.api().cart.count).toBe(0);
    // Las no disponibles se listan SIN acción.
    expect(screen.queryByRole('button', { name: /Configurar Producto 4/ })).not.toBeInTheDocument();
  });

  it('solo se añaden las AVAILABLE aunque haya líneas por configurar y no disponibles', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Harness />, { wrapClient: previewClient(diag) });
    const dialog = await openDialog(view);
    await user.click(await within(dialog).findByRole('button', { name: 'Añadir al carrito' }));
    expect(view.api().cart.lines.map((l) => l.slug)).toEqual(['prod-1', 'prod-2']);
  });

  it('ninguna línea agregable: el botón principal queda desactivado', async () => {
    const view = await renderStore(<Harness />, {
      wrapClient: previewClient(() =>
        preview([
          line(1, {
            status: 'UNAVAILABLE',
            candidate: null,
            issues: [issue('PRODUCT_REMOVED', { severity: 'blocking' })],
          }),
        ]),
      ),
    });
    const dialog = await openDialog(view);
    expect(await within(dialog).findByRole('button', { name: 'Añadir al carrito' })).toBeDisabled();
  });

  it('sucursal inactiva: avisa y permite elegir otra, repitiendo la vista previa con esa sucursal', async () => {
    const user = userEvent.setup();
    const log: RequestOptions[] = [];
    const view = await renderStore(<Harness />, {
      wrapClient: previewClient(
        (body) =>
          body.branchId === 'sucursal-2'
            ? preview([line(1)], {
                branch: {
                  originalBranchId: 'sucursal-1',
                  requestedBranchId: 'sucursal-2',
                  sameBranch: false,
                  name: 'Sucursal 2',
                  active: true,
                  acceptingOrders: true,
                  reason: 'OPEN',
                  nextOpensAt: null,
                },
              })
            : preview(
                [
                  line(1, {
                    status: 'UNAVAILABLE',
                    candidate: null,
                    issues: [issue('BRANCH_UNAVAILABLE', { severity: 'blocking' })],
                  }),
                ],
                {
                  branch: {
                    originalBranchId: 'sucursal-1',
                    requestedBranchId: 'sucursal-1',
                    sameBranch: true,
                    name: 'Sucursal 1',
                    active: false,
                    acceptingOrders: false,
                    reason: 'INACTIVE',
                    nextOpensAt: null,
                  },
                },
              ),
        log,
      ),
    });
    const dialog = await openDialog(view);
    expect(await within(dialog).findByTestId('branch-inactive')).toHaveTextContent(
      'Esta sucursal no está activa',
    );
    await user.selectOptions(within(dialog).getByLabelText('Sucursal'), 'sucursal-2');
    await within(dialog).findByTestId('branch-differs');
    expect(within(dialog).getByTestId('branch-differs')).toHaveTextContent(
      'Tu pedido original era de',
    );
    expect(log.map((o) => o.body)).toEqual([{}, { branchId: 'sucursal-2' }]);
    expect(within(dialog).getByRole('button', { name: 'Añadir al carrito' })).toBeEnabled();
  });

  it('sucursal cerrada por horario: avisa pero permite añadir', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Harness />, {
      wrapClient: previewClient(() =>
        preview([line(1)], {
          branch: {
            originalBranchId: 'sucursal-1',
            requestedBranchId: 'sucursal-1',
            sameBranch: true,
            name: 'Sucursal 1',
            active: true,
            acceptingOrders: false,
            reason: 'OUTSIDE_BUSINESS_HOURS',
            nextOpensAt: '2026-11-20T14:00:00.000Z',
          },
        }),
      ),
    });
    const dialog = await openDialog(view);
    expect(await within(dialog).findByTestId('branch-closed')).toHaveTextContent(
      'fuera de horario',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Añadir al carrito' }));
    expect(view.api().cart.count).toBe(1);
  });
});

describe('Volver a pedir (F23) · errores de la consulta (el carrito no cambia)', () => {
  it.each([
    [401, 'denied', /No pudimos revisar este pedido/],
    [404, 'denied', /No pudimos revisar este pedido/],
    [429, 'rateLimited', /demasiadas consultas/],
    [503, 'busy', /El servicio está ocupado/],
    [0, 'offline', /Sin conexión/],
  ])(
    '%s: mensaje propio, sin estados de negocio y carrito intacto',
    async (status, _kind, text) => {
      const view = await renderStore(<Harness />, {
        wrapClient: previewClient(() => new ApiError(status, 'x', 'no')),
      });
      await signIn(view);
      act(() => {
        view.api().cart.add(cartInput('dumplings', 1));
      });
      const dialog = await openOnly();
      expect(await within(dialog).findByTestId('reorder-error')).toHaveTextContent(text);
      expect(within(dialog).queryByTestId('reorder-line')).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole('button', { name: /Añadir al carrito|Reemplazar/ }),
      ).not.toBeInTheDocument();
      expect(view.api().cart.lines.map((l) => l.slug)).toEqual(['dumplings']);
    },
  );

  it('503 y luego éxito con «Reintentar»', async () => {
    const user = userEvent.setup();
    let failing = true;
    const view = await renderStore(<Harness />, {
      wrapClient: previewClient(() =>
        failing ? new ApiError(503, 'server_error', 'x') : preview([line(1)]),
      ),
    });
    const dialog = await openDialog(view);
    await within(dialog).findByTestId('reorder-error');
    failing = false;
    await user.click(within(dialog).getByRole('button', { name: 'Reintentar' }));
    expect(await within(dialog).findByTestId('reorder-line')).toBeVisible();
  });
});

describe('Volver a pedir (F23) · foco y avisos de los pasos', () => {
  it('cambiar de sucursal no pierde el foco: el selector sigue montado mientras se repite la revisión', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Harness />, {
      wrapClient: previewClient((body) =>
        body.branchId === 'sucursal-2'
          ? preview([line(1)], {
              branch: {
                originalBranchId: 'sucursal-1',
                requestedBranchId: 'sucursal-2',
                sameBranch: false,
                name: 'Sucursal 2',
                active: true,
                acceptingOrders: true,
                reason: 'OPEN',
                nextOpensAt: null,
              },
            })
          : preview([line(1)]),
      ),
    });
    const dialog = await openDialog(view);
    const select = await within(dialog).findByLabelText('Sucursal');
    await user.selectOptions(select, 'sucursal-2');
    expect(within(dialog).getByLabelText('Sucursal')).toBe(select);
    expect(select).toHaveFocus();
    await within(dialog).findByTestId('branch-differs');
    expect(select).toHaveFocus();
  });

  it('«¿Pedir otro igual?» y la confirmación de reemplazo enfocan su título; «Volver» devuelve el foco al botón principal; el aviso anuncia la confirmación', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Harness inProgress />, {
      wrapClient: previewClient(() => preview([line(1)])),
    });
    await signIn(view);
    act(() => {
      view.api().cart.add(cartInput('dumplings', 1));
    });
    const dialog = await openOnly();
    expect(
      within(dialog).getByText('Este pedido sigue en curso. ¿Pedir otro igual?'),
    ).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Sí, pedir otro igual' }));
    await within(dialog).findByRole('radio', { name: 'Reemplazar mi carrito' });
    await user.click(within(dialog).getByRole('radio', { name: 'Reemplazar mi carrito' }));
    await user.click(within(dialog).getByRole('button', { name: 'Reemplazar mi carrito' }));
    expect(within(dialog).getByText('¿Reemplazar tu carrito?')).toHaveFocus();
    expect(dialog.querySelector('[aria-live]')).toHaveTextContent(
      '¿Reemplazar tu carrito? Se quitará 1 producto de tu carrito.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Volver' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Reemplazar mi carrito' })).toHaveFocus(),
    );
  });

  it('429 de la vista previa: ErrorNotice con espera de Retry-After', async () => {
    const view = await renderStore(<Harness />, {
      wrapClient: previewClient(
        () =>
          new ApiError(
            429,
            'too_many_requests',
            'x',
            undefined,
            undefined,
            'RATE_LIMITED',
            undefined,
            6,
          ),
      ),
    });
    const dialog = await openDialog(view);
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('demasiadas consultas');
    expect(within(alert).getByRole('button')).toHaveAttribute('aria-disabled', 'true');
    expect(within(alert).getByRole('button')).toHaveTextContent(/Reintentar en 6 s/);
  });

  it('sin líneas agregables: explica «Ningún producto se puede añadir ahora» y se anuncia', async () => {
    const view = await renderStore(<Harness />, {
      wrapClient: previewClient(() =>
        preview([line(1, { status: 'UNAVAILABLE', candidate: null })]),
      ),
    });
    const dialog = await openDialog(view);
    expect(await within(dialog).findByTestId('nothing-now')).toHaveTextContent(
      'Ningún producto se puede añadir ahora.',
    );
    expect(dialog.querySelector('[aria-live]')).toHaveTextContent(
      'Ningún producto se puede añadir ahora.',
    );
  });
});

describe('Volver a pedir (F23) · accesibilidad', () => {
  it('una sola región aria-live educada, rol dialog y foco devuelto al disparador al cerrar con Esc', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Harness />, {
      wrapClient: previewClient(() => preview([line(1)])),
    });
    await signIn(view);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Volver a pedir' });
    await within(dialog).findByTestId('reorder-line');
    expect(dialog.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(dialog.querySelector('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    expect(dialog.querySelector('[aria-live]')).toHaveTextContent('Revisión lista: 1 disponibles');
    expect(dialog.querySelector('[role="alert"]')).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('en inglés se traducen estados, diagnósticos y acciones', async () => {
    const view = await renderStore(<Harness />, {
      locale: 'en',
      wrapClient: previewClient(() =>
        preview([
          line(1),
          line(2, {
            status: 'NEEDS_CONFIGURATION',
            issues: [issue('OPTION_REMOVED', { optionName: 'Eel' })],
          }),
        ]),
      ),
    });
    const dialog = await openDialog(view, 'Order again');
    await within(dialog).findByTestId('group-NEEDS_CONFIGURATION');
    expect(dialog).toHaveTextContent('The option “Eel” is no longer offered with this product.');
    expect(within(dialog).getByRole('button', { name: 'Add to cart' })).toBeEnabled();
    expect(dialog).toHaveTextContent('Needs your configuration');
  });
});
