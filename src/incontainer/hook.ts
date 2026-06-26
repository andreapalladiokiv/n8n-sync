import { runExport, envConfig } from './engine';
import { addScope, renameScope, removeScope } from './scope';
import { makeDebouncedRunner } from './scheduler';

/* eslint-disable @typescript-eslint/no-explicit-any */

// n8n EXTERNAL HOOK implementation (n8n-sync 2.x) — runs IN the live n8n process. On a workflow
// change it (1) keeps SCOPE_FILE mirroring the instance (./scope), then (2) runs the IN-PROCESS
// export — reusing n8n's OWN open DataSource via the bridge (NO subprocess, NO own DB connection,
// NO `n8n` CLI), debounced + serialized (./scheduler).
//
// esbuild bundles this to dist/hook-impl.cjs (named exports). The committed dist/hook.cjs shim
// assembles the n8n hook shape `{ workflow: { afterCreate:[…], … } }` from these — written that
// way because n8n iterates the export's own keys, so esbuild's __esModule/default wrapping of an
// `export default` would break the lookup.

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

export function onCreate(workflow: any): void {
  dbg('afterCreate', workflow);
  try { if (workflow?.id != null) addScope(String(workflow.id), workflow.name); } catch { /* non-fatal */ }
  exporter.schedule();
}
export function onUpdate(workflow: any): void {
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
export function onDelete(workflowId: any): void {
  dbg('afterDelete', workflowId);
  try {
    const id = typeof workflowId === 'string' ? workflowId : workflowId?.id;
    if (id != null) removeScope(String(id));
  } catch { /* non-fatal */ }
  exporter.schedule();
}
