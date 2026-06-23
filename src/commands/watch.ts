import { Db } from '../db';
import { scopeIds } from '../config';
import { cmdExport } from './export';
import type { Config } from '../config';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Stable change-signature of the in-scope workflows (id:updatedAt, sorted). Pure. */
export function workflowSignature(
  rows: Array<{ id: string; updatedAt: string }>,
  scope: ReadonlySet<string>,
): string {
  const inScope = scope.size ? rows.filter((r) => scope.has(r.id)) : rows;
  return inScope.map((r) => `${r.id}:${r.updatedAt}`).sort().join('|');
}

async function readSignature(cfg: Config): Promise<string> {
  const scope = new Set(scopeIds(cfg.scopeFile));
  const db = await Db.open();
  try {
    const rows = await db.rows<{ id: string; updatedAt: string }>(
      'SELECT id, "updatedAt"::text AS "updatedAt" FROM workflow_entity',
    );
    return workflowSignature(rows, scope);
  } finally {
    await db.close();
  }
}

/**
 * Poll the instance and export when in-scope workflows change. Fully independent of
 * n8n (no hooks/env/patches) — reads its DB and writes the repo. Meant to run as a
 * local sidecar; stops cleanly on SIGINT/SIGTERM so `docker compose down` is graceful.
 */
export async function cmdWatch(cfg: Config, intervalMs: number): Promise<void> {
  let stopping = false;
  const stop = (): void => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  process.stderr.write(`==> watch: mirroring workflow changes into ./${cfg.workflowsDir} every ${Math.round(intervalMs / 1000)}s (Ctrl-C to stop)\n`);
  let last: string | null = null;
  while (!stopping) {
    try {
      const sig = await readSignature(cfg);
      if (sig !== last) {
        if (last !== null) process.stderr.write('==> change detected — exporting ...\n');
        await cmdExport(cfg);
        last = sig;
      }
    } catch (e) {
      process.stderr.write(`watch: ${e instanceof Error ? e.message : String(e)} — retrying\n`);
    }
    for (let waited = 0; waited < intervalMs && !stopping; waited += 200) {
      await sleep(Math.min(200, intervalMs - waited)); // interruptible sleep for fast SIGTERM
    }
  }
  process.stderr.write('==> watch stopped\n');
}
