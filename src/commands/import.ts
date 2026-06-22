import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Db } from '../db';
import { exportAllWorkflows, importWorkflows, existingCredentialIds, importCredentials, unpublishViaCli } from '../n8n';
import { serializeWorkflow } from '../normalize';
import { setActive, type ActResult } from '../activate';
import { scopeIds } from '../config';
import type { Config } from '../config';

interface WfNode { disabled?: boolean; credentials?: Record<string, { id?: string; name?: string }> }
interface Workflow {
  name?: string; active?: boolean; parentFolderId?: string | null;
  tags?: unknown[]; nodes?: WfNode[]; [k: string]: unknown;
}
interface Cred { id: string; name: string; type: string }
interface FolderManifest { id: string; name: string; parentFolderId: string | null }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function genId(n = 16): string {
  const b = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ID_ALPHABET[b[i]! % ID_ALPHABET.length];
  return s;
}

function walkJson(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJson(p));
    else if (e.isFile() && e.name.endsWith('.json') && e.name !== 'folders.json') out.push(p);
  }
  return out;
}

const readWorkflow = (file: string): Workflow => JSON.parse(fs.readFileSync(file, 'utf8')) as Workflow;

/** Credentials referenced by a workflow's nodes; unique by id. */
function credsOf(wf: Workflow, enabledOnly: boolean): Cred[] {
  const seen = new Set<string>();
  const out: Cred[] = [];
  for (const n of wf.nodes ?? []) {
    if (enabledOnly && n.disabled === true) continue;
    for (const [type, v] of Object.entries(n.credentials ?? {})) {
      if (v && v.id != null && !seen.has(v.id)) { seen.add(v.id); out.push({ id: v.id, name: v.name ?? '', type }); }
    }
  }
  return out;
}

const tagName = (t: unknown): string | undefined => (typeof t === 'string' ? t : (t as { name?: string })?.name);

/** Find-or-create a tag_entity by NAME (n8n keeps tag names unique). */
async function resolveTag(db: Db, name: string): Promise<string> {
  const found = await db.scalar<string>('SELECT id FROM tag_entity WHERE name=$1 ORDER BY "createdAt", id LIMIT 1', [name]);
  if (found) return found;
  const id = genId();
  await db.exec('INSERT INTO tag_entity (id,name,"createdAt","updatedAt") VALUES ($1,$2,now(),now())', [id, name]);
  return id;
}

