import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walkWorkflowJson, removeEmptyDirs } from '../../src/fsutil';

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ns-fsutil-'));
}

test('walkWorkflowJson: recurses, skips folders.json and non-json', () => {
  const d = scratch();
  fs.writeFileSync(path.join(d, 'a.json'), '{}');
  fs.writeFileSync(path.join(d, 'folders.json'), '[]');
  fs.writeFileSync(path.join(d, 'note.txt'), 'x');
  fs.mkdirSync(path.join(d, 'sub'));
  fs.writeFileSync(path.join(d, 'sub', 'b.json'), '{}');
  fs.mkdirSync(path.join(d, 'empty'));
  const found = walkWorkflowJson(d).map((p) => path.relative(d, p)).sort();
  assert.deepEqual(found, ['a.json', path.join('sub', 'b.json')]);
  fs.rmSync(d, { recursive: true, force: true });
});

test('walkWorkflowJson: missing dir → []', () => {
  assert.deepEqual(walkWorkflowJson('/no/such/dir'), []);
});

test('removeEmptyDirs: prunes empty dirs, keeps non-empty', () => {
  const d = scratch();
  fs.mkdirSync(path.join(d, 'empty', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(d, 'full'));
  fs.writeFileSync(path.join(d, 'full', 'x.json'), '{}');
  removeEmptyDirs(d);
  assert.equal(fs.existsSync(path.join(d, 'empty')), false);
  assert.equal(fs.existsSync(path.join(d, 'full', 'x.json')), true);
  fs.rmSync(d, { recursive: true, force: true });
});
