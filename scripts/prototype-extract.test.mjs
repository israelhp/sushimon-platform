// Verifica que el extractor siga entendiendo los prototipos (detecta si cambian de estructura).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractBackoffice, extractStore, scriptByType } from './prototype-extract.mjs';

const ref = (name) =>
  readFileSync(fileURLToPath(new URL(`../docs/references/${name}`, import.meta.url)), 'utf8');

test('backoffice: manifest decodificado, plantilla, estilos y lógica presentes', () => {
  const bo = extractBackoffice(ref('backoffice-prototype.html'));
  assert.equal(bo.assets.length, 5);
  const fonts = bo.assets.filter((a) => a.mime === 'font/woff2');
  assert.equal(fonts.length, 2);
  for (const f of fonts) assert.equal(f.bytes.subarray(0, 4).toString('latin1'), 'wOF2');
  assert.match(bo.styles.join('\n'), /--primary:#DC2626/);
  assert.match(bo.logic, /class \w+ extends DCLogic|DCLogic/);
  assert.match(bo.template, /<sc-if|<sc-for/);
});

test('tienda: bundle, CSS y dos logos PNG', () => {
  const st = extractStore(ref('public-store-prototype.html'));
  assert.ok(st.js.length > 400_000);
  assert.match(st.css, /--bg:\s*250 247 242/);
  assert.equal(st.logos.length, 2);
  for (const png of st.logos) assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
});

test('scriptByType falla de forma explícita si falta el bloque', () => {
  assert.throws(() => scriptByType('<html></html>', '__bundler/manifest'), /No se encontró/);
});
