import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Bridge to the LIVE n8n runtime (n8n-sync 2.x). Resolves n8n's OWN modules so we share the
// process-wide @n8n/di Container singleton + the already-open DataSource, and call n8n's own
// services (ImportService, WorkflowRepository, ActiveWorkflowManager) instead of bundling
// @n8n/typeorm+pg / shelling to the CLI / hitting the REST API.
//
// Works from EITHER injection vector:
//   • drop-in CLI command — this code is mounted INSIDE <n8nRoot>/dist/commands, so it is a
//     first-class resident of the n8n package; n8n's modules resolve natively.
//   • external hook — this code lives OUTSIDE n8n's tree (EXTERNAL_HOOK_FILES), so we anchor a
//     `createRequire` to the n8n install root and resolve from there.
// Both cases go through `nreq()` (a createRequire anchored at <n8nRoot>/package.json), which
// resolves to the EXACT module instances n8n loaded → same Node module cache → same singletons.

let _root: string | null = null;

function isN8nPkg(dir: string): boolean {
  try {
    const pj = path.join(dir, 'package.json');
    return fs.existsSync(pj) && JSON.parse(fs.readFileSync(pj, 'utf8')).name === 'n8n';
  } catch { return false; }
}

/** Absolute path of the installed n8n package root. */
export function n8nRoot(): string {
  if (_root) return _root;
  // 1. We live inside the n8n package (command vector): walk up to its package.json.
  let dir = __dirname;
  for (let i = 0; i < 12 && dir !== path.dirname(dir); i++) {
    if (isN8nPkg(dir)) return (_root = dir);
    dir = path.dirname(dir);
  }
  // 2. Resolvable by node (the n8n process augments NODE_PATH / module._initPaths) or via the
  //    node launcher's own resolution; then env; then the conventional global install path.
  const cands: string[] = [];
  for (const base of [__filename, process.execPath]) {
    try { cands.push(path.dirname(createRequire(base).resolve('n8n/package.json'))); } catch { /* not resolvable here */ }
  }
  if (process.env.N8N_DIR) cands.push(process.env.N8N_DIR);
  cands.push('/usr/local/lib/node_modules/n8n');
  for (const c of cands) if (isN8nPkg(c)) return (_root = c);
  throw new Error('n8n-sync: could not locate the n8n install root (set N8N_DIR to override)');
}

let _req: NodeJS.Require | null = null;
function nreq(): NodeJS.Require { return (_req ??= createRequire(path.join(n8nRoot(), 'package.json'))); }

/** require an n8n DEPENDENCY by specifier (e.g. '@n8n/di', '@n8n/db', 'zod') — n8n's own copy. */
export function pkg(spec: string): any { return nreq()(spec); }

/** require an n8n COMPILED module under <n8nRoot>/dist (e.g. 'services/import.service'). */
export function dist(rel: string): any {
  const p = path.join(n8nRoot(), 'dist', /\.[cm]?js$/.test(rel) ? rel : `${rel}.js`);
  return nreq()(p);
}

/** n8n's process-wide DI Container singleton. */
export function container(): any { return pkg('@n8n/di').Container; }

/** The LIVE DataSource — the running server's open connection, or freshly opened in a CLI
 *  process. `DbConnection.init()` is idempotent (guarded by its own connectionState). */
export async function dataSource(): Promise<any> {
  const { DbConnection } = pkg('@n8n/db');
  const dbc = container().get(DbConnection);
  if (!dbc.dataSource?.isInitialized) await dbc.init();
  return dbc.dataSource;
}

/** Load node + credential types into this process — REQUIRED before activating workflows
 *  (activation builds Workflow objects and inspects trigger node types). No-op if already done. */
let _nodesLoaded = false;
export async function ensureNodesLoaded(): Promise<void> {
  if (_nodesLoaded) return;
  const { LoadNodesAndCredentials } = dist('load-nodes-and-credentials');
  await container().get(LoadNodesAndCredentials).init();
  _nodesLoaded = true;
}

/** Convenience getters for the n8n services/repositories we reuse. */
export function get<T = any>(token: any): T { return container().get(token) as T; }
export const repos = () => pkg('@n8n/db');
export const importService = (): any => get(dist('services/import.service').ImportService);
export const activeWorkflowManager = (): any => get(dist('active-workflow-manager').ActiveWorkflowManager);
/** n8n's resolved runtime config (DI singleton) — same object the stock commands read via
 *  `Container.get(GlobalConfig)`. We use `.executions.mode` ('queue' | 'regular') to gate activation. */
export const globalConfig = (): any => get(pkg('@n8n/config').GlobalConfig);
