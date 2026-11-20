import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Detecta claves duplicadas dentro de un mismo objeto de los mensajes. `JSON.parse` las acepta en
 * silencio y gana la última, lo que dejó un botón del backoffice con un texto de otra clave
 * (`backoffice.reports.history.dayToday` existía dos veces). Los archivos se mantienen con
 * Prettier (una clave por línea, sangría de 2 espacios), así que basta recorrer las líneas.
 */
function duplicateKeys(source: string): string[] {
  const seen = new Map<number, Set<string>>();
  const duplicates: string[] = [];
  source.split('\n').forEach((line, index) => {
    const indent = /^(\s*)\S/.exec(line)?.[1]?.length;
    if (indent === undefined) return;
    // Cualquier línea (también `{`, `}` o `]`) a un nivel menos profundo cierra los objetos
    // hijos anteriores: así los elementos de un array de objetos no se cuentan como uno solo.
    for (const level of [...seen.keys()]) if (level > indent) seen.delete(level);
    const match = /^\s*"((?:[^"\\]|\\.)*)":/.exec(line);
    if (!match) return;
    const keys = seen.get(indent) ?? new Set<string>();
    if (keys.has(match[1]!)) duplicates.push(`línea ${index + 1}: "${match[1]}"`);
    keys.add(match[1]!);
    seen.set(indent, keys);
  });
  return duplicates;
}

describe('mensajes i18n', () => {
  for (const locale of ['es', 'en']) {
    it(`${locale}.json no repite claves dentro de un mismo objeto`, () => {
      const source = readFileSync(join(__dirname, 'messages', `${locale}.json`), 'utf8');
      expect(duplicateKeys(source)).toEqual([]);
    });
  }

  it('detecta una clave duplicada (control de la propia prueba)', () => {
    const source = [
      '{',
      '  "a": {',
      '    "x": 1,',
      '    "x": 2',
      '  },',
      '  "b": {',
      '    "x": 3',
      '  }',
      '}',
    ].join('\n');
    expect(duplicateKeys(source)).toEqual(['línea 4: "x"']);
  });
});

describe('mensajes del carrito (F18, #37)', () => {
  const read = (locale: string) =>
    JSON.parse(readFileSync(join(__dirname, 'messages', `${locale}.json`), 'utf8')) as {
      cart: Record<string, unknown>;
    };
  const flatten = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([k, v]) => flatten(v, `${prefix}${k}.`))
      : [prefix.slice(0, -1)];

  it('es y en tienen EXACTAMENTE las mismas claves cart.*', () => {
    expect(flatten(read('en').cart).sort()).toEqual(flatten(read('es').cart).sort());
  });

  it('ninguna clave cart.* está vacía', () => {
    for (const locale of ['es', 'en']) {
      const walk = (v: unknown): void => {
        if (typeof v === 'string') expect(v.trim().length).toBeGreaterThan(0);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(read(locale).cart);
    }
  });
});

