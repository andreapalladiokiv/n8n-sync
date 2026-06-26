import * as bridge from './bridge';
import { runExport, type EngineCfg } from './engine';
import { scopeIds } from '../config';

/* eslint-disable @typescript-eslint/no-explicit-any */

// `watch` — a long-lived POLLING mirror, an alternative to the realtime external hook. It runs as
// its own process (e.g. `docker exec <c> n8n n8n-sync:watch`), reuses n8n's DataSource via the
// bridge, polls a cheap change-signature of the in-scope workflows, and runs `export` whenever it
// changes. Unlike the hook it does NOT live in the server process and is not tied to
// EXTERNAL_HOOK_FILES; it catches ALL changes visible in the DB (not just main-process
// workflow.after* events), at the cost of a polling delay.

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Stable change-signature of the in-scope workflows (`id:updatedAt`, sorted). Pure. A UI/API save
 *  bumps updatedAt; create/delete change the set — so this detects them. */
export function workflowSignature(
  rows: Array<{ id: string; updatedAt: string }>,
  scope: ReadonlySet<string>,
): string {
  const inScope = scope.size ? rows.filter((r) => scope.has(r.id)) : rows;
  return inScope.map((r) => `${r.id}:${r.updatedAt}`).sort().join('|');
}

async function readSignature(ds: any, cfg: EngineCfg): Promise<string> {
  const scope = new Set(scopeIds(cfg.scopeFile));
  const rows = await ds.query('SELECT id, CAST("updatedAt" AS text) AS "updatedAt" FROM workflow_entity') as Array<{ id: string; updatedAt: string }>;
  return workflowSignature(rows, scope);
}

/** Poll the instance and export whenever in-scope workflows change. Reuses n8n's DataSource (opened
 *  once). Stops cleanly on SIGINT/SIGTERM so `docker stop` / Ctrl-C are graceful. Long-lived. */
export async function runWatch(cfg: EngineCfg, intervalMs: number): Promise<void> {
  let stopping = false;
  const stop = (): void => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const ds = await bridge.dataSource(); // open once; reuse across polls
  process.stderr.write(`==> watch: mirroring workflow changes into ./${cfg.workflowsDir} every ${Math.round(intervalMs / 1000)}s (Ctrl-C to stop)\n`);
  let last: string | null = null;
  while (!stopping) {
    try {
      const sig = await readSignature(ds, cfg);
      if (sig !== last) {
        if (last !== null) process.stderr.write('==> change detected — exporting ...\n');
        await runExport(cfg);
        last = sig;
      }
    } catch (e) {
      process.stderr.write(`watch: ${e instanceof Error ? e.message : String(e)} — retrying\n`);
    }
    for (let waited = 0; waited < intervalMs && !stopping; waited += 200) {
      await sleep(Math.min(200, intervalMs - waited)); // interruptible for a fast SIGTERM
    }
  }
  process.stderr.write('==> watch stopped\n');
}
