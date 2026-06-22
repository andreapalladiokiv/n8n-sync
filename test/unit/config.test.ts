import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Command } from 'commander';
import { scopeIds, resolveConfig } from '../../src/config';

function tmpJson(content: string): string {
  const f = path.join(os.tmpdir(), `ns-cfg-${process.pid}-${Math.floor(performance.now() * 1000)}.json`);
  fs.writeFileSync(f, content);
  return f;
}
const fakeCmd = (opts: Record<string, unknown>): Command => ({ opts: () => opts } as unknown as Command);

test('scopeIds: missing file → []', () => {
  assert.deepEqual(scopeIds('/no/such/file.json'), []);
});

test('scopeIds: empty workflows → []', () => {
  const f = tmpJson('{"workflows":[]}');
  assert.deepEqual(scopeIds(f), []);
  fs.rmSync(f);
});

test('scopeIds: extracts string ids, filters non-strings / missing', () => {
  const f = tmpJson(JSON.stringify({ workflows: [{ id: 'a' }, { id: 'b' }, { name: 'noid' }, { id: 5 }] }));
  assert.deepEqual(scopeIds(f), ['a', 'b']);
  fs.rmSync(f);
});

test('resolveConfig: precedence is flag > env > built-in default', () => {
  const keys = ['N8N_PROJECT_ID', 'N8N_API_KEY', 'WORKFLOWS_DIR', 'SCOPE_FILE'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    process.env.N8N_PROJECT_ID = 'envproj';
    process.env.N8N_API_KEY = 'envkey';
    process.env.WORKFLOWS_DIR = 'envwf';
    delete process.env.SCOPE_FILE;
    const cfg = resolveConfig(fakeCmd({ workflowsDir: 'flagwf', dryRun: true }));
    assert.equal(cfg.workflowsDir, 'flagwf', 'flag overrides env');
    assert.equal(cfg.projectId, 'envproj', 'env used when no flag');
    assert.equal(cfg.apiKey, 'envkey', 'api key from env');
    assert.equal(cfg.scopeFile, 'workflow-ids.json', 'built-in default when neither set');
    assert.equal(cfg.dryRun, true);
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
  }
});
