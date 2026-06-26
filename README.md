# n8n-sync (TypeScript engine)

> **Status: `2.0.0-alpha.1`** — published to GitHub Packages as `@andreapalladiokiv/n8n-sync`.
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
`@n8n/di` Container. One shared engine (`src/incontainer/`), reached two ways — **no registered n8n
commands, no mounting into n8n's `dist/commands`**:

- **The bundle, run as a node script** — `docker exec <c> node n8n-sync.mjs export|import|projects`
  (exactly as 1.x / the deploy did). `bridge.bootstrap()` brings up the minimum of n8n's runtime in
  this standalone process (reflect-metadata → GlobalConfig → `ModuleRegistry.loadModules()`), then
  the engine reuses n8n's DataSource + services. For batch sync.
- **External hook** — `dist/hook.cjs` (via `EXTERNAL_HOOK_FILES`) runs in the live server process and
  does **in-process export-on-save** (no bootstrap needed — the server already did it).

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

The single bundle (`dist/n8n-sync.mjs`) carries **no DB driver** — it is ~52 KB (1.x was ~1 MB with
typeorm+pg bundled). It is both the host tool and the in-container entrypoint.

## Commands

| Command | Where | What |
|---|---|---|
| `n8n-sync normalize [files…]` | host | canonicalize workflow JSON in place (sort keys, strip volatile + instance-specific fields incl. node credential-ref `name`). |
| `n8n-sync hook-path` | host | print the path to `dist/hook.cjs` for `EXTERNAL_HOOK_FILES`. |
| `node n8n-sync.mjs export` | in-container | n8n → repo: export in-scope workflows, normalize, mirror the folder tree, write `folders.json`; prune archived. |
| `node n8n-sync.mjs import` | in-container | repo → n8n: id-preserving import (`ImportService`), folders, credential stubs, cycle-safe in-process activation; archive orphans, restore (un-archive) workflows present in git. |
| `node n8n-sync.mjs projects` | in-container | list projects (`id\|name\|type`) to pick a project id. |

The in-container commands run as a standalone `node` process inside the n8n container (e.g. via
`docker exec`), NOT as registered `n8n` subcommands. Config is env-driven: `WORKFLOWS_DIR`,
`SCOPE_FILE`, `N8N_PROJECT_ID`, `N8N_SYNC_DRY_RUN=1`. DB connection comes from n8n's own env (we reuse
its DataSource). Run on the host, the in-container commands fail fast (no n8n install to resolve).

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
# docker-compose (n8n main service) — only the hook needs wiring; batch sync needs no mount.
environment:
  EXTERNAL_HOOK_FILES: /opt/n8n-sync/hook.cjs   # realtime export-on-save
  WORKFLOWS_DIR: /repo/workflows
  SCOPE_FILE: /repo/workflow-ids.json
volumes:
  - .:/repo                                                            # repo (workflows + scope)
  - ./node_modules/@andreapalladiokiv/n8n-sync/dist:/opt/n8n-sync:ro   # hook (dist/hook.cjs + hook-impl.cjs)
```

Batch sync (host/CI) `docker cp`s the bundle into the container and runs it as a node script —
**identical to 1.x**, no new mount:
`docker exec -e WORKFLOWS_DIR=… -e SCOPE_FILE=… -e N8N_PROJECT_ID=… <container> node /path/n8n-sync.mjs import`.

## Version coupling (read before upgrading n8n)

2.x depends on n8n **internals** that are not a public API: the `@n8n/di` Container, the
`DbConnection`/`WorkflowRepository`/`ImportService`/`ActiveWorkflowManager`/`ModuleRegistry` tokens,
the `importWorkflows(…, {activeState})` signature, and the bootstrap sequence (reflect-metadata +
`dist/config` + `loadModules`). Only the external-hook **event names** are stable. **Pin the n8n
version and smoke-test on every upgrade.** Notes: `activeState:'fromJson'` activation requires `EXECUTIONS_MODE=queue` (or multi-main);
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
