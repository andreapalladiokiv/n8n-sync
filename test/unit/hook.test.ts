import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('hook: a burst coalesces into ONE export, serialized; a later change re-fires', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-hook-'));
  const log = path.join(dir, 'log');
  const bin = path.join(dir, 'stub-export');
  // stub `n8n-sync export`: record start, take time, record end
  fs.writeFileSync(bin, '#!/usr/bin/env bash\necho start >> "$LOG"\nsleep 0.2\necho end >> "$LOG"\n');
  fs.chmodSync(bin, 0o755);

  process.env.N8N_SYNC_BIN = bin;
  process.env.N8N_SYNC_HOOK_DEBOUNCE_MS = '200';
  process.env.LOG = log;

  const require = createRequire(import.meta.url);
  const hook = require('../../src/hook.cjs') as { workflow: { afterUpdate: Array<() => void>; afterCreate: Array<() => void> } };
  const onUpdate = hook.workflow.afterUpdate[0]!;
  const onCreate = hook.workflow.afterCreate[0]!;

  const reads = (): string[] => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);

  for (let i = 0; i < 6; i++) onUpdate();   // burst of 6 rapid saves
  await delay(80);
  onUpdate(); onCreate();                     // more saves still inside the debounce window
  await delay(700);                           // let the (single) coalesced export run + finish
  assert.equal(reads().filter((l) => l === 'start').length, 1, `burst must coalesce into 1 export; got ${reads()}`);

  onUpdate();                                 // a save AFTER the first export finished
  await delay(700);
  const lines = reads();
  assert.equal(lines.filter((l) => l === 'start').length, 2, `later save must re-fire; got ${lines}`);
  // serialized: starts and ends strictly alternate (no overlapping exports)
  assert.deepEqual(lines, ['start', 'end', 'start', 'end'], `exports must not overlap; got ${lines}`);

  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.N8N_SYNC_BIN; delete process.env.N8N_SYNC_HOOK_DEBOUNCE_MS; delete process.env.LOG;
});

test('hook: maintains SCOPE_FILE — create adds, update renames, delete removes; absent file untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-hook-scope-'));
  const scope = path.join(dir, 'workflow-ids.json');
  const bin = path.join(dir, 'noop'); fs.writeFileSync(bin, '#!/usr/bin/env bash\ntrue\n'); fs.chmodSync(bin, 0o755);
  process.env.N8N_SYNC_BIN = bin;

  const require = createRequire(import.meta.url);
  const hook = require('../../src/hook.cjs') as {
    workflow: { afterCreate: Array<(w: unknown) => void>; afterUpdate: Array<(w: unknown) => void>; afterDelete: Array<(id: string) => void> };
  };
  const onCreate = hook.workflow.afterCreate[0]!, onUpdate = hook.workflow.afterUpdate[0]!, onDelete = hook.workflow.afterDelete[0]!;
  const ids = (): Array<{ id: string; name: string }> => JSON.parse(fs.readFileSync(scope, 'utf8')).workflows;

  process.env.SCOPE_FILE = scope;
  onCreate({ id: 'a', name: 'Alpha' });
  assert.equal(fs.existsSync(scope), false, 'absent scope must NOT be created (empty = all)');

  fs.writeFileSync(scope, '{\n  "workflows": []\n}\n');
  onCreate({ id: 'a', name: 'Alpha' });
  assert.deepEqual(ids(), [{ id: 'a', name: 'Alpha' }], 'create adds {id,name}');
  onUpdate({ id: 'a', name: 'Alpha v2' });
  assert.deepEqual(ids(), [{ id: 'a', name: 'Alpha v2' }], 'update renames in place');
  onUpdate({ id: 'a', name: 'Alpha v2' });
  assert.equal(ids().length, 1, 'no-op update does not duplicate');
  onUpdate({ id: 'untracked', name: 'Ghost' });
  assert.deepEqual(ids().map((w) => w.id), ['a'], 'update of an UNtracked id must NOT add it to scope');
  onCreate({ id: 'b', name: 'Beta' });
  assert.equal(ids().length, 2, 'second create appends');
  onDelete('a');
  assert.deepEqual(ids(), [{ id: 'b', name: 'Beta' }], 'delete removes by id');
  onUpdate({ id: 'b', name: 'Beta', isArchived: true });
  assert.deepEqual(ids(), [], 'archiving (afterUpdate with isArchived) removes from scope like a delete');

  await delay(300); // drain any debounced (noop) export before cleanup
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.N8N_SYNC_BIN; delete process.env.SCOPE_FILE;
});
