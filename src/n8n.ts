import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Wrappers around the n8n CLI, which is on PATH inside the n8n container. These
// preserve entity ids (the REST API cannot create-with-id) — same reason the bash
// engine shelled out to `n8n export/import:workflow`.

function n8n(args: string[]): string {
  try {
    return execFileSync('n8n', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const detail = String(err.stderr ?? err.message ?? e).trim().slice(0, 400);
    throw new Error(`n8n ${args[0] ?? ''} failed: ${detail}`);
  }
}

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** `export:workflow --all --separate` → a fresh temp dir of <id>.json files. */
export function exportAllWorkflows(): string {
  const dir = mkTmp('ns-export-');
  n8n(['export:workflow', '--all', '--separate', '--pretty', `--output=${dir}`]);
  return dir;
}

/** Import a directory of <id>.json workflow files (id-preserving). */
export function importWorkflows(dir: string): void {
  n8n(['import:workflow', '--separate', `--input=${dir}`]);
}

/** All credential ids currently on the instance (for stub diffing). */
export function existingCredentialIds(): string[] {
  const dir = mkTmp('ns-creds-');
  const out = path.join(dir, 'creds.json');
  try {
    n8n(['export:credentials', '--all', `--output=${out}`]);
    if (!fs.existsSync(out)) return [];
    const arr = JSON.parse(fs.readFileSync(out, 'utf8')) as { id?: string }[];
    return arr.map((c) => c.id).filter((id): id is string => typeof id === 'string');
  } catch {
    return []; // no credentials / export unsupported → treat as none present
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Import credential stubs (empty-data placeholders) from a JSON file. */
export function importCredentials(file: string): void {
  n8n(['import:credentials', `--input=${file}`]);
}

/** CLI-level unpublish (used when no API key is available). */
export function unpublishViaCli(id: string): void {
  try { n8n(['unpublish:workflow', `--id=${id}`]); } catch { /* best-effort */ }
}
