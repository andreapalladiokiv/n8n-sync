import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { serializeWorkflow } from './normalize';
import { walkWorkflowJson } from './fsutil';
import { bootstrap } from './incontainer/bridge';
import { runExport, runImport, runProjects, envConfig } from './incontainer/engine';

// n8n-sync 2.x — ONE bundle, two roles:
//   • HOST: `normalize` / `hook-path` (pure JSON, no n8n).
//   • IN-CONTAINER: `export` / `import` / `projects` run as `docker exec <c> node n8n-sync.mjs <cmd>`
//     (exactly as 1.x / the deploy did) — but now they reuse n8n's OWN DataSource + ImportService
//     via the bridge (no bundled DB driver, no `n8n` CLI shell-out, no REST). `bootstrap()` brings
//     up the minimum of n8n's runtime in this standalone process. Realtime export is the hook.
// There are NO registered n8n commands (no dist/commands drop-in) — this bundle IS the entrypoint.

const VERSION = '2.0.0-alpha.1'; // keep in sync with package.json "version"

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

/** Run an in-container command: bootstrap n8n's runtime, run, then exit (the open DataSource pool
 *  keeps the event loop alive, so a standalone process won't drain on its own). */
async function inContainer(run: () => Promise<number | void>): Promise<never> {
  let rc = 0;
  try {
    await bootstrap();
    rc = (await run()) || 0;
  } catch (e) {
    process.stderr.write(`n8n-sync: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    rc = 1;
  }
  process.exit(rc);
}

const program = new Command();
program
  .name('n8n-sync')
  .description('CI/CD sync for n8n workflows — host (normalize) + in-container (export/import/projects, run via `node n8n-sync.mjs <cmd>`)')
  .version(VERSION, '--version', 'output the version number')
  .enablePositionalOptions()
  .showHelpAfterError();

program.command('normalize [files...]')
  .description('canonicalize workflow JSON in place (all under --workflows-dir if none given) [host]')
  .option('--workflows-dir <dir>', 'repo dir for workflow JSON [env WORKFLOWS_DIR]')
  .option('--dry-run', 'plan only; write nothing')
  .action((files: string[], opts: { workflowsDir?: string; dryRun?: boolean }) => {
    runNormalize(files, opts.workflowsDir ?? process.env.WORKFLOWS_DIR ?? 'workflows', opts.dryRun ?? false);
  });

program.command('hook-path')
  .description('print the path to the bundled n8n external hook (for EXTERNAL_HOOK_FILES) [host]')
  .action(() => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    process.stdout.write(`${path.join(dir, 'hook.cjs')}\n`);
  });

program.command('export')
  .description('n8n -> repo: export in-scope workflows, normalize, mirror folders [in-container]')
  .action(() => inContainer(() => runExport(envConfig())));

program.command('import')
  .description('repo -> n8n: id-preserving import + folders + cycle-safe in-process activation [in-container]')
  .action(() => inContainer(() => runImport(envConfig())));

program.command('projects')
  .description('list projects (id|name|type) to pick an N8N_PROJECT_ID [in-container]')
  .action(() => inContainer(() => runProjects()));

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
