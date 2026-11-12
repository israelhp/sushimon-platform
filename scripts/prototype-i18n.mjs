#!/usr/bin/env node
// Convierte los diccionarios es/en de la tienda (extraídos a docs/ui/extracted/store/i18n.pretty.js)
// a mensajes JSON con sintaxis ICU para next-intl. Solo evalúa el literal de datos en un contexto
// `vm` vacío (sin require, sin globals de Node); las funciones de interpolación se invocan con
// marcadores para obtener la plantilla ICU equivalente. Uso de una sola vez: el resultado se
// revisa a mano y se versiona en sushimon-web/src/i18n/messages/.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const [src, outDir] = process.argv.slice(2);
const code = readFileSync(src, 'utf8')
  .replace(/,\s*Hp = [\s\S]*$/, ';')
  .replace(/^const ar = [^\n]*\n\s*e1/, 'const e1')
  .replace(/\n\s*sr = [^\n]*\n\s*t1/, '\n  t1');
const ARGS = ['a', 'b', 'c', 'd'];

const PLACEHOLDER = /^\{([a-d])\}$/;
function marker(name) {
  // Cadena que se comporta como placeholder: toLowerCase/toUpperCase devuelven el mismo marcador.
  const s = new String(`{${name}}`);
  s.toLowerCase = () => `{${name}}`;
  s.toUpperCase = () => `{${name}}`;
  return s;
}
const ar = (n, one, other) => {
  const m = String(n).match(PLACEHOLDER);
  return m
    ? `{${m[1]}, plural, one {# ${one}} other {# ${other}}}`
    : `${n} ${n === 1 ? one : other}`;
};
const ctx = vm.createContext({ ar, sr: ar });
vm.runInContext(`${code}\nthis.__dicts = { en: e1, es: t1 };`, ctx, { timeout: 1000 });

function convert(value, path, issues) {
  if (typeof value === 'function') {
    const out = value(...ARGS.slice(0, value.length).map(marker));
    if (typeof out !== 'string') issues.push(`${path}: función no devuelve string`);
    return escapeIcu(String(out));
  }
  if (Array.isArray(value)) return value.map((v, i) => convert(v, `${path}.${i}`, issues));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, convert(v, `${path}.${k}`, issues)]),
    );
  }
  return typeof value === 'string' ? escapeIcu(value, true) : value;
}

/** Escapa apóstrofos ICU; en cadenas literales también llaves. */
function escapeIcu(s, literal = false) {
  let r = s.replace(/'/g, "''");
  if (literal) r = r.replace(/[{}]/g, (c) => `'${c}'`);
  return r;
}

// Funciones con lógica condicional (no solo interpolación): traducidas a ICU a mano.
const OVERRIDES = {
  es: {
    'hub.addressesSub':
      '{a, plural, =0 {Agregá tu casa o trabajo} one {# dirección guardada} other {# direcciones guardadas}}',
    'hub.favoritesSub':
      '{a, plural, =0 {Guardá tus productos preferidos} one {# producto} other {# productos}}',
    'hub.ordersSub':
      '{a, plural, one {# pedido} other {# pedidos}}{b, plural, =0 {} other { · # en curso}}',
    'reorder.unavailableNote':
      '{a, plural, one {1 producto ya no está disponible y no se agregará.} other {# productos ya no están disponibles y no se agregarán.}}',
  },
  en: {
    'hub.addressesSub':
      '{a, plural, =0 {Add your home or work} one {# saved address} other {# saved addresses}}',
    'hub.favoritesSub': '{a, plural, =0 {Save the items you love} one {# item} other {# items}}',
    'hub.ordersSub':
      '{a, plural, one {# order} other {# orders}}{b, plural, =0 {} other { · # in progress}}',
    'reorder.unavailableNote':
      '{a, plural, one {1 item is no longer available and won’t be added.} other {# items are no longer available and won’t be added.}}',
  },
};

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  if (!(last in target)) throw new Error(`Override sin clave de origen: ${path}`);
  target[last] = value;
}

const issues = [];
for (const lang of ['es', 'en']) {
  const dict = convert(ctx.__dicts[lang], lang, issues);
  for (const [path, value] of Object.entries(OVERRIDES[lang])) setPath(dict, path, value);
  writeFileSync(`${outDir}/${lang}.json`, `${JSON.stringify(dict, null, 2)}\n`);
}
if (issues.length) console.warn(issues.join('\n'));
console.log('prototype-i18n: OK');
