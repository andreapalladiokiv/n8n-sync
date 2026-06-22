import fs from 'node:fs';
import path from 'node:path';
import { serializeWorkflow } from './normalize';

const VERSION = '2.0.0-alpha.0';

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

/** `normalize [files…]` — canonicalize in place; defaults to the whole tree. */
function cmdNormalize(files: string[]): void {
  const targets = files.length ? files : walkWorkflowJson(process.env.WORKFLOWS_DIR || 'workflows');
  for (const f of targets) {
    if (path.basename(f) === 'folders.json') continue;
    const before = fs.readFileSync(f, 'utf8');
    const after = serializeWorkflow(JSON.parse(before));
    if (after !== before) {
      fs.writeFileSync(f, after);
      console.error(`normalized ${path.relative(process.cwd(), f)}`);
    }
  }
}

function main(argv: string[]): void {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'normalize':
      cmdNormalize(args);
      break;
    case '--version':
      process.stdout.write(`n8n-sync ${VERSION}\n`);
      break;
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      process.stderr.write(
        `n8n-sync ${VERSION} (ts-rewrite, phase 0)\n` +
        `  normalize [files…]   canonicalize workflow JSON in place\n` +
        `  (export/import/pull/projects — porting in progress)\n`,
      );
      process.exit(cmd ? 0 : 1);
      break;
    default:
      process.stderr.write(`n8n-sync: unknown command '${cmd}'\n`);
      process.exit(1);
  }
}

main(process.argv.slice(2));
