// Pure helpers over the workflow JSON shape (no I/O) — unit-tested.

export interface WfNode {
  disabled?: boolean;
  credentials?: Record<string, { id?: string; name?: string }>;
}

export interface Workflow {
  name?: string;
  active?: boolean;
  parentFolderId?: string | null;
  tags?: unknown[];
  nodes?: WfNode[];
  [k: string]: unknown;
}

export interface Cred { id: string; name: string; type: string }

/** jq `if type=="object" then .name else . end` — an object tag → its name. */
export function tagName(t: unknown): string | undefined {
  return typeof t === 'string' ? t : (t as { name?: string } | null)?.name;
}

/** Credentials referenced by a workflow's nodes, unique by id (first wins).
 *  enabledOnly=true skips disabled nodes (used for activation readiness). */
export function credsOf(wf: Workflow, enabledOnly: boolean): Cred[] {
  const seen = new Set<string>();
  const out: Cred[] = [];

  for (const n of (wf.nodes ?? []).filter(n => !enabledOnly || !n.disabled)) {
    for (const [type, v] of Object.entries(n.credentials ?? {})) {
      if (v && v.id != null && !seen.has(v.id)) {
        seen.add(v.id);
        out.push({ id: v.id, name: v.name ?? '', type });
      }
    }
  }
  return out;
}
