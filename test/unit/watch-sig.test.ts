import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowSignature } from '../../src/incontainer/watch';

test('workflowSignature: stable, order-independent, reflects id+updatedAt', () => {
  const rows = [
    { id: 'b', updatedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' },
  ];
  const all = new Set<string>();
  // order-independent (sorted internally)
  const sig = workflowSignature(rows, all);
  assert.equal(sig, workflowSignature([...rows].reverse(), all));
  assert.equal(sig, 'a:2026-01-01T00:00:00.000Z|b:2026-01-02T00:00:00.000Z');
});

test('workflowSignature: a save (updatedAt bump), create, and delete all change it', () => {
  const all = new Set<string>();
  const base = [{ id: 'a', updatedAt: 't1' }, { id: 'b', updatedAt: 't1' }];
  const saved = [{ id: 'a', updatedAt: 't2' }, { id: 'b', updatedAt: 't1' }]; // 'a' re-saved
  const created = [...base, { id: 'c', updatedAt: 't1' }];
  const deleted = [{ id: 'a', updatedAt: 't1' }];
  const s = workflowSignature(base, all);
  assert.notEqual(s, workflowSignature(saved, all), 'updatedAt bump changes signature');
  assert.notEqual(s, workflowSignature(created, all), 'create changes signature');
  assert.notEqual(s, workflowSignature(deleted, all), 'delete changes signature');
});

test('workflowSignature: scoped — out-of-scope changes are ignored', () => {
  const scope = new Set(['a']);
  const before = [{ id: 'a', updatedAt: 't1' }, { id: 'b', updatedAt: 't1' }];
  const bChanged = [{ id: 'a', updatedAt: 't1' }, { id: 'b', updatedAt: 't9' }]; // only b (out of scope)
  const aChanged = [{ id: 'a', updatedAt: 't9' }, { id: 'b', updatedAt: 't1' }]; // a (in scope)
  assert.equal(workflowSignature(before, scope), workflowSignature(bChanged, scope), 'out-of-scope change ignored');
  assert.notEqual(workflowSignature(before, scope), workflowSignature(aChanged, scope), 'in-scope change detected');
});
