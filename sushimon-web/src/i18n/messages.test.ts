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
