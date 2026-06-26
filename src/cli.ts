import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { serializeWorkflow } from './normalize';
import { resolveConfig } from './config';
import type { Config } from './config';
import { walkWorkflowJson } from './fsutil';
import { cmdExport } from './commands/export';
import { cmdImport } from './commands/import';
import { cmdProjects } from './commands/projects';
import { cmdWatch } from './commands/watch';

const VERSION = '1.6.0'; // keep in sync with package.json "version"

/** Shared options, attached per-subcommand so they work AFTER the command name. */
function withSharedOptions(cmd: Command): Command {
  return cmd
    .option('--dry-run', 'plan only; perform no mutations')
    .option('--project-id <id>', 'project that owns workflows + folders [env N8N_PROJECT_ID]')
    .option('--workflows-dir <dir>', 'repo dir for workflow JSON [env WORKFLOWS_DIR]')
    .option('--scope-file <path>', 'JSON scope limiting which workflows sync [env SCOPE_FILE]');
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
    if (cfg.dryRun) process.stderr.write(`would normalize ${rel}\n`);
    else { fs.writeFileSync(f, after); process.stderr.write(`normalized ${rel}\n`); }
  }
  if (changed === 0) process.stderr.write('all workflow JSON already canonical\n');
}

const program = new Command();
program
  .name('n8n-sync')
  .description('CI/CD sync for n8n workflows — runs inside the n8n container (pg + n8n CLI)')
  .version(VERSION, '--version', 'output the version number')
  .enablePositionalOptions()
  .showHelpAfterError();

withSharedOptions(program.command('normalize [files...]'))
  .description('canonicalize workflow JSON in place (all under --workflows-dir if none given)')
  .action((files: string[], _opts: unknown, cmd: Command) => runNormalize(files, resolveConfig(cmd)));

withSharedOptions(program.command('export'))
  .description('n8n -> repo: export in-scope workflows, normalize, mirror the folder tree')
  .action(async (_opts: unknown, cmd: Command) => { await cmdExport(resolveConfig(cmd)); });

withSharedOptions(program.command('import'))
  .description('repo -> n8n: id-preserving import, folders, credential-aware + cycle-safe activation')
  .action(async (_opts: unknown, cmd: Command) => { process.exitCode = await cmdImport(resolveConfig(cmd)); });

program.command('hook-path')
  .description('print the path to the bundled n8n external hook (for EXTERNAL_HOOK_FILES)')
  .action(() => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    process.stdout.write(`${path.join(dir, 'hook.cjs')}\n`);
  });

program.command('pull')
  .description('(host orchestration) export -> git pull -> import — run via `make pull`, not in-container')
  .action(() => {
    process.stderr.write('n8n-sync: `pull` is host-side orchestration (git + docker exec export/import); run it from the Makefile (`make pull`), not the in-container engine.\n');
    process.exit(2);
  });

withSharedOptions(program.command('projects'))
  .description("list the target's projects (id|name|type) to pick a --project-id")
  .action(async () => { await cmdProjects(); });

withSharedOptions(program.command('watch'))
  .description('poll the instance and export on change — independent real-time mirror (local sidecar)')
  .option('--interval <seconds>', 'poll interval in seconds', '3')
  .action(async (opts: { interval?: string }, cmd: Command) => {
    await cmdWatch(resolveConfig(cmd), Math.max(1, Number(opts.interval ?? 3)) * 1000);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
