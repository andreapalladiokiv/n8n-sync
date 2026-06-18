# n8n-sync

Portable, single-file CI/CD sync for [n8n](https://n8n.io) workflows. Syncs
workflows between a git repo and a running n8n instance over `docker exec` — the
**same command works local or remote**; only `DOCKER_HOST` differs (`--remote`).

It does what the public REST API can't: **id-preserving** workflow import (via the
n8n CLI), **folder** sync (via SQL — folders have no API), credential **stub**
seeding, and **cycle-safe, credential-aware activation**. Run `n8n-sync help`.

The raw SQL it needs runs **inside the n8n container** via `node` + the `pg` module
bundled in the n8n image, using n8n's own `DB_POSTGRESDB_*` env. That's the one
approach that works everywhere — a local pg container, a managed/external Postgres,
queue mode — with no `psql` and no separate pg container.

## Install

**As a git submodule (pinned — recommended):**

```sh
git submodule add https://github.com/andreapalladiokiv/n8n-sync vendor/n8n-sync
git -C vendor/n8n-sync checkout v1.1.0        # pin a version
git add .gitmodules vendor/n8n-sync
vendor/n8n-sync/n8n-sync init                 # scaffold the project
```

CI must check out submodules (`actions/checkout@v4` with `submodules: true`), and
fresh clones run `git submodule update --init`.

**Or vendor the single file (no submodule):**

```sh
mkdir -p bin
curl -fsSL https://raw.githubusercontent.com/andreapalladiokiv/n8n-sync/v1.1.0/n8n-sync \
  -o bin/n8n-sync && chmod +x bin/n8n-sync
bin/n8n-sync init
```

## Use

```sh
n8n-sync init                 # workflows/, workflow-ids.json, .n8n-sync.env, .gitignore
# edit .n8n-sync.env -> set N8N_API_KEY (+ container names if they differ)
n8n-sync export               # n8n  -> repo   (commit ./workflows/)
n8n-sync import               # repo -> n8n
n8n-sync import --remote      # ...into N8N_REMOTE_DOCKER_HOST (over SSH)
```

Run `n8n-sync help` for all commands, config vars, and the activation model.

## Config

Env wins; else sourced from `$N8N_SYNC_CONFIG`, `./.n8n-sync.env`, or `./.env`:

| var | meaning | default |
|---|---|---|
| `N8N_CONTAINER` | n8n container on the target (its `DB_POSTGRESDB_*` env is reused for SQL) | `n8n` |
| `N8N_PROJECT_ID` | project that imported workflows + their folders are placed in (REQUIRED on multi-project/team instances) | oldest personal |
| `N8N_API_KEY` | target public API key → live activation | — |
| `N8N_REMOTE_DOCKER_HOST` | `ssh://user@host` for `--remote` | — |
| `WORKFLOWS_DIR` | repo dir for workflow JSON + `folders.json` | `workflows` |
| `SCOPE_FILE` | `{"workflows":[{id,name}]}` limiting which ids sync | `workflow-ids.json` |

## Requirements

- Host: `bash` 4+, `jq`, `docker` (and `git` for `pull`). **`jq` is host-side only** —
  the n8n container needs nothing extra.
- Target: an n8n instance reachable via `docker exec` (local socket or a remote
  daemon over `DOCKER_HOST=ssh://…`). Postgres can be a sibling container or
  managed/external — n8n-sync reads the DB creds from the n8n container's own env
  and runs its SQL there, so no pg container is required.

## License

MIT — see [LICENSE](LICENSE).
