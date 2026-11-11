import { describe, expect, it } from 'vitest';
import { formatOrderAddress } from './format-address';
import { hasLookupErrors, lookupDestination, validateLookup } from './lookup-validation';
import {
  forgetVerifiedOrders,
  readVerifiedOrderIds,
  rememberVerifiedOrder,
} from './verified-orders';

describe('validateLookup', () => {
  it('exige número y al menos 8 dígitos de teléfono', () => {
    expect(validateLookup('', '')).toEqual({ orderNumber: 'errId', phone: 'errPhone' });
    expect(validateLookup('  ', '5555-123')).toEqual({ orderNumber: 'errId', phone: 'errPhone' });
    expect(validateLookup('MON-490217', '5555-1234')).toEqual({ orderNumber: null, phone: null });
    expect(hasLookupErrors(validateLookup('MON-490217', '5555'))).toBe(true);
    expect(hasLookupErrors(validateLookup('490217', '(502) 5555-1234'))).toBe(false);
  });

  it('continúa al reclamo solo con next=incidencia', () => {
    expect(lookupDestination('MON-1', null)).toBe('/pedidos/MON-1');
    expect(lookupDestination('MON-1', 'otra-cosa')).toBe('/pedidos/MON-1');
    expect(lookupDestination('MON-1', 'incidencia')).toBe('/incidencias?pedido=MON-1');
  });
});

describe('formatOrderAddress', () => {
  const zoneLabel = (zone: string) => `zona ${zone}`;
  it('arma línea, zona, municipio y departamento', () => {
    expect(
      formatOrderAddress(
        {
          department: 'Guatemala',
          municipality: 'Guatemala',
          zone: '10',
          line: '6a avenida 10-50',
          references: '',
        },
        zoneLabel,
      ),
    ).toBe('6a avenida 10-50, zona 10, Guatemala, Guatemala');
  });
  it('omite la zona cuando no aplica', () => {
    expect(
      formatOrderAddress(
        {
          department: 'Sacatepéquez',
          municipality: 'Antigua',
          zone: 'N/A',
          line: 'Calle Real 1',
          references: '',
        },
        zoneLabel,
      ),
    ).toBe('Calle Real 1, Antigua, Sacatepéquez');
  });
});

describe('pedidos verificados en la pestaña', () => {
  it('recuerda sin duplicar, solo números MON válidos, y se puede olvidar', () => {
    forgetVerifiedOrders();
    rememberVerifiedOrder('MON-490217');
    rememberVerifiedOrder('MON-490217');
    rememberVerifiedOrder('MON-482193');
    expect(readVerifiedOrderIds()).toEqual(['MON-490217', 'MON-482193']);
    expect(window.sessionStorage.getItem('monsushi-verified-orders-v1')).toBe(
      '["MON-490217","MON-482193"]',
    );
    forgetVerifiedOrders();
    expect(readVerifiedOrderIds()).toEqual([]);
  });
});
