// Byte-parity test: the built CLI bundle's `normalize` must reproduce the legacy
// bash engine's `jq -S "$NORMALIZE_JQ"` output exactly. Goldens were generated
// with that jq filter (see test/fixtures/*.golden.json). Runs the REAL artifact
// (dist/n8n-sync.mjs) end-to-end, not the source — so it also guards the build.
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

const cases = fs.readdirSync(FIX).filter((f) => f.endsWith('.input.json')).map((f) => f.replace('.input.json', ''));

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
