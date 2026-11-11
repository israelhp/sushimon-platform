import test from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from './secrets.mjs';

test('detecta secretos típicos', () => {
  const fake = [
    'AKIA' + 'ABCDEFGHIJKLMNOP',
    'ghp_' + 'a'.repeat(36),
    '-----BEGIN ' + 'PRIVATE KEY-----',
    'const password = "' + 'x'.repeat(14) + '"',
  ];
  for (const s of fake) assert.equal(scanText(s).length, 1, s);
});

test('no marca configuración legítima', () => {
  for (const s of [
    'SUPABASE_URL=',
    'DATABASE_URL=postgresql://user:pass@localhost:5432/db',
    'const password = process.env.X',
    "api_key: '<tu-clave>'",
  ]) {
    assert.equal(scanText(s).length, 0, s);
  }
});
