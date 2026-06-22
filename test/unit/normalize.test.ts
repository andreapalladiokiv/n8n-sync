import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkflow, sortKeysDeep, serializeWorkflow } from '../../src/normalize';

test('normalizeWorkflow strips volatile fields, keeps the rest', () => {
  const w = normalizeWorkflow({
    id: 'x', name: 'N', updatedAt: 'a', createdAt: 'b', versionId: 'v',
    triggerCount: 3, meta: {}, isArchived: false, versionCounter: 7, owner: {},
  });
  for (const k of ['updatedAt', 'createdAt', 'versionId', 'triggerCount', 'meta', 'isArchived', 'versionCounter', 'owner']) {
    assert.equal(k in w, false, `${k} should be stripped`);
  }
  assert.equal(w.id, 'x');
  assert.equal(w.name, 'N');
});

test('normalizeWorkflow applies defaults for missing fields', () => {
  const w = normalizeWorkflow({});
  assert.equal(w.parentFolderId, null);
  assert.equal(w.staticData, null);
  assert.deepEqual(w.pinData, {});
  assert.deepEqual(w.settings, {});
  assert.deepEqual(w.tags, []);
});

test('normalizeWorkflow tags: object→name, deduped, sorted (jq unique)', () => {
  const w = normalizeWorkflow({ tags: [{ id: '2', name: 'zeta' }, { id: '1', name: 'alpha' }, 'alpha', 'beta'] });
  assert.deepEqual(w.tags, ['alpha', 'beta', 'zeta']);
});

test('normalizeWorkflow preserves an explicit parentFolderId and does not mutate input', () => {
  const input = { parentFolderId: 'F', x: 1 };
  const w = normalizeWorkflow(input);
  assert.equal(w.parentFolderId, 'F');
  assert.equal('staticData' in input, false, 'input must not be mutated');
});

test('sortKeysDeep sorts keys recursively at every depth', () => {
  const out = sortKeysDeep({ b: 1, a: { d: 1, c: [{ z: 1, y: 2 }] } });
  assert.equal(JSON.stringify(out), JSON.stringify({ a: { c: [{ y: 2, z: 1 }], d: 1 }, b: 1 }));
});

test('serializeWorkflow: 2-space pretty, sorted keys, trailing newline', () => {
  const s = serializeWorkflow({ b: 2, a: 1 });
  assert.ok(s.endsWith('\n'), 'trailing newline');
  assert.ok(s.startsWith('{\n  "a": 1,\n  "b": 2'), `2-space + sorted: ${JSON.stringify(s)}`);
});
