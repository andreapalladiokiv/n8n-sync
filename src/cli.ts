import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { serializeWorkflow } from './normalize';

const VERSION = '2.0.0-alpha.0';

/** Resolved config: CLI flag > env > built-in default (mirrors bash load_config). */
interface Config {
  remote: boolean;
  dryRun: boolean;
  container: string;
  projectId?: string;
  workflowsDir: string;
  scopeFile: string;
}

/** Shared options, attached to every subcommand so they work AFTER the command
 *  name (`n8n-sync normalize --dry-run …`), matching the old bash ergonomics. */
function withSharedOptions(cmd: Command): Command {
  return cmd
    .option('--remote', 'target N8N_REMOTE_DOCKER_HOST instead of the local daemon')
    .option('--dry-run', 'plan only; perform no mutations')
    .option('--container <name>', 'n8n container on the target [env N8N_CONTAINER]')
    .option('--project-id <id>', 'project that owns workflows + folders [env N8N_PROJECT_ID]')
    .option('--workflows-dir <dir>', 'repo dir for workflow JSON [env WORKFLOWS_DIR]')
    .option('--scope-file <path>', 'JSON scope limiting which workflows sync [env SCOPE_FILE]');
}

/** Merge this command's flags with env and defaults (flag > env > default). */
function resolveConfig(cmd: Command): Config {
  const o = cmd.opts<Partial<Config>>();
  const env = process.env;
  return {
    remote: o.remote ?? false,
    dryRun: o.dryRun ?? false,
    container: o.container ?? env.N8N_CONTAINER ?? 'n8n',
    projectId: o.projectId ?? env.N8N_PROJECT_ID ?? undefined,
    workflowsDir: o.workflowsDir ?? env.WORKFLOWS_DIR ?? 'workflows',
    scopeFile: o.scopeFile ?? env.SCOPE_FILE ?? 'workflow-ids.json',
  };
}

/** Recursively collect workflow JSON files (skips the folders.json manifest). */
function walkWorkflowJson(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkWorkflowJson(p));
    else if (e.isFile() && e.name.endsWith('.json') && e.name !== 'folders.json') out.push(p);
  }
  return out;
}

function runNormalize(files: string[], cfg: Config): void {
  const targets = files.length ? files : walkWorkflowJson(cfg.workflowsDir);
  let changed = 0;
  for (const f of targets) {
    if (path.basename(f) === 'folders.json') continue;
    const before = fs.readFileSync(f, 'utf8');
    const after = serializeWorkflow(JSON.parse(before));
    if (after === before) continue;
    changed++;
    const rel = path.relative(process.cwd(), f);
    if (cfg.dryRun) {
      console.error(`would normalize ${rel}`);
    } else {
      fs.writeFileSync(f, after);
      console.error(`normalized ${rel}`);
    }
  }
  if (changed === 0) console.error('all workflow JSON already canonical');
}

/** Strangler placeholder — these commands still live in the bash engine. */
function notPorted(name: string): never {
  console.error(`n8n-sync: '${name}' is not ported to the TS engine yet (use the bash engine for now)`);
  process.exit(2);
}

const program = new Command();
program
  .name('n8n-sync')
  .description('portable CI/CD sync for n8n workflows (over docker exec)')
  .version(VERSION, '--version', 'output the version number')
  .enablePositionalOptions()
  .showHelpAfterError();

withSharedOptions(program.command('normalize [files...]'))
  .description('canonicalize workflow JSON in place (all under --workflows-dir if none given)')
  .action((files: string[], _opts: unknown, cmd: Command) => runNormalize(files, resolveConfig(cmd)));

withSharedOptions(program.command('export'))
  .description('n8n -> repo: export in-scope workflows, normalize, mirror the folder tree')
  .action(() => notPorted('export'));

withSharedOptions(program.command('import'))
  .description('repo -> n8n: id-preserving import, folders, credential-aware + cycle-safe activation')
  .action(() => notPorted('import'));

withSharedOptions(program.command('pull'))
  .description('export local -> git pull (3-way merge) -> import the merged result')
  .action(() => notPorted('pull'));

withSharedOptions(program.command('projects'))
  .description("list the target's projects (id|name|type) to pick a --project-id")
  .action(() => notPorted('projects'));

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
