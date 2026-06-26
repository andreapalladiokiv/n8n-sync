import fs from 'node:fs';
import path from 'node:path';
import * as bridge from './bridge';
import { serializeWorkflow } from '../normalize';
import { buildFolderPath } from '../folders';
import { walkWorkflowJson, removeEmptyDirs } from '../fsutil';
import { scopeIds } from '../config';
import type { Workflow } from '../workflow';

/* eslint-disable @typescript-eslint/no-explicit-any */

// In-process engine (n8n-sync 2.x): runs INSIDE the n8n runtime and reuses n8n's own open
// DataSource + services. Replaces the 1.x trio (own @n8n/typeorm DataSource + the `n8n` CLI +
// the REST activation) — see ./bridge for how the live runtime is resolved.

export interface EngineCfg {
  projectId?: string;
  workflowsDir: string;
  scopeFile: string;
  dryRun: boolean;
}

export function envConfig(): EngineCfg {
  const e = process.env;
  return {
    projectId: e.N8N_PROJECT_ID || undefined,
    workflowsDir: e.WORKFLOWS_DIR || 'workflows',
    scopeFile: e.SCOPE_FILE || 'workflow-ids.json',
    dryRun: e.N8N_SYNC_DRY_RUN === '1',
  };
}

const err = (s: string): void => void process.stderr.write(s);

interface FolderRow { id: string; name: string; parentFolderId: string | null }
interface FolderManifest { id: string; name: string; parentFolderId: string | null }

/** The on-disk form of a live workflow entity, byte-identical to what 1.x produced via
 *  `export:workflow --all` + normalize: take the entity as-is (tags relation loaded) and
 *  canonicalize. `versionMetadata:null` mirrors the CLI's `--all` (no history merge) shape;
 *  normalize strips it anyway, so it only matters for parity of the pre-normalized object. */
function serializeEntity(wf: any): string {
  return serializeWorkflow({ ...wf, versionMetadata: null } as Workflow);
}

/** Read all workflow entities (tags loaded) — the in-process equivalent of `export:workflow --all`.
 *  `parentFolderId` is NOT reliably populated on the find() entity, so we overlay it from an
 *  authoritative query (same as the 1.x engine did) — folder placement + change-detection need it. */
async function findAllWorkflows(ds: any): Promise<any[]> {
  const { WorkflowRepository } = bridge.repos();
  const list = await bridge.get<any>(WorkflowRepository).find({ relations: ['tags'] });
  const rows = await ds.query('SELECT id, "parentFolderId" AS pf FROM workflow_entity') as { id: string; pf: string | null }[];
  const pf = new Map(rows.map((r) => [r.id, r.pf]));
  for (const wf of list) wf.parentFolderId = pf.get(wf.id as string) ?? null;
  return list;
}

// ----------------------------------------------------------------------------- EXPORT

export async function runExport(cfg: EngineCfg): Promise<void> {
  const scope = new Set(scopeIds(cfg.scopeFile));
  const inScope = (id: string): boolean => scope.size === 0 || scope.has(id);

  err('==> Exporting workflows from n8n (in-process; reusing n8n\'s DataSource) ...\n');
  const ds = await bridge.dataSource();
  const all = await findAllWorkflows(ds);

  // Data-loss guard (mirrors 1.x): a count mismatch means a broken read — refuse to wipe the tree.
  const total = Number((await ds.query('SELECT count(*) AS n FROM workflow_entity'))[0]?.n) || 0;
  if (all.length === 0 && total > 0) {
    throw new Error(`read 0 workflows but the instance has ${total} — aborting (repo left untouched)`);
  }

  const folders = await ds.query('SELECT id, name, "parentFolderId" FROM folder ORDER BY id') as FolderRow[];
  const names = new Map(folders.map((f) => [f.id, f.name]));
  const parents = new Map(folders.map((f) => [f.id, f.parentFolderId]));
  const archived = new Set(all.filter((w) => w.isArchived === true).map((w) => w.id as string));

  // Rebuild from scratch so folder MOVES are reflected; out-of-scope + archived files pruned.
  fs.mkdirSync(cfg.workflowsDir, { recursive: true });
  for (const f of walkWorkflowJson(cfg.workflowsDir)) fs.rmSync(f);

  const used = new Set<string>();
  let kept = 0;
  let pruned = 0;
  for (const wf of all) {
    const id = wf.id as string;
    if (!inScope(id)) continue;
    if (archived.has(id)) { pruned++; continue; }
    const pfid = (wf.parentFolderId as string | null) ?? null;
    if (pfid) for (let c: string | null = pfid; c && parents.has(c); c = parents.get(c) ?? null) used.add(c);
    const rel = pfid ? buildFolderPath(pfid, names, parents) : '';
    const destDir = rel ? path.join(cfg.workflowsDir, rel) : cfg.workflowsDir;
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, `${id}.json`), serializeEntity(wf));
    kept++;
  }

  const manifest: FolderManifest[] = folders
    .filter((f) => used.has(f.id))
    .map((f) => ({ id: f.id, name: f.name, parentFolderId: f.parentFolderId }));
  fs.writeFileSync(path.join(cfg.workflowsDir, 'folders.json'), JSON.stringify(manifest, null, 2) + '\n');

  removeEmptyDirs(cfg.workflowsDir);
  if (pruned) err(`==> pruned ${pruned} archived workflow(s) from ./${cfg.workflowsDir}/\n`);
  err(`==> ${kept} workflow(s) + ${manifest.length} folder(s) in ./${cfg.workflowsDir}/ — review 'git diff', then commit.\n`);
}

