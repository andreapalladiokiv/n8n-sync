# n8n-sync (TypeScript engine)

> **Status: `2.0.0-alpha`** — published to GitHub Packages as `@andreapalladiokiv/n8n-sync`.
> **2.x is a clean break from 1.x**: instead of a self-contained bundle that opened its OWN
> `@n8n/typeorm` DataSource and shelled out to the `n8n` CLI + REST API, 2.x runs **inside the n8n
> process** and reuses n8n's OWN DataSource + services. No bundled DB driver, no `n8n` CLI
> shell-out, no REST activation. (1.x lives at tag `v1.6.0`.)

CI/CD sync for [n8n](https://n8n.io) workflows: version-control workflows in git and sync them with
a running n8n instance, **id-preserving**, with folder sync and credential-aware, cycle-safe
activation.

## Architecture: runs *inside* the n8n runtime

The DB-touching work is done by code that executes **in n8n's own Node process**, where the live,
already-migrated `DataSource` and every service/repository are registered in the process-wide
`@n8n/di` Container. Two injection vectors, one shared engine (`src/incontainer/`):

- **Drop-in CLI commands** — `dist/n8n-cmd/{export,import,projects}.js` are mounted into
  `<n8nRoot>/dist/commands/n8n-sync/`, so `n8n n8n-sync:export|import|projects` dispatch through
  n8n's own `CommandRegistry` (it dynamically `require()`s `./commands/<name>.js`). For batch sync.
- **External hook** — `dist/hook.cjs` (via `EXTERNAL_HOOK_FILES`) does **in-process export-on-save**.

Both resolve n8n's own modules through `src/incontainer/bridge.ts` (a `createRequire` anchored at the
n8n install root → the exact module instances n8n loaded → same singletons), and reuse:

| n8n primitive | used for |
|---|---|
| `Container.get(DbConnection).dataSource` | the live, open connection (raw SQL for folders/tags/orphans/change-detection) |
| `Container.get(WorkflowRepository).find()` | export reads (byte-parity with `export:workflow --all`) |
| `Container.get(ImportService).importWorkflows(…, {activeState:'fromJson'})` | id-preserving `upsert(['id'])` + tags + owner + **cycle-safe in-process activation** |
| `Container.get(ActiveWorkflowManager).remove()` | deregister triggers when archiving orphans |

> The DataSource is reached via the `@n8n/db` `DbConnection` token (single copy), **not** the
> `@n8n/typeorm` `DataSource` class token — there can be two `@n8n/typeorm` copies on disk and the
> class identity must match the one n8n registered.

The **host** bundle (`dist/n8n-sync.mjs`) now carries **no DB driver** — it does only pure JSON
`normalize` (+ `hook-path`). It is ~40 KB (1.x was ~1 MB with typeorm+pg bundled).

## Commands

| Command | Where | What |
|---|---|---|
| `n8n-sync normalize [files…]` | host | canonicalize workflow JSON in place (sort keys, strip volatile + instance-specific fields incl. node credential-ref `name`). |
| `n8n-sync hook-path` | host | print the path to `dist/hook.cjs` for `EXTERNAL_HOOK_FILES`. |
| `n8n n8n-sync:export` | in-container | n8n → repo: export in-scope workflows, normalize, mirror the folder tree, write `folders.json`; prune archived. |
| `n8n n8n-sync:import` | in-container | repo → n8n: id-preserving import (`ImportService`), folders, cycle-safe in-process activation; archive orphans, restore (un-archive) workflows present in git. |
| `n8n n8n-sync:projects` | in-container | list projects (`id\|name\|type`) to pick a project id. |

Config is env-driven (flag-free in-container): `WORKFLOWS_DIR`, `SCOPE_FILE`, `N8N_PROJECT_ID`,
`N8N_SYNC_DRY_RUN=1`. DB connection comes from n8n's own env (we reuse its DataSource).
`export`/`import`/`projects` on the **host** bundle just print a pointer to the in-container form.

## Realtime hook (export-on-save, local/dev)

`dist/hook.cjs` (`EXTERNAL_HOOK_FILES`) fires on `workflow.afterCreate/afterUpdate/afterDelete`. It
maintains `SCOPE_FILE` (add/rename/remove; absent = "all", never narrowed) and runs the **in-process**
export, **debounced** (`N8N_SYNC_HOOK_DEBOUNCE_MS`, default 1500) and **serialized**. Needs a writable
`WORKFLOWS_DIR`/`SCOPE_FILE`. `dist/hook.cjs` requires its sibling `dist/hook-impl.cjs` — mount the
whole `dist/` dir, not the single file.

## Deploying into n8n (consumer)

Install from GitHub Packages (`.npmrc` scope + `read:packages` token), then mount the artifacts into
the n8n container — **no image rebuild**:

```yaml
# docker-compose (n8n main service)
environment:
  EXTERNAL_HOOK_FILES: /opt/n8n-sync/hook.cjs   # realtime export-on-save
  WORKFLOWS_DIR: /repo/workflows
  SCOPE_FILE: /repo/workflow-ids.json
volumes:
  - .:/repo                                                                               # repo (workflows + scope)
  - ./node_modules/@andreapalladiokiv/n8n-sync/dist:/opt/n8n-sync:ro                      # hook (+hook-impl)
  - ./node_modules/@andreapalladiokiv/n8n-sync/dist/n8n-cmd:/usr/local/lib/node_modules/n8n/dist/commands/n8n-sync:ro  # drop-in CLI commands
```

Batch sync from the host then `docker exec`s the in-container commands, e.g.
`docker exec -e WORKFLOWS_DIR=… -e SCOPE_FILE=… <container> n8n n8n-sync:import`.

### Registering the commands without the `dist/commands` mount (preload)

If you'd rather not mount into n8n's `dist/commands`, set
`NODE_OPTIONS=--require /opt/n8n-sync/preload.cjs` on the n8n service instead (sibling to
`EXTERNAL_HOOK_FILES`). `dist/preload.cjs` registers the same `n8n-sync:{export,import,projects}`
commands into n8n's `CommandMetadata` at process start — they appear in `n8n --help` and dispatch
identically, with no `dist/commands` mount. (This is what the `n8n-va-workflows` consumer uses; an
external hook itself cannot register commands — it loads after n8n's command lookup.)

## Version coupling (read before upgrading n8n)

2.x depends on n8n **internals** that are not a public API: the `@n8n/di` Container, the
`DbConnection`/`WorkflowRepository`/`ImportService`/`ActiveWorkflowManager` tokens, the
`importWorkflows(…, {activeState})` signature, and the `CommandRegistry`'s dynamic-require dispatch.
Only the external-hook **event names** are stable. **Pin the n8n version and smoke-test on every
upgrade.** Notes: `activeState:'fromJson'` activation requires `EXECUTIONS_MODE=queue` (or multi-main);
`ImportService` swallows activation errors (a workflow with missing credentials imports but stays
inactive — fill creds, re-import).

## Develop

```sh
npm install          # builds dist/ (prepare hook)
npm test             # typecheck + build + unit tests + normalize byte-parity
npm run test:unit    # fast unit tests only
```

Requirements: Node ≥ 18. Inside the n8n container nothing extra is needed — the engine resolves
n8n's own modules at runtime.
