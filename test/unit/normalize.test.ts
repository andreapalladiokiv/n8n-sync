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

test('normalizeWorkflow strips credential-reference name (instance-specific), keeps id', () => {
  const w = normalizeWorkflow({
    nodes: [
      { name: 'n1', credentials: { openAiApi: { id: 'abc', name: 'BDI VA > Sales VA' } } },
      { name: 'n2', credentials: { httpBasicAuth: { id: 'def', name: 'ClickHouse - admin' } } },
      { name: 'n3' }, // no credentials → untouched
    ],
  });
  const nodes = w.nodes as Array<Record<string, unknown>>;
  assert.deepEqual(nodes[0].credentials, { openAiApi: { id: 'abc' } }, 'name dropped, id kept');
  assert.deepEqual(nodes[1].credentials, { httpBasicAuth: { id: 'def' } });
  assert.equal('credentials' in nodes[2], false, 'node without creds untouched');
});

test('normalizeWorkflow does not mutate input node credentials', () => {
  const input = { nodes: [{ credentials: { openAiApi: { id: 'abc', name: 'X' } } }] };
  const before = JSON.stringify(input);
  normalizeWorkflow(input);
  assert.equal(JSON.stringify(input), before, 'input must not be mutated');
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
