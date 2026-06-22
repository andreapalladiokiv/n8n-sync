import fs from 'node:fs';
import type { Command } from 'commander';

/** Engine config. The TS engine runs LOCAL to the n8n it targets (in-container):
 *  no container name / no --remote — the host wrapper (Makefile/CI) picks which
 *  container to `docker exec` into. DB creds come from n8n's own DB_POSTGRESDB_* env. */
export interface Config {
  /** Project that owns imported workflows + folders; empty → oldest personal. */
  projectId?: string;
  /** n8n public API key → live activation; empty → CLI publish (needs restart). */
  apiKey?: string;
  workflowsDir: string;
  scopeFile: string;
  dryRun: boolean;
}

interface FlagOpts {
  projectId?: string;
  workflowsDir?: string;
  scopeFile?: string;
  dryRun?: boolean;
}

/** Merge command flags with env and defaults (flag > env > default). */
export function resolveConfig(cmd: Command): Config {
  const o = cmd.opts<FlagOpts>();
  const env = process.env;
  return {
    projectId: o.projectId ?? env.N8N_PROJECT_ID ?? undefined,
    apiKey: env.N8N_API_KEY ?? undefined,
    workflowsDir: o.workflowsDir ?? env.WORKFLOWS_DIR ?? 'workflows',
    scopeFile: o.scopeFile ?? env.SCOPE_FILE ?? 'workflow-ids.json',
    dryRun: o.dryRun ?? false,
  };
}

/** Workflow ids this repo manages; empty array (or missing file) = manage all. */
export function scopeIds(scopeFile: string): string[] {
  if (!fs.existsSync(scopeFile)) return [];
  const parsed = JSON.parse(fs.readFileSync(scopeFile, 'utf8')) as { workflows?: { id?: string }[] };
  return (parsed.workflows ?? []).map((w) => w.id).filter((id): id is string => typeof id === 'string');
}
