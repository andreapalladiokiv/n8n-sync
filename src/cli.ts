import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { serializeWorkflow } from './normalize';
import { resolveConfig } from './config';
import type { Config } from './config';
import { cmdExport } from './commands/export';
import { cmdImport } from './commands/import';
import { cmdProjects } from './commands/projects';

const VERSION = '2.0.0-alpha.0';

/** Shared options, attached per-subcommand so they work AFTER the command name. */
function withSharedOptions(cmd: Command): Command {
  return cmd
    .option('--dry-run', 'plan only; perform no mutations')
    .option('--project-id <id>', 'project that owns workflows + folders [env N8N_PROJECT_ID]')
    .option('--workflows-dir <dir>', 'repo dir for workflow JSON [env WORKFLOWS_DIR]')
    .option('--scope-file <path>', 'JSON scope limiting which workflows sync [env SCOPE_FILE]');
}

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
    if (cfg.dryRun) process.stderr.write(`would normalize ${rel}\n`);
    else { fs.writeFileSync(f, after); process.stderr.write(`normalized ${rel}\n`); }
  }
  if (changed === 0) process.stderr.write('all workflow JSON already canonical\n');
}

function notPorted(name: string): never {
  process.stderr.write(`n8n-sync: '${name}' is not ported to the TS engine yet (use the bash engine for now)\n`);
  process.exit(2);
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

withSharedOptions(program.command('projects'))
  .description("list the target's projects (id|name|type) to pick a --project-id")
  .action(async () => { await cmdProjects(); });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
