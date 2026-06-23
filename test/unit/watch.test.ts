import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowSignature } from '../../src/commands/watch';

test('workflowSignature: scope filter, stable sorted order', () => {
  const rows = [
    { id: 'b', updatedAt: '2026-01-02' },
    { id: 'a', updatedAt: '2026-01-01' },
    { id: 'c', updatedAt: '2026-01-03' },
  ];
  assert.equal(workflowSignature(rows, new Set(['a', 'b'])), 'a:2026-01-01|b:2026-01-02');
  // empty scope = all workflows
  assert.equal(workflowSignature(rows, new Set()), 'a:2026-01-01|b:2026-01-02|c:2026-01-03');
});

test('workflowSignature: changes when an in-scope updatedAt changes', () => {
  const scope = new Set(['a']);
  const before = workflowSignature([{ id: 'a', updatedAt: 't1' }], scope);
  const after = workflowSignature([{ id: 'a', updatedAt: 't2' }], scope);
  assert.notEqual(before, after);
});

test('workflowSignature: ignores out-of-scope changes', () => {
  const scope = new Set(['a']);
  const s1 = workflowSignature([{ id: 'a', updatedAt: 't1' }, { id: 'z', updatedAt: 'x1' }], scope);
  const s2 = workflowSignature([{ id: 'a', updatedAt: 't1' }, { id: 'z', updatedAt: 'x2' }], scope);
  assert.equal(s1, s2);
});

test('workflowSignature: detects add/remove of an in-scope workflow', () => {
  const scope = new Set(['a', 'b']);
  const one = workflowSignature([{ id: 'a', updatedAt: 't1' }], scope);
  const two = workflowSignature([{ id: 'a', updatedAt: 't1' }, { id: 'b', updatedAt: 't1' }], scope);
  assert.notEqual(one, two);
});
