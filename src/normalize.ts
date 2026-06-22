// Canonical form for a workflow JSON.
//
// The on-disk form produced here MUST stay byte-identical to the legacy bash
// engine's `jq -S "$NORMALIZE_JQ"` output — that byte-stability is what makes
// import's change-detection work and keeps 3-way merges clean. The parity test
// (test/normalize.parity.test.mjs) pins this against jq-generated goldens on the
// real workflow corpus. Validated 10/10 incl. float rendering; the one known
// theoretical gap is pathological numbers (1e21, -0), which the test guards.

/** Volatile / instance-specific fields stripped before committing. */
const DELETE_FIELDS = [
  'updatedAt', 'createdAt', 'versionId', 'triggerCount', 'shared', 'homeProject',
  'scopes', 'meta', 'versionCounter', 'activeVersionId', 'versionMetadata',
  'activeVersion', 'isArchived', 'sourceWorkflowId', 'owner',
] as const;

type Workflow = Record<string, unknown>;

/** jq `if type == "object" then .name else . end` — object tag → its name. */
function tagName(t: unknown): unknown {
  return t !== null && typeof t === 'object' ? (t as Record<string, unknown>).name ?? null : t;
}

/** Apply the canonical transform (mirrors NORMALIZE_JQ). Does not sort keys. */
export function normalizeWorkflow(input: Workflow): Workflow {
  const w: Workflow = { ...input };
  for (const k of DELETE_FIELDS) delete w[k];
  w.parentFolderId = w.parentFolderId ?? null;
  w.staticData = null;
  w.pinData = w.pinData ?? {};
  // jq `unique` = sort + dedupe. Tags are reduced to their names first.
  const tags = (Array.isArray(w.tags) ? w.tags : []).map(tagName);
  w.tags = [...new Set(tags)].sort();
  w.settings = w.settings ?? {};
  return w;
}

/** jq `-S`: recursively sort object keys at every depth (codepoint order). */
export function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      out[k] = sortKeysDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** Canonical on-disk serialization: normalized, key-sorted, 2-space, trailing \n. */
export function serializeWorkflow(input: Workflow): string {
  return JSON.stringify(sortKeysDeep(normalizeWorkflow(input)), null, 2) + '\n';
}
