// Canonical form for a workflow JSON.
//
// The on-disk form produced here MUST stay byte-identical to the legacy bash
// engine's `jq -S "$NORMALIZE_JQ"` output — that byte-stability is what makes
// import's change-detection work and keeps 3-way merges clean. The parity test
// (test/normalize.parity.test.mjs) pins this against jq-generated goldens on the
// real workflow corpus. Validated 10/10 incl. float rendering; the one known
// theoretical gap is pathological numbers (1e21, -0), which the test guards.
//
// Two intentional post-bash divergences (both instance-specific noise the jq form
// left in): node credential-reference `name` (stripped per-node) and
// `settings.availableInMCP` (an instance-side MCP-exposure toggle). Neither appears in
// the parity fixtures, so the goldens are unchanged.

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
  // `settings.availableInMCP` is an instance-side toggle (whether the workflow is exposed
  // via the MCP Server Trigger). It's UI/runtime state, not part of the portable workflow
  // definition, and flips between instances (false↔true), so it perpetually diffs — strip
  // it while preserving every other real setting. NB: key is uppercase `MCP`.
  const settings = { ...((w.settings as Record<string, unknown>) ?? {}) };
  delete settings.availableInMCP;
  w.settings = settings;
  // A node credential reference is `{ id, name }`, but `name` is the credential's
  // DISPLAY label on whatever instance the workflow was exported from — the same id is
  // named differently on each instance, so it perpetually diffs (and isn't portable).
  // The id is the authoritative link; drop `name` (n8n re-resolves it from the id).
  if (Array.isArray(w.nodes)) {
    w.nodes = (w.nodes as Record<string, unknown>[]).map((node) => {
      const creds = node && typeof node === 'object' ? (node.credentials as Record<string, unknown> | undefined) : undefined;
      if (!creds || typeof creds !== 'object') return node;
      const out: Record<string, unknown> = {};
      for (const t of Object.keys(creds)) {
        const ref = creds[t];
        if (ref && typeof ref === 'object' && 'id' in (ref as object)) {
          const cleaned = { ...(ref as Record<string, unknown>) };
          delete cleaned.name;
          out[t] = cleaned;
        } else {
          out[t] = ref;
        }
      }
      return { ...node, credentials: out };
    });
  }
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
