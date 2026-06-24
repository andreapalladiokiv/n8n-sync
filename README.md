# n8n-sync (TypeScript engine)

> **Status: `1.0.0`** — the TypeScript engine, published to GitHub Packages as
> `@andreapalladiokiv/n8n-sync`. Core commands (`normalize`, `export`, `import`,
> `projects`) are byte-parity-verified against the legacy bash engine on a live n8n
> instance; `deploy.yml` is verified green end-to-end on a real VM. The bash engine
> (`./n8n-sync`) is kept in the repo as a reference oracle.

CI/CD sync for [n8n](https://n8n.io) workflows: version-control workflows in git and
sync them with a running n8n instance, **id-preserving** (via the n8n CLI), with folder
sync and credential-aware, cycle-safe activation.

## Architecture: runs *inside* the n8n container

Unlike the bash engine (which ran on the host and shelled in over `docker exec`), this
engine is **baked into the n8n image and runs in-container**, where everything it needs
already lives:

- **Database** — a native `pg.Client` over n8n's own `DB_POSTGRESDB_*` env (parameterized
  queries; the whole DB mutation runs in one transaction).
- **Workflows** — the `n8n` CLI (`export/import:workflow`) via `child_process`, so entity
  ids stay stable (the REST API cannot create-with-id).
- **Activation** — the n8n REST API on `localhost` (`fetch`), so triggers register live.

`pg` is **not bundled** — it is resolved at runtime from n8n's `node_modules`. Everything
else (incl. the CLI lib) bundles into a single `dist/n8n-sync.mjs`.

The host side (a Makefile / CI) is thin: put the repo workflows where the container can
read them, then `docker exec <container> n8n-sync <command>`. `normalize` is pure and also
runs host-side (e.g. a pre-commit hook).

## Commands

| Command | Where it runs | What it does |
|---|---|---|
| `normalize [files…]` | host or container | Canonicalize workflow JSON in place (byte-identical to the legacy `jq -S` form). |
| `export` | in-container | n8n → repo: export in-scope workflows, normalize, mirror the folder tree, write `folders.json`. |
| `import` | in-container | repo → n8n: id-preserving import, folder upsert, credential stubs, credential-aware + cycle-safe activation, orphan deactivation. |
| `projects` | in-container | List projects (`id\|name\|type`) to pick a project id. |

`pull` is host orchestration (git + `docker exec` of export/import) and lives in the
consuming repo's `Makefile` (`make pull`), not in this engine. `init` is dropped — the
project template scaffolds the repo.

## Configuration (env, overridable by flags)

Precedence: **flag > env > default**.

| Env | Flag | Default | |
|---|---|---|---|
| `N8N_PROJECT_ID` | `--project-id` | oldest personal | project that owns imported workflows + folders |
| `N8N_API_KEY` | — | — | present → live activation; empty → CLI publish (needs restart) |
| `WORKFLOWS_DIR` | `--workflows-dir` | `workflows` | repo dir for workflow JSON |
| `SCOPE_FILE` | `--scope-file` | `workflow-ids.json` | `{"workflows":[{id,name}]}`; empty = all |
| `DB_POSTGRESDB_*` | — | (n8n's) | DB connection, read from n8n's own env (honors `_PASSWORD_FILE`, `_SSL_*`, `_SCHEMA`) |

`--dry-run` plans without mutating.

## Install (GitHub Packages)

Published to GitHub Packages as `@andreapalladiokiv/n8n-sync`. Consumers point the
scope at the GitHub registry in an `.npmrc` and authenticate with a `read:packages`
token (in CI, a PAT secret or — for same-owner repos — `GITHUB_TOKEN`):

```ini
# .npmrc
@andreapalladiokiv:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```sh
npm install @andreapalladiokiv/n8n-sync          # or pin @1.0.0
```

The single bin `n8n-sync` (→ `dist/n8n-sync.mjs`) is then on `PATH`/`npx`. To run the
in-container commands, copy the bundle into the n8n container and exec it there:
`docker exec <container> node /path/n8n-sync.mjs import` (or `n8n-sync import` once
baked into the image). `normalize` is pure and runs host-side directly.

Releases publish automatically: pushing a `v*` tag triggers `.github/workflows/release.yml`.

## Develop

```sh
npm install          # builds dist/ (prepare hook)
npm test             # typecheck + build + unit tests + bundle byte-parity
npm run test:unit    # fast unit tests only
N8N_SYNC_IT_CONTAINER=n8n npm run test:it   # in-container integration smoke
```

Requirements: Node ≥ 18. Inside the n8n container, `pg` and the `n8n` CLI must be present
(they always are).
