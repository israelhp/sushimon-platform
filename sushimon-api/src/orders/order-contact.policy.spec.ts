import {
  maskPhone,
  normalizeAddressText,
  normalizeEmail,
  normalizeNotes,
  normalizePhone,
  resolveContact,
} from './order-contact.policy.js';

const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { getStatus: () => number }).getStatus();
  }
  return null;
};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { getResponse: () => { code?: string } }).getResponse().code ?? null;
  }
  return null;
};

describe('política de contacto (F20)', () => {
  it.each([
    ['55551234', '+50255551234'],
    ['5555 1234', '+50255551234'],
    ['5555-1234', '+50255551234'],
    ['+502 5555 1234', '+50255551234'],
    ['502 2222 3333', '+50222223333'],
    ['+50277778888', '+50277778888'],
  ])('teléfono GT %s => %s', (raw, out) => {
    expect(normalizePhone(raw)).toBe(out);
  });

  it.each(['', '1234', '12345678', '8555 1234', '+1 5555 1234', '5555 12345', 'abcd efgh'])(
    'teléfono inválido %j => null',
    (raw) => {
      expect(normalizePhone(raw)).toBeNull();
    },
  );

  it('enmascara el teléfono y normaliza el correo', () => {
    expect(maskPhone('+50255551234')).toBe('****1234');
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com');
    expect(normalizeEmail('sin-arroba')).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(250)}@b.co`)).toBeNull();
  });

  it('notas: recorta, vacío => null, > 280 => 400, control o bidi => 400', () => {
    expect(normalizeNotes(undefined)).toBeNull();
    expect(normalizeNotes('   ')).toBeNull();
    expect(normalizeNotes('  sin wasabi\ny sin jengibre ')).toBe('sin wasabi\ny sin jengibre');
    expect(normalizeNotes('x'.repeat(280))).toHaveLength(280);
    expect(status(() => normalizeNotes('x'.repeat(281)))).toBe(400);
    expect(status(() => normalizeNotes('a\u0000b'))).toBe(400);
    expect(status(() => normalizeNotes('a‮b'))).toBe(400);
    expect(status(() => normalizeNotes('a⁦b'))).toBe(400);
  });

  it('texto de dirección: 5-200 y referencia <= 200, sin control/bidi', () => {
    expect(normalizeAddressText({ addressLine: ' 6a avenida 12-34 ', referenceNote: ' ' })).toEqual(
      {
        addressLine: '6a avenida 12-34',
        referenceNote: null,
      },
    );
    expect(status(() => normalizeAddressText({ addressLine: 'abc' }))).toBe(400);
    expect(status(() => normalizeAddressText({ addressLine: 'x'.repeat(201) }))).toBe(400);
    expect(status(() => normalizeAddressText({ addressLine: '    ' }))).toBe(400);
    expect(
      status(() => normalizeAddressText({ addressLine: 'Calle 1-23', referenceNote: 'a\u0007' })),
    ).toBe(400);
  });

  describe('resolveContact', () => {
    it('invitado: nombre y teléfono obligatorios (400); correo opcional normalizado', () => {
      expect(
        resolveContact({ fullName: 'Ana  Pérez', phone: '5555 1234', email: 'A@B.co' }, null),
      ).toEqual({ fullName: 'Ana Pérez', phone: '+50255551234', email: 'a@b.co' });
      expect(status(() => resolveContact(undefined, null))).toBe(400);
      expect(status(() => resolveContact({ fullName: 'Ana Pérez' }, null))).toBe(400);
      expect(status(() => resolveContact({ phone: '55551234' }, null))).toBe(400);
      expect(status(() => resolveContact({ fullName: 'A', phone: '55551234' }, null))).toBe(400);
      expect(status(() => resolveContact({ fullName: 'Ana', phone: '999' }, null))).toBe(400);
      expect(
        status(() => resolveContact({ fullName: 'Ana', phone: '55551234', email: 'x' }, null)),
      ).toBe(400);
    });

    it('autenticado: lo que falta sale del perfil; cada campo de `contact` prevalece', () => {
      const profile = { fullName: 'Cliente Perfil', phone: '+50244445555', email: 'p@x.co' };
      expect(resolveContact(undefined, profile)).toEqual({
        fullName: 'Cliente Perfil',
        phone: '+50244445555',
        email: 'p@x.co',
      });
      expect(resolveContact({ phone: '5555 1234' }, profile)).toMatchObject({
        fullName: 'Cliente Perfil',
        phone: '+50255551234',
      });
    });

    it('autenticado sin teléfono válido en ambos => 422 CONTACT_INCOMPLETE', () => {
      const profile = { fullName: 'Cliente', phone: null, email: null };
      expect([
        status(() => resolveContact(undefined, profile)),
        code(() => resolveContact(undefined, profile)),
      ]).toEqual([422, 'CONTACT_INCOMPLETE']);
      expect(code(() => resolveContact({}, { ...profile, phone: 'basura' }))).toBe(
        'CONTACT_INCOMPLETE',
      );
    });

    it('un nombre de perfil con caracteres atípicos no bloquea; uno explícito inválido => 400', () => {
      const profile = { fullName: 'Juan 2', phone: '55551234', email: null };
      expect(resolveContact(undefined, profile).fullName).toBe('Juan 2');
      expect(status(() => resolveContact({ fullName: 'Juan <script>' }, profile))).toBe(400);
    });

    it('los mensajes de error no repiten la entrada (sin PII)', () => {
      try {
        resolveContact({ fullName: 'Ana Pérez', phone: '5559-secreto' }, null);
      } catch (e) {
        expect(JSON.stringify((e as { getResponse: () => unknown }).getResponse())).not.toMatch(
          /secreto|Ana/,
        );
      }
    });
  });
});
