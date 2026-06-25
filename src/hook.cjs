'use strict';
// n8n EXTERNAL HOOK — shipped as part of n8n-sync (CommonJS: n8n loads hook files via
// `require()`). On a workflow change it:
//   1. keeps SCOPE_FILE (workflow-ids.json) mirroring the instance — ADD on create,
//      RENAME on update, REMOVE on delete (only if the file already exists; an absent
//      scope means "all" and must not be narrowed);
//   2. runs `n8n-sync export` into WORKFLOWS_DIR, debounced + serialized (a burst of
//      saves coalesces into one export; exports never overlap).
//
// n8n passes: workflow.afterCreate / afterUpdate -> the workflow (IWorkflowBase: .id, .name);
// workflow.afterDelete -> the workflowId (string).
//
// Enable by pointing n8n's EXTERNAL_HOOK_FILES at this file (`n8n-sync hook-path` prints
// it). Needs WORKFLOWS_DIR / SCOPE_FILE / DB_POSTGRESDB_* in the n8n process env + a
// writable WORKFLOWS_DIR and (for scope upkeep) a writable SCOPE_FILE. LOCAL/dev convenience.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEBOUNCE_MS = Number(process.env.N8N_SYNC_HOOK_DEBOUNCE_MS || 1500);

// --- scope upkeep: keep workflow-ids.json reflecting the instance --------------------
// Written IN PLACE (preserves a single-file bind mount) in the repo's canonical shape so
// diffs stay minimal. Skipped when the file is absent (= "all" scope — don't narrow it).
// SCOPE_FILE is read per-call (honors a changed env; nothing is cached at load).
function maintainScope(mutate) {
  const scopeFile = process.env.SCOPE_FILE || 'workflow-ids.json';
  if (!fs.existsSync(scopeFile)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
    const list = Array.isArray(parsed.workflows) ? parsed.workflows : [];
    if (!mutate(list)) return; // unchanged → no write (keeps afterUpdate-on-every-save quiet)
    const body = list
      .map((w) => `      { "id": ${JSON.stringify(String(w.id))}, "name": ${JSON.stringify(w.name == null ? '' : w.name)} }`)
      .join(',\n');
    fs.writeFileSync(scopeFile, `{\n  "workflows": [\n${body}\n  ]\n}\n`);
  } catch (e) {
    console.error(`[n8n-sync] scope update failed: ${String((e && e.message) || e).slice(0, 200)}`);
  }
}
// create: add if missing (a brand-new workflow joins the tracked set).
const addScope = (id, name) => maintainScope((list) => {
  if (list.some((w) => w && String(w.id) === id)) return false;
  list.push({ id, name: name == null ? '' : name }); return true;
});
// update: rename IN PLACE only if already tracked — an edit/rename of an untracked
// workflow must NOT pull it into scope (afterUpdate fires on every UI save).
const renameScope = (id, name) => maintainScope((list) => {
  const e = list.find((w) => w && String(w.id) === id);
  if (!e) return false;
  if (name != null && e.name !== name) { e.name = name; return true; }
  return false;
});
const removeScope = (id) => maintainScope((list) => {
  const i = list.findIndex((w) => w && String(w.id) === id);
  if (i < 0) return false; list.splice(i, 1); return true;                                        // delete
});

// --- debounced + serialized export ---------------------------------------------------
let timer = null;    // pending debounce timer
let running = false; // an export is in flight
let dirty = false;   // a change arrived since the last export started
function runExport() {
  timer = null;
  if (running || !dirty) return;
  dirty = false; running = true;
  const done = (err, _stdout, stderr) => {
    running = false;
    if (err) console.error(`[n8n-sync] export failed: ${String(stderr || err.message || '').trim().slice(0, 300)}`);
    else console.log('[n8n-sync] workflows exported to repo');
    if (dirty) schedule();
  };
  if (process.env.N8N_SYNC_BIN) execFile(process.env.N8N_SYNC_BIN, ['export'], { env: process.env }, done);
  else execFile(process.execPath, [path.join(__dirname, 'n8n-sync.mjs'), 'export'], { env: process.env }, done);
}
function schedule() {
  dirty = true;
  if (timer || running) return;
  timer = setTimeout(runExport, DEBOUNCE_MS);
}

// --- hook handlers: maintain the scope, then export ----------------------------------
// N8N_SYNC_HOOK_DEBUG=1 → trace which event fired with which id/name (no node params,
// so credential refs in the payload never reach the log).
const dbg = (ev, w) => {
  if (!process.env.N8N_SYNC_HOOK_DEBUG) return;
  const info = w && typeof w === 'object' ? `id=${w.id} name=${JSON.stringify(w.name)}` : `id=${w}`;
  console.log(`[n8n-sync] ${ev} ${info}`);
};
function onCreate(workflow) {
  dbg('afterCreate', workflow);
  try { if (workflow && workflow.id != null) addScope(String(workflow.id), workflow.name); } catch { /* non-fatal */ }
  schedule();
}
function onUpdate(workflow) {
  dbg('afterUpdate', workflow);
  try { if (workflow && workflow.id != null) renameScope(String(workflow.id), workflow.name); } catch { /* non-fatal */ }
  schedule();
}
function onDelete(workflowId) {
  dbg('afterDelete', workflowId);
  try {
    const id = typeof workflowId === 'string' ? workflowId : (workflowId && workflowId.id);
    if (id != null) removeScope(String(id));
  } catch { /* non-fatal */ }
  schedule();
}

module.exports = {
  workflow: {
    afterCreate: [onCreate],
    afterUpdate: [onUpdate],
    afterDelete: [onDelete],
  },
};
