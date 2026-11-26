import { beforeEach, describe, expect, it } from 'vitest';
import {
  ORDER_ATTEMPT_STORAGE_KEY,
  attemptFor,
  buildOrderRequest,
  clearAttempt,
  intentFingerprint,
  type OrderIntent,
} from './order-attempt';

const intent = (over: Partial<OrderIntent> = {}): OrderIntent => ({
  scope: null,
  quote: {
    cart: {
      branchId: 'b1',
      lines: [{ productId: 'p1', quantity: 2, selections: [] }],
    },
    fulfillment: { type: 'DELIVERY', municipalityId: 'm1', zone: null },
    couponCode: '',
  },
  contact: { fullName: 'Ana López', phone: '5555-1234', email: '' },
  deliveryAddress: null,
  notes: '',
  preference: 'cash',
  ...over,
});

beforeEach(() => {
  clearAttempt();
  window.sessionStorage.clear();
});

describe('order-attempt · clave de idempotencia estable por intento lógico (F20)', () => {
  it('reutiliza la MISMA clave mientras la huella no cambia (reintento, recarga) y la persiste en sessionStorage', async () => {
    let n = 0;
    const make = () => `key-${++n}-aaaaaaaaaaaaaaaaaaaaaaaa`;
    const fp = intentFingerprint(intent());
    const a = await attemptFor(fp, make);
    const b = await attemptFor(fp, make);
    expect(b.key).toBe(a.key);
    expect(n).toBe(1);
    expect(JSON.parse(window.sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY)!)).toEqual(a);
    expect(Object.keys(a).sort()).toEqual(['fingerprintHash', 'key', 'salt']);
  });

  it('renueva la clave si cambia la huella (otro contacto, nota, preferencia, línea, cuenta)', async () => {
    const base = await attemptFor(
      intentFingerprint(intent()),
      () => 'k1-aaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    const variants: Partial<OrderIntent>[] = [
      { contact: { fullName: 'Ana López', phone: '5555-9999', email: '' } },
      { notes: 'sin picante' },
      { preference: null },
      { scope: 'cuenta-1' },
      {
        quote: {
          ...intent().quote,
          cart: { branchId: 'b1', lines: [{ productId: 'p1', quantity: 3, selections: [] }] },
        },
      },
    ];
    for (const [i, v] of variants.entries()) {
      const next = await attemptFor(
        intentFingerprint(intent(v)),
        () => `k${i + 2}-aaaaaaaaaaaaaaaaaaaaaaaaaa`,
      );
      expect(next.key, JSON.stringify(v)).not.toBe(base.key);
      // Volver a la huella original ya no recupera la anterior: es otro intento lógico.
      await attemptFor(intentFingerprint(intent()), () => `back${i}-aaaaaaaaaaaaaaaaaaaaaaaaaa`);
    }
  });

  it('la huella ignora el formato del teléfono y las mayúsculas del correo, pero no el token (no forma parte de la huella)', async () => {
    const a = intentFingerprint(
      intent({ contact: { fullName: 'Ana', phone: '5555-1234', email: 'A@B.com' } }),
    );
    const b = intentFingerprint(
      intent({ contact: { fullName: 'Ana', phone: '55551234', email: 'a@b.com' } }),
    );
    expect(a).toBe(b);
  });

  it('sessionStorage NO contiene datos personales (nombre, teléfono, correo, dirección, notas): solo clave, sal y resumen', async () => {
    const pii = intent({
      contact: {
        fullName: 'Ana López Secreta',
        phone: '5555-1234',
        email: 'ana.secreta@ejemplo.com',
      },
      deliveryAddress: {
        addressLine: '6a avenida 10-50 Edificio Secreto',
        referenceNote: 'Portón negro',
      },
      notes: 'sin picante secreto',
    });
    await attemptFor(intentFingerprint(pii));
    const stored = JSON.stringify({ ...window.sessionStorage });
    for (const leak of [
      'Ana',
      'López',
      'Secret',
      '5555',
      '55551234',
      'ejemplo.com',
      'avenida',
      'Portón',
      'picante',
      'sucursal-1',
      'dumplings',
      'p1',
    ]) {
      expect(stored, leak).not.toContain(leak);
    }
    expect(
      JSON.parse(window.sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY)!).fingerprintHash,
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it('clearAttempt descarta la clave: la siguiente es nueva', async () => {
    const fp = intentFingerprint(intent());
    const a = await attemptFor(fp, () => 'first-aaaaaaaaaaaaaaaaaaaaaaaaaaa');
    clearAttempt();
    expect(window.sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY)).toBeNull();
    expect((await attemptFor(fp, () => 'second-aaaaaaaaaaaaaaaaaaaaaaaaaa')).key).not.toBe(a.key);
  });

  it('la clave por defecto es un UUID v4 (cumple el patrón del contrato)', async () => {
    const { key } = await attemptFor(intentFingerprint(intent()));
    expect(key).toMatch(/^[A-Za-z0-9_-]{22,128}$/);
  });
});

describe('buildOrderRequest · sin importes', () => {
  it('lleva la cotización aceptada y solo lo que el cliente escribió', async () => {
    const body = buildOrderRequest(
      intent({
        quote: {
          ...intent().quote,
          fulfillment: { type: 'DELIVERY', municipalityId: 'm', zone: 'Zona 10' },
          couponCode: 'MON10',
        },
        deliveryAddress: { addressLine: ' 6a avenida 10-50 ', referenceNote: '' },
        notes: ' sin wasabi ',
        preference: 'cash',
        contact: { fullName: ' Ana ', phone: ' 5555-1234 ', email: ' a@b.com ' },
      }),
      'mockq.token',
    );
    expect(body).toEqual({
      cart: intent().quote.cart,
      fulfillment: { type: 'DELIVERY', municipalityId: 'm', zone: 'Zona 10' },
      couponCode: 'MON10',
      quoteToken: 'mockq.token',
      contact: { fullName: 'Ana', phone: '5555-1234', email: 'a@b.com' },
      deliveryAddress: { addressLine: '6a avenida 10-50' },
      notes: 'sin wasabi',
      paymentMethodPreference: 'cash',
    });
    expect(JSON.stringify(body)).not.toMatch(/total|price|fee|status|paid/i);
  });

  it('omite lo vacío (cupón, correo, dirección, nota, preferencia)', async () => {
    const body = buildOrderRequest(intent({ preference: null }), 't');
    expect(Object.keys(body).sort()).toEqual(['cart', 'contact', 'fulfillment', 'quoteToken']);
    expect(body.contact).toEqual({ fullName: 'Ana López', phone: '5555-1234' });
  });
});
