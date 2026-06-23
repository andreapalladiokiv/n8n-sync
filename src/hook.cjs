'use strict';
// n8n EXTERNAL HOOK — shipped as part of n8n-sync (CommonJS: n8n loads hook files via
// `require()`). Mirrors UI workflow changes into the git repo in near-real-time: on
// workflow.afterUpdate / afterCreate / afterDelete it runs `n8n-sync export` into
// WORKFLOWS_DIR, debounced + serialized (a burst of saves coalesces into one export;
// exports never overlap; the result always reflects the live DB at run time).
//
// Enable by pointing n8n's EXTERNAL_HOOK_FILES at this file — `n8n-sync hook-path`
// prints its installed location. Needs WORKFLOWS_DIR / SCOPE_FILE / DB_POSTGRESDB_*
// in the n8n process env + a writable workflows dir. LOCAL/dev convenience.
const { execFile } = require('node:child_process');
const path = require('node:path');

const DEBOUNCE_MS = Number(process.env.N8N_SYNC_HOOK_DEBOUNCE_MS || 1500);

let timer = null;    // pending debounce timer
let running = false; // an export is in flight
let dirty = false;   // a change arrived since the last export started

function runExport() {
  timer = null;
  if (running || !dirty) return; // the in-flight export's completion handler re-arms
  dirty = false;
  running = true;
  const done = (err, _stdout, stderr) => {
    running = false;
    if (err) console.error(`[n8n-sync] export failed: ${String(stderr || err.message || '').trim().slice(0, 300)}`);
    else console.log('[n8n-sync] workflows exported to repo');
    if (dirty) schedule(); // coalesce changes that landed during the export
  };
  if (process.env.N8N_SYNC_BIN) {
    execFile(process.env.N8N_SYNC_BIN, ['export'], { env: process.env }, done);
  } else {
    // run the sibling CLI bundle with this same node — no PATH / exec-bit dependency
    execFile(process.execPath, [path.join(__dirname, 'n8n-sync.mjs'), 'export'], { env: process.env }, done);
  }
}

function schedule() {
  dirty = true;
  if (timer || running) return; // already armed, or will re-arm when the run finishes
  timer = setTimeout(runExport, DEBOUNCE_MS);
}

const trigger = () => schedule();

module.exports = {
  workflow: {
    afterUpdate: [trigger],
    afterCreate: [trigger],
    afterDelete: [trigger],
  },
};
