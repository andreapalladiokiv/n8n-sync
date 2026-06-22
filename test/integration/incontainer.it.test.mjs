// In-container integration smoke. SKIPPED by default — set N8N_SYNC_IT_CONTAINER
// to the name of a running n8n container (e.g. `n8n`) to exercise the real pg +
// n8n CLI path end-to-end:
//   npm run build && N8N_SYNC_IT_CONTAINER=n8n node --import tsx --test test/integration/*.it.test.mjs
//
// (Full bash-vs-TS export/import byte-parity is validated by the dev harness, not
// here, since it mutates a sandbox and needs the bash oracle + seeding.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTAINER = process.env.N8N_SYNC_IT_CONTAINER;
const here = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(here, '..', '..', 'dist', 'n8n-sync.mjs');
const skip = CONTAINER ? false : 'set N8N_SYNC_IT_CONTAINER=<container> to run';

test('in-container: `projects` lists at least one project (native pg path works)', { skip }, () => {
  execFileSync('docker', ['cp', BUNDLE, `${CONTAINER}:/tmp/nsync-it.mjs`]);
  const out = execFileSync('docker', ['exec', CONTAINER, 'node', '/tmp/nsync-it.mjs', 'projects'], { encoding: 'utf8' });
  assert.match(out, /^[^|\n]+\|[^|\n]*\|\w+/m, `expected "id|name|type" rows on stdout, got:\n${out}`);
});

test('in-container: `normalize` canonicalizes a file (host tools + bundle run in-container)', { skip }, () => {
  const messy = '{"b":2,"a":1,"createdAt":"x","tags":[{"name":"z"},"z"]}';
  execFileSync('docker', ['exec', CONTAINER, 'sh', '-c', `printf '%s' '${messy}' > /tmp/it-wf.json && node /tmp/nsync-it.mjs normalize /tmp/it-wf.json`]);
  const out = execFileSync('docker', ['exec', CONTAINER, 'cat', '/tmp/it-wf.json'], { encoding: 'utf8' });
  assert.ok(out.startsWith('{\n  "a": 1,'), 'sorted + pretty');
  assert.ok(!out.includes('createdAt'), 'volatile field stripped');
  assert.ok(out.includes('"z"') && out.endsWith('\n'), 'tags reduced to names; trailing newline');
});
