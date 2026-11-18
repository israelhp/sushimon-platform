import { describe, expect, it } from 'vitest';
import type { DraftOrder } from '@/lib/data-access/models';
import { arrangeIncidentOrders, openIncidents } from './orders';
import {
  DESCRIPTION_MAX,
  EMPTY_INCIDENT_DRAFT,
  firstInvalidField,
  toIncidentRequest,
  validateIncident,
} from './validation';
import { buildIncidentWhatsappMessage, whatsappUrl } from './whatsapp';

const order = (id: string, createdAt: string, extra: Partial<DraftOrder> = {}) =>
  ({
    id,
    createdAt,
    fulfillment: 'delivery',
    branchId: 'sucursal-1',
    total: 120.5,
    customer: { name: 'Ana', phone: '5555-1234', email: 'a@b.c' },
    lines: [
      { productId: 'a', name: 'Calientito Roll', quantity: 2, note: 'Sin salsa' },
      { productId: 'b', name: 'Té', quantity: 1, note: '' },
    ],
    incidents: [],
    ...extra,
  }) as unknown as DraftOrder;

describe('validateIncident', () => {
  const valid = {
    type: 'late' as const,
    items: [],
    description: 'Llegó una hora tarde',
    resolution: 'credit' as const,
  };

  it('un borrador vacío falla en tipo, descripción y solución', () => {
    expect(validateIncident(EMPTY_INCIDENT_DRAFT)).toEqual({
      type: 'errType',
      description: 'errDescription',
      resolution: 'errResolution',
    });
  });

  it('faltó/equivocado/calidad exigen productos; demora no', () => {
    expect(validateIncident(valid)).toEqual({});
    for (const type of ['missing', 'wrong', 'quality'] as const) {
      expect(validateIncident({ ...valid, type }).items).toBe('errItems');
      expect(validateIncident({ ...valid, type, items: ['a'] })).toEqual({});
    }
  });

  it('la descripción necesita 10 caracteres (sin contar espacios de los bordes) y un máximo', () => {
    expect(validateIncident({ ...valid, description: '  corta   ' }).description).toBe(
      'errDescription',
    );
    expect(validateIncident({ ...valid, description: '1234567890' })).toEqual({});
    expect(
      validateIncident({ ...valid, description: 'x'.repeat(DESCRIPTION_MAX + 1) }).description,
    ).toBe('errDescription');
  });

  it('el primer campo inválido sigue el orden de la pantalla', () => {
    expect(firstInvalidField(validateIncident(EMPTY_INCIDENT_DRAFT))).toBe('type');
    expect(firstInvalidField(validateIncident({ ...valid, description: '' }))).toBe('description');
    expect(firstInvalidField({})).toBeNull();
  });

  it('el cuerpo recorta la descripción y rechaza borradores incompletos', () => {
    expect(toIncidentRequest('MON-1', { ...valid, description: '  Llegó tarde ya  ' })).toEqual({
      orderId: 'MON-1',
      type: 'late',
      items: [],
      description: 'Llegó tarde ya',
      resolution: 'credit',
    });
    expect(() => toIncidentRequest('MON-1', EMPTY_INCIDENT_DRAFT)).toThrow();
  });
});

describe('pedidos del reclamo', () => {
  const list = ['6', '5', '4', '3', '2', '1'].map((n) =>
    order(`MON-${n}`, `2026-11-0${n}T10:00:00Z`),
  );

  it('limita a 5 y pone primero el pedido destacado aunque sea antiguo', () => {
    expect(arrangeIncidentOrders(list, null).map((o) => o.id)).toEqual([
      'MON-6',
      'MON-5',
      'MON-4',
      'MON-3',
      'MON-2',
    ]);
    expect(arrangeIncidentOrders(list, 'MON-1').map((o) => o.id)).toEqual([
      'MON-1',
      'MON-6',
      'MON-5',
      'MON-4',
      'MON-3',
    ]);
  });

  it('solo cuenta incidencias sin resolver', () => {
    const o = order('MON-9', '2026-11-01T10:00:00Z', {
      incidents: [{ status: 'resolved' }, { status: 'in_review' }, { status: 'received' }] as never,
    });
    expect(openIncidents(o)).toHaveLength(2);
  });
});

describe('WhatsApp', () => {
  it('solo genera enlace con un número internacional válido (11–15 dígitos)', () => {
    expect(whatsappUrl('50239999431')).toBe('https://wa.me/50239999431');
    expect(whatsappUrl('+502 3999-9431', 'Hola mundo')).toBe(
      'https://wa.me/50239999431?text=Hola%20mundo',
    );
    expect(whatsappUrl('3999-9431')).toBeNull();
    expect(whatsappUrl('')).toBeNull();
    expect(whatsappUrl(undefined)).toBeNull();
  });

  it('el mensaje se prellena con pedido, entrega, productos con notas, total y nombre', () => {
    const message = buildIncidentWhatsappMessage(order('MON-490217', '2026-11-11T19:00:00Z'), {
      template: (v) =>
        `Pedido: ${v.id} | ${v.mode} | ${v.items} | ${v.total} | ${v.name} | ${v.date}`,
      delivery: 'A domicilio',
      pickup: 'Recoger',
      branchName: 'Sucursal 1',
      locale: 'es',
    });
    expect(message).toContain('Pedido: MON-490217');
    expect(message).toContain('A domicilio · Sucursal 1');
    expect(message).toContain('2× Calientito Roll (Sin salsa), 1× Té');
    expect(message).toContain('Q120.50');
    expect(message).toContain('Ana');
  });
});
