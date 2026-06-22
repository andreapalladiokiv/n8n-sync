// (De)activate THROUGH the running n8n REST API so triggers register LIVE (no
// restart). Runs inside the container; key from N8N_API_KEY. Port of NODE_ACTIVATE.
const BASE = 'http://localhost:5678/api/v1';

export interface ActResult {
  active: boolean;
  /** workflow has no production trigger — legitimately left inactive (not an error). */
  noTrigger: boolean;
  error?: string;
}

export async function setActive(id: string, want: boolean, apiKey: string): Promise<ActResult> {
  const h = { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' };
  const get = (): Promise<Record<string, unknown>> =>
    fetch(`${BASE}/workflows/${id}`, { headers: h }).then((r) => r.json() as Promise<Record<string, unknown>>);
  const post = (action: string, body?: unknown): Promise<Response> =>
    fetch(`${BASE}/workflows/${id}/${action}`, { method: 'POST', headers: h, body: JSON.stringify(body ?? {}) });

  if (want) {
    const wf = await get();
    const av = wf.activeVersion as { versionId?: string } | undefined;
    const versionId = av?.versionId ?? (wf.activeVersionId as string | undefined) ?? (wf.versionId as string | undefined) ?? null;
    const name = `n8n-sync-${id}`;
    let r = await post('activate', versionId ? { name, versionId } : { name });
    if (!r.ok && r.status === 400 && versionId) r = await post('activate', { name });
    if (!r.ok) {
      const t = await r.text();
      if (/trigger|webhook|polling|no node to start/i.test(t)) return { active: false, noTrigger: true };
      return { active: false, noTrigger: false, error: `activate ${r.status} ${t.slice(0, 200)}` };
    }
  } else {
    await post('deactivate', {});
  }
  const w = await get();
  const active = w.active === true;
  if (active !== want) return { active, noTrigger: false, error: `active=${active} want=${want}` };
  return { active, noTrigger: false };
}
