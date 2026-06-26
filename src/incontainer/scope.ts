import fs from 'node:fs';

// SCOPE_FILE (workflow-ids.json) upkeep — pure fs, no n8n. Kept in the repo's canonical shape and
// written IN PLACE (preserves a single-file bind mount). Skipped when the file is absent (absent =
// "all" scope — must never be narrowed). The scope path is read per-call (honors a changed env).

export interface ScopeEntry { id: string; name: string }

function maintainScope(mutate: (list: ScopeEntry[]) => boolean): void {
  const scopeFile = process.env.SCOPE_FILE || 'workflow-ids.json';
  if (!fs.existsSync(scopeFile)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
    const list: ScopeEntry[] = Array.isArray(parsed.workflows) ? parsed.workflows : [];
    if (!mutate(list)) return; // unchanged → no write (keeps afterUpdate-on-every-save quiet)
    const body = list
      .map((w) => `      { "id": ${JSON.stringify(String(w.id))}, "name": ${JSON.stringify(w.name == null ? '' : w.name)} }`)
      .join(',\n');
    fs.writeFileSync(scopeFile, `{\n  "workflows": [\n${body}\n  ]\n}\n`);
  } catch (e) {
    console.error(`[n8n-sync] scope update failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
  }
}

/** create: add if missing (a brand-new workflow joins the tracked set). */
export const addScope = (id: string, name?: string): void => maintainScope((list) => {
  if (list.some((w) => String(w.id) === id)) return false;
  list.push({ id, name: name ?? '' }); return true;
});
/** update: rename IN PLACE only if already tracked (afterUpdate fires on every save). */
export const renameScope = (id: string, name?: string): void => maintainScope((list) => {
  const e = list.find((w) => String(w.id) === id);
  if (!e) return false;
  if (name != null && e.name !== name) { e.name = name; return true; }
  return false;
});
/** delete (or archive — a soft-delete): drop by id. */
export const removeScope = (id: string): void => maintainScope((list) => {
  const i = list.findIndex((w) => String(w.id) === id);
  if (i < 0) return false; list.splice(i, 1); return true;
});
