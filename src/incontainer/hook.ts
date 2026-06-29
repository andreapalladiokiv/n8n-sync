import { runExport, envConfig } from './engine';
import { addScope, renameScope, removeScope } from './scope';
import { makeDebouncedRunner } from './scheduler';

/* eslint-disable @typescript-eslint/no-explicit-any */

// n8n EXTERNAL HOOK implementation (n8n-sync 2.x) — runs IN the live n8n process. On a workflow
// change it (1) keeps SCOPE_FILE mirroring the instance (./scope), then (2) runs the IN-PROCESS
// export — reusing n8n's OWN open DataSource via the bridge (NO subprocess, NO own DB connection,
// NO `n8n` CLI), debounced + serialized (./scheduler).
//
// esbuild bundles this STRAIGHT to dist/hook.cjs (the EXTERNAL_HOOK_FILES entrypoint) — no shim.
// n8n's loader does `Object.entries(require(file))` (external-hooks.js:51), so the module's OWN
// enumerable keys ARE the hook shape. We therefore export exactly one key, `workflow` (esbuild emits
// a named export as an enumerable own prop; the `__esModule` marker it also adds is NON-enumerable,
// so Object.entries skips it → n8n sees only `{ workflow }`). The onCreate/onUpdate/onDelete
// handlers stay UNexported, or they'd surface as stray top-level "resources" in that iteration.

const exporter = makeDebouncedRunner(
  () => runExport(envConfig()),
  Number(process.env.N8N_SYNC_HOOK_DEBOUNCE_MS || 1500),
  (err) => err
    ? console.error(`[n8n-sync] export failed: ${String((err as any)?.stack ?? (err as any)?.message ?? err).slice(0, 400)}`)
    : console.log('[n8n-sync] workflows exported to repo (in-process)'),
);

const dbg = (ev: string, w: any): void => {
  if (!process.env.N8N_SYNC_HOOK_DEBUG) return;
  const info = w && typeof w === 'object' ? `id=${w.id} name=${JSON.stringify(w.name)}` : `id=${w}`;
  console.log(`[n8n-sync] ${ev} ${info}`);
};

function onCreate(workflow: any): void {
  dbg('afterCreate', workflow);
  try { if (workflow?.id != null) addScope(String(workflow.id), workflow.name); } catch { /* non-fatal */ }
  exporter.schedule();
}
function onUpdate(workflow: any): void {
  dbg('afterUpdate', workflow);
  try {
    if (workflow?.id != null) {
      // Archiving in n8n is a retire (soft-delete): drop it from scope, like a delete.
      if (workflow.isArchived) removeScope(String(workflow.id));
      else renameScope(String(workflow.id), workflow.name);
    }
  } catch { /* non-fatal */ }
  exporter.schedule();
}
function onDelete(workflowId: any): void {
  dbg('afterDelete', workflowId);
  try {
    const id = typeof workflowId === 'string' ? workflowId : workflowId?.id;
    if (id != null) removeScope(String(id));
  } catch { /* non-fatal */ }
  exporter.schedule();
}

// The n8n external-hook shape — the file's ONLY export (see header). Event arg shapes per n8n's
// WorkflowHooks: workflow.afterCreate/afterUpdate receive the workflow, afterDelete receives the id.
export const workflow = {
  afterCreate: [onCreate],
  afterUpdate: [onUpdate],
  afterDelete: [onDelete],
};