describe('F23 · mensajes del historial, el recibo y «Volver a pedir» (es/en)', () => {
  const read = (locale: string) =>
    JSON.parse(readFileSync(join(__dirname, 'messages', `${locale}.json`), 'utf8')) as Record<
      string,
      unknown
    >;
  const flatten = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
      : [prefix];
  const pick = (messages: Record<string, unknown>, path: string): unknown =>
    path
      .split('.')
      .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
  const es = read('es');
  const en = read('en');

  it.each(['orders.history', 'receipt', 'reorder'])(
    '%s tiene las MISMAS claves en es y en en, ninguna vacía',
    (path) => {
      const a = flatten(pick(es, path)).sort();
      const b = flatten(pick(en, path)).sort();
      expect(a.length).toBeGreaterThan(3);
      expect(b).toEqual(a);
      for (const key of a) {
        expect(String(pick(es, `${path}.${key}`)).trim(), `es ${path}.${key}`).not.toBe('');
        expect(String(pick(en, `${path}.${key}`)).trim(), `en ${path}.${key}`).not.toBe('');
      }
    },
  );

  it('incluye la leyenda no fiscal y los 11 códigos de diagnóstico en ambos idiomas', () => {
    const codes = [
      'PRODUCT_REMOVED',
      'PRODUCT_INACTIVE',
      'PRODUCT_OUT_OF_STOCK',
      'BRANCH_UNAVAILABLE',
      'OPTION_REMOVED',
      'OPTION_INACTIVE',
      'GROUP_RULE_CHANGED',
      'REQUIRED_SELECTION_MISSING',
      'PRICE_CHANGED',
      'QUANTITY_ADJUSTED',
      'NOTE_DROPPED',
    ];
    for (const m of [es, en]) {
      for (const code of codes) expect(pick(m, `reorder.issue.${code}`), code).toBeTruthy();
      expect(String(pick(m, 'receipt.notFiscal'))).toMatch(/factura|invoice/i);
    }
    expect(pick(es, 'receipt.notFiscal')).toBe(
      'Este documento es un recibo informativo del pedido. No es una factura ni un documento fiscal.',
    );
  });

  it('el español nuevo usa tuteo (sin voseo) en el historial, el recibo y la reorden', () => {
    const voseo =
      /(tenés|querés|podés|elegí|revisá|intentá|mirá|hacé|abrí|esperá|guardá|iniciá|consultá|agregá)\b/i;
    for (const path of ['orders.history', 'receipt', 'reorder']) {
      const text = JSON.stringify(pick(es, path));
      expect(voseo.test(text), path).toBe(false);
    }
  });
});

describe('F24 · mensajes del pago en efectivo (es/en)', () => {
  const read = (locale: string) =>
    JSON.parse(readFileSync(join(__dirname, 'messages', `${locale}.json`), 'utf8')) as Record<
      string,
      unknown
    >;
  const flatten = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
      : [prefix];
  const pick = (messages: Record<string, unknown>, path: string): unknown =>
    path
      .split('.')
      .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
  const es = read('es');
  const en = read('en');
  const NAMESPACES = ['payments', 'payment', 'backoffice.orders.live.payment'];

  it.each(NAMESPACES)('%s tiene las MISMAS claves en es y en, ninguna vacía', (path) => {
    const a = flatten(pick(es, path)).sort();
    expect(a.length).toBeGreaterThan(3);
    expect(flatten(pick(en, path)).sort()).toEqual(a);
    for (const key of a) {
      expect(String(pick(es, `${path}.${key}`)).trim(), `es ${path}.${key}`).not.toBe('');
      expect(String(pick(en, `${path}.${key}`)).trim(), `en ${path}.${key}`).not.toBe('');
    }
  });

  it('el español nuevo usa tuteo (sin voseo)', () => {
    const voseo =
      /(tenés|querés|podés|elegí|revisá|intentá|mirá|hacé|abrí|esperá|guardá|iniciá|consultá|agregá|marcá|escribí|usá|pagás|seleccioná)\b/i;
    for (const path of NAMESPACES) {
      expect(voseo.test(JSON.stringify(pick(es, path))), path).toBe(false);
    }
  });

  it('los mensajes fijos del checkout dicen exactamente lo acordado', () => {
    expect(pick(es, 'payment.cashPickup')).toBe(
      'Realiza el pago en efectivo cuando recojas tu pedido en la sucursal.',
    );
    expect(pick(es, 'payment.cashDelivery')).toBe(
      'Realiza el pago en efectivo cuando recibas tu pedido.',
    );
    expect(pick(en, 'payment.cashPickup')).toBe(
      'Pay in cash when you pick up your order at the branch.',
    );
    expect(pick(en, 'payment.cashDelivery')).toBe('Pay in cash when you receive your order.');
  });

  it('no quedan restos de transferencia, tarjeta ni Neonet en los textos de pago (checkout, cliente y backoffice)', () => {
    const FORBIDDEN = /transferencia|transfer\b|bank transfer|tarjeta|card\b|neonet|comprobante/i;
    for (const m of [es, en]) {
      for (const path of [
        'payments',
        'payment',
        'backoffice.orders.live.payment',
        'receipt.payment',
      ]) {
        expect(FORBIDDEN.test(JSON.stringify(pick(m, path))), path).toBe(false);
      }
      expect(pick(m, 'neonet')).toBeUndefined();
    }
  });
});
