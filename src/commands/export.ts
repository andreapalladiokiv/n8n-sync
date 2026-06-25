import fs from 'node:fs';
import path from 'node:path';
import { Db } from '../db';
import { exportAllWorkflows } from '../n8n';
import { serializeWorkflow } from '../normalize';
import { scopeIds } from '../config';
import type { Config } from '../config';
import { buildFolderPath } from '../folders';
import { walkWorkflowJson, removeEmptyDirs } from '../fsutil';

interface FolderRow { id: string; name: string; parentFolderId: string | null }

export async function cmdExport(cfg: Config): Promise<void> {
  const scope = new Set(scopeIds(cfg.scopeFile));
  const inScope = (id: string): boolean => scope.size === 0 || scope.has(id);

  process.stderr.write('==> Exporting workflows from the local n8n ...\n');
  const dump = exportAllWorkflows();
  const dumpFiles = fs.readdirSync(dump).filter((f) => f.endsWith('.json'));

  const db = await Db.open();
  try {
    // Data-loss guard (finding #1): an empty dump with a non-empty instance means
    // the CLI export failed — refuse to wipe the repo tree.
    const total = Number(await db.scalar<string>('SELECT count(*) FROM workflow_entity')) || 0;
    if (dumpFiles.length === 0 && total > 0) {
      throw new Error(`export produced no files but the instance has ${total} workflow(s) — aborting (repo left untouched)`);
    }

    // Folder tree + workflow→folder membership, in the DB's own id order so
    // folders.json ordering matches the bash engine regardless of pg collation.
    const folders = await db.rows<FolderRow>('SELECT id, name, "parentFolderId" FROM folder ORDER BY id');
    const names = new Map(folders.map((f) => [f.id, f.name]));
    const parents = new Map(folders.map((f) => [f.id, f.parentFolderId]));
    const wfParent = new Map(
      (await db.rows<{ id: string; parentFolderId: string | null }>('SELECT id, "parentFolderId" FROM workflow_entity'))
        .map((w) => [w.id, w.parentFolderId]),
    );
    // Archived workflows are retired in n8n — prune them from the repo. `export:workflow
    // --all` still dumps them, so skip them here; the tree is rebuilt from scratch below,
    // so skipping deletes their files. Guarded: an older n8n without the `isArchived`
    // column simply has nothing archived. (`WHERE "isArchived"` is portable pg + sqlite.)
    let archived = new Set<string>();
    try {
      archived = new Set(
        (await db.rows<{ id: string }>('SELECT id FROM workflow_entity WHERE "isArchived"')).map((r) => r.id),
      );
    } catch { /* no isArchived column (older n8n) → none archived */ }

    // Rebuild from scratch so folder MOVES are reflected; out-of-scope + archived files pruned.
    fs.mkdirSync(cfg.workflowsDir, { recursive: true });
    for (const f of walkWorkflowJson(cfg.workflowsDir)) fs.rmSync(f);

    const used = new Set<string>();
    let kept = 0;
    let pruned = 0;
    for (const base of dumpFiles) {
      const id = base.replace(/\.json$/, '');
      if (!inScope(id)) continue;
      if (archived.has(id)) { pruned++; continue; } // archived → leave it out (file deleted)
      const pfid = wfParent.get(id) ?? null;
      if (pfid) for (let c: string | null = pfid; c && parents.has(c); c = parents.get(c) ?? null) used.add(c);
      const rel = pfid ? buildFolderPath(pfid, names, parents) : '';
      const destDir = rel ? path.join(cfg.workflowsDir, rel) : cfg.workflowsDir;
      fs.mkdirSync(destDir, { recursive: true });
      const wf = JSON.parse(fs.readFileSync(path.join(dump, base), 'utf8')) as Record<string, unknown>;
      wf.parentFolderId = pfid; // export omits it; inject the authoritative DB value
      fs.writeFileSync(path.join(destDir, base), serializeWorkflow(wf));
      kept++;
    }

    // folders.json = folders used by in-scope workflows (+ ancestors), DB id-order.
    const manifest = folders
      .filter((f) => used.has(f.id))
      .map((f) => ({ id: f.id, name: f.name, parentFolderId: f.parentFolderId }));
    fs.writeFileSync(path.join(cfg.workflowsDir, 'folders.json'), JSON.stringify(manifest, null, 2) + '\n');

    removeEmptyDirs(cfg.workflowsDir);
    if (pruned) process.stderr.write(`==> pruned ${pruned} archived workflow(s) from ./${cfg.workflowsDir}/\n`);
    process.stderr.write(`==> ${kept} workflow(s) + ${manifest.length} folder(s) in ./${cfg.workflowsDir}/ — review 'git diff', then commit.\n`);
  } finally {
    await db.close();
    fs.rmSync(dump, { recursive: true, force: true });
  }
}
