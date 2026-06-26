import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addScope, renameScope, removeScope } from '../../src/incontainer/scope';

test('scope: create adds, update renames in place, delete/archive removes; absent file untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-scope-'));
  const scope = path.join(dir, 'workflow-ids.json');
  const ids = (): Array<{ id: string; name: string }> => JSON.parse(fs.readFileSync(scope, 'utf8')).workflows;
  process.env.SCOPE_FILE = scope;
  try {
    addScope('a', 'Alpha');
    assert.equal(fs.existsSync(scope), false, 'absent scope must NOT be created (empty = all)');

    fs.writeFileSync(scope, '{\n  "workflows": []\n}\n');
    addScope('a', 'Alpha');
    assert.deepEqual(ids(), [{ id: 'a', name: 'Alpha' }], 'create adds {id,name}');
    renameScope('a', 'Alpha v2');
    assert.deepEqual(ids(), [{ id: 'a', name: 'Alpha v2' }], 'update renames in place');
    renameScope('a', 'Alpha v2');
    assert.equal(ids().length, 1, 'no-op rename does not duplicate');
    renameScope('untracked', 'Ghost');
    assert.deepEqual(ids().map((w) => w.id), ['a'], 'rename of an UNtracked id must NOT add it');
    addScope('b', 'Beta');
    assert.equal(ids().length, 2, 'second create appends');
    removeScope('a');
    assert.deepEqual(ids(), [{ id: 'b', name: 'Beta' }], 'delete removes by id');
    removeScope('b'); // archive path also calls removeScope
    assert.deepEqual(ids(), [], 'archive/delete empties the list');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.SCOPE_FILE;
  }
});