// ----------------------------------------------------------------------------- PROJECTS

/** List the instance's projects (id|name|type) to pick an N8N_PROJECT_ID. */
export async function runProjects(): Promise<void> {
  const ds = await bridge.dataSource();
  const rows = await ds.query('SELECT id, name, type FROM project ORDER BY "createdAt", id') as { id: string; name: string; type: string }[];
  for (const p of rows) process.stdout.write(`${p.id}|${p.name}|${p.type}\n`);
  err(`==> ${rows.length} project(s).\n`);
}

// ----------------------------------------------------------------------------- IMPORT

const readJson = (file: string): any => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Resolve the target project + the user id to attribute the import to (mirrors the CLI). */
async function resolveProjectAndUser(cfg: EngineCfg): Promise<{ projectId: string; userId: string }> {
  const { ProjectRepository, UserRepository, GLOBAL_OWNER_ROLE } = bridge.repos();
  const ownerUser = await bridge.get<any>(UserRepository).findOneByOrFail({ role: { slug: GLOBAL_OWNER_ROLE.slug } });
  const userId = ownerUser.id as string;
  const projectRepo = bridge.get<any>(ProjectRepository);
  const project = cfg.projectId
    ? await projectRepo.findOneByOrFail({ id: cfg.projectId })
    : await projectRepo.getPersonalProjectForUserOrFail(userId);
  return { projectId: project.id as string, userId };
}

