// Canonical-form regression test: the built CLI bundle's `normalize` must reproduce the
// pinned goldens byte-for-byte (test/fixtures/*.golden.json). The goldens started as the
// legacy bash engine's `jq -S "$NORMALIZE_JQ"` output and now additionally have node
// credential-reference `name` fields stripped — an intentional post-bash change so
// workflows stay portable + stable across instances (the same credential id is named
// differently on each one). `settings.availableInMCP` (an instance-side MCP-exposure
// toggle) is likewise stripped; neither field appears in these fixtures, so the goldens
// are unchanged by either strip. Runs the REAL artifact (dist/n8n-sync.mjs), so it guards
// the build too. (Both strips are also covered directly in unit/normalize.test.ts.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(here, '..', 'dist', 'n8n-sync.mjs');
const FIX = path.join(here, 'fixtures');

const cases = fs.readdirSync(FIX)
    .filter(f => f.endsWith('.input.json'))
    .map(f => f.replace('.input.json', ''));

function runNormalize(srcPath) {
  const tmp = path.join(os.tmpdir(), `nsp-${path.basename(srcPath)}-${process.pid}-${Math.floor(performance.now())}.json`);
  fs.copyFileSync(srcPath, tmp);
  execFileSync('node', [BUNDLE, 'normalize', tmp]);
  const out = fs.readFileSync(tmp, 'utf8');
  fs.rmSync(tmp);
  return out;
}

for (const base of cases) {
  test(`normalize parity vs jq golden: ${base}`, () => {
    const golden = fs.readFileSync(path.join(FIX, `${base}.golden.json`), 'utf8');
    assert.equal(runNormalize(path.join(FIX, `${base}.input.json`)), golden, `${base}: must match jq -S byte-for-byte`);
  });
}

test('normalize is idempotent (normalizing a golden is a no-op)', () => {
  for (const base of cases) {
    const goldenPath = path.join(FIX, `${base}.golden.json`);
    assert.equal(runNormalize(goldenPath), fs.readFileSync(goldenPath, 'utf8'), `${base}: re-normalize changed the file`);
  }
});
