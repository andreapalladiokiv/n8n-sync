import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genId } from '../../src/ids';

test('genId: default length 16, alphanumeric', () => {
  const id = genId();
  assert.equal(id.length, 16);
  assert.match(id, /^[A-Za-z0-9]{16}$/);
});

test('genId: respects requested length', () => {
  assert.equal(genId(8).length, 8);
  assert.equal(genId(24).length, 24);
});

test('genId: no collisions across 5000 ids', () => {
  const s = new Set(Array.from({ length: 5000 }, () => genId()));
  assert.equal(s.size, 5000);
});