export async function cmdImport(cfg: Config): Promise<number> {
  const scope = new Set(scopeIds(cfg.scopeFile));
  const inScope = (id: string): boolean => scope.size === 0 || scope.has(id);
  let files = walkJson(cfg.workflowsDir).sort();
  if (scope.size) {
    const kept = files.filter((f) => inScope(path.basename(f, '.json')));
    for (const f of files) if (!kept.includes(f)) process.stderr.write(`  • skipped ${f} (not in scope)\n`);
    files = kept;
  }
  if (files.length === 0) { process.stderr.write('==> No workflows in scope — nothing to import.\n'); return 0; }
  process.stderr.write(`==> Importing ${files.length} workflow(s) into the local n8n ...\n`);

  const db = await Db.open();
  try {
    // Resolve target project: explicit id (verified) or the oldest personal project.
    let proj = cfg.projectId;
    if (proj) {
      const cnt = Number(await db.scalar<string>('SELECT count(*) FROM project WHERE id=$1', [proj]));
      if (cnt !== 1) throw new Error(`project '${proj}' not found on the target`);
    } else {
      proj = await db.scalar<string>(`SELECT id FROM project WHERE type='personal' ORDER BY "createdAt" LIMIT 1`);
      if (!proj) throw new Error('no project on the target — set --project-id / N8N_PROJECT_ID');
    }
    process.stderr.write(`==> Target project: ${proj}\n`);

    // Change detection: only re-import workflows whose normalized form differs.
    process.stderr.write('==> Detecting changes vs the instance ...\n');
    const cur = exportAllWorkflows();
    const curPF = new Map(
      (await db.rows<{ id: string; parentFolderId: string | null }>('SELECT id, "parentFolderId" FROM workflow_entity'))
        .map((w) => [w.id, w.parentFolderId]),
    );
    const changed: string[] = [];
    for (const f of files) {
      const id = path.basename(f, '.json');
      const cf = path.join(cur, `${id}.json`);
      if (!fs.existsSync(cf)) { changed.push(f); continue; }
      const w = JSON.parse(fs.readFileSync(cf, 'utf8')) as Workflow;
      w.parentFolderId = curPF.get(id) ?? null;
      if (serializeWorkflow(w) !== fs.readFileSync(f, 'utf8')) changed.push(f);
    }
    fs.rmSync(cur, { recursive: true, force: true });
    process.stderr.write(`==> ${changed.length} of ${files.length} changed (${files.length - changed.length} unchanged, skipped).\n`);

    const foldersFile = path.join(cfg.workflowsDir, 'folders.json');
    const folders: FolderManifest[] = fs.existsSync(foldersFile)
      ? (JSON.parse(fs.readFileSync(foldersFile, 'utf8')) as FolderManifest[]) : [];

    if (cfg.dryRun) {
      process.stderr.write(`==> [dry-run] would upsert ${folders.length} folder(s) into ${proj} and import ${changed.length} workflow(s):\n`);
      for (const f of changed) process.stderr.write(`   ~ ${path.relative(process.cwd(), f)}\n`);
      return 0;
    }

    // Folders: id-preserving upsert into $proj (atomic, two passes for the self-ref FK).
    if (folders.length) {
      process.stderr.write(`==> Upserting ${folders.length} folder(s) into project ${proj} (by id) ...\n`);
      await db.tx(async (t) => {
        for (const fo of folders) {
          await t.exec(
            `INSERT INTO folder (id,name,"projectId","createdAt","updatedAt") VALUES ($1,$2,$3,now(),now())
             ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, "projectId"=EXCLUDED."projectId", "updatedAt"=now()`,
            [fo.id, fo.name, proj],
          );
        }
        for (const fo of folders) {
          await t.exec(`UPDATE folder SET "parentFolderId"=$1, "updatedAt"=now() WHERE id=$2`, [fo.parentFolderId, fo.id]);
        }
      });
    }

    const have = new Set(existingCredentialIds());
    let pending = '';

    if (changed.length === 0) {
      process.stderr.write('==> No changed workflows — skipping import + activation (no downtime).\n');
    } else {
      // 1. credential stubs: seed referenced-but-missing creds empty (never overwrites filled ones).
      const needed: Cred[] = [];
      { const seen = new Set<string>(); for (const f of changed) for (const c of credsOf(readWorkflow(f), false)) if (!seen.has(c.id)) { seen.add(c.id); needed.push(c); } }
      const stubs = needed.filter((c) => !have.has(c.id)).map((c) => ({ id: c.id, name: c.name, type: c.type, data: {} }));
      if (stubs.length) {
        process.stderr.write('==> Seeding credential stubs (fill secrets in the UI — EDIT the stub):\n');
        for (const s of stubs) process.stderr.write(`  + ${s.name}  [${s.type}]  id=${s.id}\n`);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-stubs-'));
        const file = path.join(dir, 'stubs.json');
        fs.writeFileSync(file, JSON.stringify(stubs));
        importCredentials(file);
        fs.rmSync(dir, { recursive: true, force: true });
      }

      // 2. id-preserving CLI import of the changed set (tags stripped — linked by name in step 3).
      process.stderr.write(`==> Importing ${changed.length} changed workflow(s) via the n8n CLI ...\n`);
      const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-import-'));
      for (const f of changed) { const w = readWorkflow(f); w.tags = []; fs.writeFileSync(path.join(stage, path.basename(f)), JSON.stringify(w)); }
      importWorkflows(stage);
      fs.rmSync(stage, { recursive: true, force: true });

      // 3. ownership + folder membership + tags — atomic, parameterized.
      await db.tx(async (t) => {
        for (const f of changed) {
          const id = path.basename(f, '.json');
          const wf = readWorkflow(f);
          await t.exec(`DELETE FROM shared_workflow WHERE "workflowId"=$1 AND role='workflow:owner'`, [id]);
          await t.exec(
            `INSERT INTO shared_workflow ("workflowId","projectId",role,"createdAt","updatedAt") VALUES ($1,$2,'workflow:owner',now(),now())
             ON CONFLICT ("workflowId","projectId") DO UPDATE SET role='workflow:owner', "updatedAt"=now()`,
            [id, proj],
          );
          await t.exec(`UPDATE workflow_entity SET "parentFolderId"=$1 WHERE id=$2`, [wf.parentFolderId ?? null, id]);
          await t.exec(`DELETE FROM workflows_tags WHERE "workflowId"=$1`, [id]);
          for (const tag of wf.tags ?? []) {
            const name = tagName(tag);
            if (!name) continue;
            const tagId = await resolveTag(t, name);
            await t.exec(`INSERT INTO workflows_tags ("workflowId","tagId") VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, tagId]);
          }
        }
      });

      // 4. activation — credential-aware + cycle-safe (changed set only).
      const readyIds: string[] = [];
      process.stderr.write('==> Resolving credential-readiness ...\n');
      for (const f of changed) {
        const id = path.basename(f, '.json');
        const wf = readWorkflow(f);
        const name = wf.name ?? id;
        if (wf.active !== true) {
          if (cfg.apiKey) await setActive(id, false, cfg.apiKey).catch(() => undefined); else unpublishViaCli(id);
          process.stderr.write(`  ○ inactive   '${name}' (id=${id})\n`);
          continue;
        }
        const missing = credsOf(wf, true).filter((c) => !have.has(c.id));
        if (missing.length) {
          process.stderr.write(`  ⏳ '${name}' (id=${id}) — pending credentials:\n`);
          for (const m of missing) process.stderr.write(`        · ${m.name} [${m.type}] id=${m.id}\n`);
          pending += `  • ${name} (id=${id}):\n${missing.map((m) => `        · ${m.name} [${m.type}] id=${m.id}`).join('\n')}\n`;
          continue;
        }
        process.stderr.write(`  ✓ ready      '${name}' (id=${id})\n`);
        readyIds.push(id);
      }

      if (readyIds.length) {
        // Pre-publish in the DB so a mutual sub-workflow cycle resolves at publish-time,
        // THEN register the live trigger via the API. psql/DB alone won't register it.
        process.stderr.write(`==> Pre-publishing ${readyIds.length} workflow(s) in the DB (activeVersionId := versionId) ...\n`);
        await db.exec(`UPDATE workflow_entity SET active=true, "activeVersionId"="versionId" WHERE id = ANY($1::text[])`, [readyIds]);
        if (cfg.apiKey) {
          process.stderr.write(`==> Activating ${readyIds.length} workflow(s) via the API (live — no restart) ...\n`);
          let remaining = [...readyIds];
          const lastErr = new Map<string, string>();
          for (let pass = 1; pass <= 3 && remaining.length; pass++) {
            const failed: string[] = [];
            for (const id of remaining) {
              const r: ActResult = await setActive(id, true, cfg.apiKey).catch((e) => ({ active: false, noTrigger: false, error: String(e) }));
              if (r.active || r.noTrigger) process.stderr.write(`  ▶ activated   (id=${id})\n`);
              else { failed.push(id); lastErr.set(id, r.error ?? 'unknown'); }
            }
            remaining = failed;
            if (remaining.length && pass < 3) { process.stderr.write(`  ↻ ${remaining.length} not active yet — retry pass ${pass + 1} after backoff ...\n`); await sleep(5000); }
          }
          for (const id of remaining) {
            process.stderr.write(`  ⚠ could not activate id=${id} after 3 passes (non-fatal): ${(lastErr.get(id) ?? '').replace(/\n/g, ' ').slice(0, 180)}\n`);
          }
        } else {
          process.stderr.write('  ⚠ no N8N_API_KEY — workflow(s) pre-published in the DB; restart n8n to register triggers.\n');
        }
      }
    }

    // Orphans: owned by $proj, in scope, gone from git → deactivate.
    const gitIds = files.map((f) => path.basename(f, '.json'));
    const gitIdSet = new Set(gitIds);
    const owned = await db.rows<{ id: string; name: string }>(
      `SELECT we.id, we.name FROM workflow_entity we
       JOIN shared_workflow sw ON sw."workflowId"=we.id AND sw.role='workflow:owner'
       WHERE sw."projectId"=$1`, [proj],
    );
    for (const o of owned) {
      if (!inScope(o.id) || gitIdSet.has(o.id)) continue;
      process.stderr.write(`  ⊟ '${o.name}' (id=${o.id}) not in git — deactivating; archive/delete it in the UI\n`);
      if (cfg.apiKey) await setActive(o.id, false, cfg.apiKey).catch(() => undefined); else unpublishViaCli(o.id);
    }

    // Verify presence in the DB.
    const present = new Set(
      (await db.rows<{ id: string }>(`SELECT id FROM workflow_entity WHERE id = ANY($1::text[])`, [gitIds])).map((r) => r.id),
    );
    let rc = 0;
    for (const id of gitIds) if (!present.has(id)) { process.stderr.write(`n8n-sync: id=${id} not found after import\n`); rc = 1; }
    if (rc === 0) {
      process.stderr.write(cfg.apiKey
        ? '==> Done. Activation applied live via the API — no restart needed.\n'
        : '==> Done. (no API key: restart n8n to register triggers; folders/metadata are already live)\n');
      if (pending) process.stderr.write(`\n==> Some workflows are INACTIVE pending credentials. Fill the secrets in the n8n UI, then re-run import:\n${pending}`);
    }
    return rc;
  } finally {
    await db.close();
  }
}
