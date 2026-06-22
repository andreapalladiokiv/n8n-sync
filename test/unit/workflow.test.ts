import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagName, credsOf } from '../../src/workflow';

test('tagName: string passthrough, object→name, else undefined', () => {
  assert.equal(tagName('x'), 'x');
  assert.equal(tagName({ name: 'y' }), 'y');
  assert.equal(tagName({}), undefined);
  assert.equal(tagName(null), undefined);
});

test('credsOf: collects node credentials, unique by id (first wins)', () => {
  const wf = {
    nodes: [
      { credentials: { openAiApi: { id: 'a', name: 'A' } } },
      { credentials: { postgres: { id: 'b', name: 'B' }, http: { name: 'no-id' } } },
      { credentials: { openAiApi: { id: 'a', name: 'dup' } } },
    ],
  };
  assert.deepEqual(credsOf(wf, false), [
    { id: 'a', name: 'A', type: 'openAiApi' },
    { id: 'b', name: 'B', type: 'postgres' },
  ]);
});

test('credsOf: enabledOnly skips disabled nodes', () => {
  const wf = {
    nodes: [
      { disabled: true, credentials: { x: { id: 'a', name: 'A' } } },
      { credentials: { y: { id: 'b', name: 'B' } } },
    ],
  };
  assert.deepEqual(credsOf(wf, true), [{ id: 'b', name: 'B', type: 'y' }]);
  assert.equal(credsOf(wf, false).length, 2);
});

test('credsOf: missing-id credential is ignored; name defaults to empty', () => {
  const wf = { nodes: [{ credentials: { z: { name: 'no-id' } } }, { credentials: { w: { id: 'c' } } }] };
  assert.deepEqual(credsOf(wf, false), [{ id: 'c', name: '', type: 'w' }]);
});

test('credsOf: no nodes → []', () => {
  assert.deepEqual(credsOf({}, false), []);
});
