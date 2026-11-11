import test from 'node:test';
import assert from 'node:assert/strict';
import { diffContracts, operationsOf } from './lib.mjs';

const doc = (extra = {}) => ({
  paths: { '/v1/health': { get: { operationId: 'getHealth', responses: { 200: {} } } }, ...extra },
});

test('operationsOf lista método, ruta, operationId y códigos', () => {
  assert.deepEqual(operationsOf(doc()), ['GET /v1/health#getHealth:200']);
});

test('sin diferencias cuando coinciden', () => {
  assert.deepEqual(diffContracts(doc(), doc()), { missingInApi: [], undocumented: [] });
});

test('detecta endpoint no documentado y endpoint faltante', () => {
  const extra = { '/v1/x': { post: { operationId: 'x', responses: { 201: {} } } } };
  assert.equal(diffContracts(doc(), doc(extra)).undocumented.length, 1);
  assert.equal(diffContracts(doc(extra), doc()).missingInApi.length, 1);
});
