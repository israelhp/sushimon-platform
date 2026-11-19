import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderStore } from '@/test/store-providers';
import { PaymentStatus } from './PaymentStatus';

/** F24 (spec 025 §12.1, §13 #42–#46): estado de pago PÚBLICO. Ícono + texto; pendiente sin dinero recibido; sin empleado. */

const PENDING = { method: 'CASH', status: 'PENDING', paidAt: null } as const;
const PAID = { method: 'CASH', status: 'PAID', paidAt: '2026-11-18T19:05:12.000Z' } as const;
const RECEIPT_PAID = {
  ...PAID,
  amountPaid: '185.00',
  tendered: '200.00',
  change: '15.00',
} as const;

describe('PaymentStatus', () => {
  it('pendiente (retiro): texto, instrucción y NINGÚN texto de dinero recibido', async () => {
    await renderStore(<PaymentStatus payment={PENDING} fulfillmentType="PICKUP" />);
    expect(screen.getByTestId('payment-line')).toHaveTextContent('Pago en efectivo: Pendiente');
    expect(screen.getByTestId('payment-hint')).toHaveTextContent(
      'Realiza el pago en efectivo cuando recojas tu pedido en la sucursal.',
    );
    expect(screen.getByTestId('payment-status').textContent).not.toMatch(
      /recibido|cambio|importe|pagado el/i,
    );
    expect(screen.getByTestId('payment-line').querySelector('svg')).not.toBeNull();
  });

  it('pendiente con pedido cancelado/rechazado (closed): NO pide pagar, dice «No se cobra»', async () => {
    await renderStore(<PaymentStatus payment={PENDING} fulfillmentType="PICKUP" closed />);
    expect(screen.getByTestId('payment-line')).toHaveTextContent('Pago en efectivo: Pendiente');
    expect(screen.getByTestId('payment-closed')).toHaveTextContent(
      'No se cobra: el pedido fue cancelado o rechazado.',
    );
    expect(screen.queryByTestId('payment-hint')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Realiza el pago/);
  });

  it('pendiente (a domicilio): «cuando recibas tu pedido»', async () => {
    await renderStore(<PaymentStatus payment={PENDING} fulfillmentType="DELIVERY" />);
    expect(screen.getByTestId('payment-hint')).toHaveTextContent(
      'Realiza el pago en efectivo cuando recibas tu pedido.',
    );
  });

  it('pagado en el recibo: fecha, importe pagado, efectivo recibido y cambio', async () => {
    await renderStore(
      <PaymentStatus payment={RECEIPT_PAID} receipt={RECEIPT_PAID} fulfillmentType="PICKUP" />,
    );
    expect(screen.getByTestId('payment-line')).toHaveTextContent('Pago en efectivo: Pagado');
    expect(screen.getByTestId('payment-paid-at')).toHaveTextContent('Pagado el');
    const rows = screen.getByTestId('payment-receipt');
    expect(rows).toHaveTextContent(/Importe pagado.*185/);
    expect(rows).toHaveTextContent(/Efectivo recibido.*200/);
    expect(rows).toHaveTextContent(/Cambio.*15/);
    expect(screen.queryByTestId('payment-hint')).toBeNull();
  });

  it('pagado fuera del recibo (detalle/seguimiento): fecha, pero SIN importes', async () => {
    await renderStore(<PaymentStatus payment={PAID} fulfillmentType="PICKUP" />);
    expect(screen.getByTestId('payment-paid-at')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-receipt')).toBeNull();
  });

  it('en inglés', async () => {
    await renderStore(<PaymentStatus payment={PAID} fulfillmentType="PICKUP" />, {
      locale: 'en',
    });
    expect(screen.getByTestId('payment-line')).toHaveTextContent('Cash payment: Paid');
    expect(screen.getByTestId('payment-paid-at')).toHaveTextContent('Paid on');
  });
});