export async function runImport(cfg: EngineCfg): Promise<number> {
  const scope = new Set(scopeIds(cfg.scopeFile));
  const inScope = (id: string): boolean => scope.size === 0 || scope.has(id);
  let files = walkWorkflowJson(cfg.workflowsDir).sort();
  if (scope.size) {
    const kept = files.filter((f) => inScope(path.basename(f, '.json')));
    for (const f of files) if (!kept.includes(f)) err(`  • skipped ${f} (not in scope)\n`);
    files = kept;
  }
  if (files.length === 0) { err('==> No workflows in scope — nothing to import.\n'); return 0; }

  const gitIds = files.map((f) => path.basename(f, '.json'));
  const gitIdSet = new Set(gitIds);
  err(`==> Importing ${files.length} workflow(s) into n8n (in-process; n8n's ImportService) ...\n`);

  const ds = await bridge.dataSource();
  await bridge.ensureNodesLoaded(); // activation builds Workflow objects → needs node types
  const { projectId, userId } = await resolveProjectAndUser(cfg);
  err(`==> Target project: ${projectId} (owner user ${userId})\n`);

  // Change detection: only re-import workflows whose normalized form differs from the instance.
  err('==> Detecting changes vs the instance ...\n');
  const current = new Map<string, string>();
  for (const wf of await findAllWorkflows(ds)) current.set(wf.id as string, serializeEntity(wf));
  const changedFiles: string[] = [];
  for (const f of files) {
    const id = path.basename(f, '.json');
    const cur = current.get(id);
    if (cur === undefined || cur !== fs.readFileSync(f, 'utf8')) changedFiles.push(f);
  }
  err(`==> ${changedFiles.length} of ${files.length} changed (${files.length - changedFiles.length} unchanged, skipped).\n`);

  // RESTORE: workflows present in git but ARCHIVED in n8n must be un-archived (mirror of export,
  // which prunes archived). The upsert below resets isArchived=false; force them through even if
  // their content is unchanged so they get re-imported (and re-activated per the JSON).
  const archivedGit = (await ds.query(
    `SELECT id FROM workflow_entity WHERE "isArchived" = true AND id = ANY($1)`, [gitIds],
  ) as { id: string }[]).map((r) => r.id);
  if (archivedGit.length) {
    const set = new Set(archivedGit);
    for (const f of files) if (set.has(path.basename(f, '.json')) && !changedFiles.includes(f)) changedFiles.push(f);
    err(`==> ${archivedGit.length} workflow(s) in git are archived in n8n — restoring (un-archive)\n`);
  }

  const foldersFile = path.join(cfg.workflowsDir, 'folders.json');
  const folders: FolderManifest[] = fs.existsSync(foldersFile) ? readJson(foldersFile) : [];

  if (cfg.dryRun) {
    err(`==> [dry-run] would upsert ${folders.length} folder(s) into ${projectId} and import ${changedFiles.length} workflow(s):\n`);
    for (const f of changedFiles) err(`   ~ ${path.relative(process.cwd(), f)}\n`);
    return 0;
  }

  // Folders: id-preserving upsert into the project (two passes for the self-ref FK), atomic.
  if (folders.length) {
    err(`==> Upserting ${folders.length} folder(s) into project ${projectId} ...\n`);
    await ds.transaction(async (tx: any) => {
      for (const fo of folders) {
        await tx.query(
          `INSERT INTO folder (id,name,"projectId","createdAt","updatedAt") VALUES ($1,$2,$3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, "projectId"=EXCLUDED."projectId", "updatedAt"=CURRENT_TIMESTAMP`,
          [fo.id, fo.name, projectId],
        );
      }
      for (const fo of folders) {
        await tx.query(`UPDATE folder SET "parentFolderId"=$1, "updatedAt"=CURRENT_TIMESTAMP WHERE id=$2`, [fo.parentFolderId, fo.id]);
      }
    });
  }

  if (changedFiles.length === 0) {
    err('==> No changed workflows — skipping import + activation (no downtime).\n');
  } else {
    // Hand the changed set to n8n's own ImportService: id-preserving upsert(['id']) + owner +
    // tags + WorkflowHistory + CYCLE-SAFE in-process activation (activeState:'fromJson' respects
    // each workflow's `active`). No CLI, no REST. NB the queue-mode guard lives in the stock
    // import:workflow command, not the service, so calling it directly is fine here (we verified
    // EXECUTIONS_MODE=queue). Missing-credential workflows import but stay inactive (logged).
    const { WorkflowRepository } = bridge.repos();
    const repo = bridge.get<any>(WorkflowRepository);
    const entities = changedFiles.map((f) => {
      const plain = readJson(f);
      plain.parentFolderId = plain.parentFolderId ?? null;
      plain.isArchived = false; // restore archived; new/updated default to live
      const ent = repo.create(plain);
      ent.versionMetadata = plain.versionMetadata ?? null;
      return ent;
    });
    err(`==> Importing ${entities.length} changed workflow(s) via ImportService (activeState=fromJson) ...\n`);
    await bridge.importService().importWorkflows(entities, projectId, userId, { activeState: 'fromJson' });
    err('==> ImportService done (upsert + tags + owner + activation in-process).\n');
  }

  // Orphans: owned by the project, in scope, gone from git → ARCHIVE (deactivate + isArchived),
  // mirroring export's pruning. Deregister the live trigger first.
  const owned = await ds.query(
    `SELECT we.id, we.name FROM workflow_entity we
     JOIN shared_workflow sw ON sw."workflowId"=we.id AND sw.role='workflow:owner'
     WHERE sw."projectId"=$1`, [projectId],
  ) as { id: string; name: string }[];
  const awm = bridge.activeWorkflowManager();
  for (const o of owned) {
    if (!inScope(o.id) || gitIdSet.has(o.id)) continue;
    err(`  ⊟ '${o.name}' (id=${o.id}) removed from git — archiving (deactivate + isArchived)\n`);
    try { await awm.remove(o.id); } catch { /* not active / already gone */ }
    await ds.query(`UPDATE workflow_entity SET "isArchived"=true, active=false, "activeVersionId"=NULL WHERE id=$1`, [o.id]);
  }

  // Verify presence.
  const present = new Set((await ds.query(
    `SELECT id FROM workflow_entity WHERE id = ANY($1)`, [gitIds],
  ) as { id: string }[]).map((r) => r.id));
  let rc = 0;
  for (const id of gitIds) if (!present.has(id)) { err(`n8n-sync: id=${id} not found after import\n`); rc = 1; }
  if (rc === 0) err('==> Done. Activation applied in-process (queue mode) — no restart, no REST.\n');
  return rc;
}
