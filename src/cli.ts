import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { serializeWorkflow } from './normalize';
import { walkWorkflowJson } from './fsutil';

// n8n-sync 2.x HOST CLI. The DB-touching work (export/import/projects + realtime export) now
// runs INSIDE the n8n process via the drop-in commands `n8n n8n-sync:{export,import,projects}`
// (dist/n8n-cmd/, mounted into n8n's dist/commands) and the external hook (dist/hook.cjs) — all
// reusing n8n's own DataSource + ImportService, so this host bundle carries NO DB driver. What
// remains host-side is pure JSON work: `normalize` (+ `hook-path` for EXTERNAL_HOOK_FILES wiring).
// The consuming Makefile's `make export/import/projects` `docker exec`s the in-container commands.

const VERSION = '2.0.0-alpha'; // keep in sync with package.json "version"

function runNormalize(files: string[], workflowsDir: string, dryRun: boolean): void {
  const targets = files.length ? files : walkWorkflowJson(workflowsDir);
  let changed = 0;
  for (const f of targets) {
    if (path.basename(f) === 'folders.json') continue;
    const before = fs.readFileSync(f, 'utf8');
    const after = serializeWorkflow(JSON.parse(before));
    if (after === before) continue;
    changed++;
    const rel = path.relative(process.cwd(), f);
    if (dryRun) process.stderr.write(`would normalize ${rel}\n`);
    else { fs.writeFileSync(f, after); process.stderr.write(`normalized ${rel}\n`); }
  }
  if (changed === 0) process.stderr.write('all workflow JSON already canonical\n');
}

const program = new Command();
program
  .name('n8n-sync')
  .description('CI/CD sync for n8n workflows — host side (normalize); export/import run in-container (`n8n n8n-sync:*`)')
  .version(VERSION, '--version', 'output the version number')
  .enablePositionalOptions()
  .showHelpAfterError();

program.command('normalize [files...]')
  .description('canonicalize workflow JSON in place (all under --workflows-dir if none given)')
  .option('--workflows-dir <dir>', 'repo dir for workflow JSON [env WORKFLOWS_DIR]')
  .option('--dry-run', 'plan only; write nothing')
  .action((files: string[], opts: { workflowsDir?: string; dryRun?: boolean }) => {
    runNormalize(files, opts.workflowsDir ?? process.env.WORKFLOWS_DIR ?? 'workflows', opts.dryRun ?? false);
  });

program.command('hook-path')
  .description('print the path to the bundled n8n external hook (for EXTERNAL_HOOK_FILES)')
  .action(() => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    process.stdout.write(`${path.join(dir, 'hook.cjs')}\n`);
  });

for (const moved of ['export', 'import', 'projects']) {
  program.command(moved)
    .description(`(moved) runs IN the n8n container in 2.x — use \`docker exec <n8n> n8n n8n-sync:${moved}\``)
    .allowUnknownOption()
    .action(() => {
      process.stderr.write(
        `n8n-sync 2.x: \`${moved}\` runs INSIDE the n8n container now — \`docker exec <container> n8n n8n-sync:${moved}\` ` +
        `(reuses n8n's DataSource + services; no REST). The Makefile's \`make ${moved}\` wrapper does this.\n`,
      );
      process.exit(2);
    });
}

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
