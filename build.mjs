import { build } from 'esbuild';
import { chmodSync, copyFileSync } from 'node:fs';

// n8n-sync 2.x build. THREE artifacts, none of which bundles a DB driver — all DB work now runs
// inside the n8n process against n8n's OWN DataSource + services (see src/incontainer/bridge.ts):
//   1. dist/n8n-sync.mjs        — host CLI (normalize / hook-path), pure JSON, no deps.
//   2. dist/n8n-cmd/{export,import,projects}.js — drop-in n8n CLI commands, mounted into
//      <n8nRoot>/dist/commands/n8n-sync/ → `n8n n8n-sync:export|import|projects`.
//   3. dist/hook.cjs            — external hook (EXTERNAL_HOOK_FILES): in-process export-on-save.
// n8n's modules are resolved at RUNTIME via the bridge (dynamic createRequire), never statically
// imported, so esbuild bundles none of n8n / typeorm / pg.

const OUT = 'dist/n8n-sync.mjs';

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: OUT,
  minify: true,
  legalComments: 'none',
  banner: {
    // shebang (directly executable bin) + a require shim, since commander 13.x is CommonJS and an
    // ESM bundle's __require would otherwise throw "Dynamic require of node:events" at startup.
    js:
      "#!/usr/bin/env node\n" +
      "import { createRequire as __ns_cr } from 'node:module';\n" +
      "const require = __ns_cr(import.meta.url);",
  },
});
chmodSync(OUT, 0o755);

// In-container drop-in commands (CJS — n8n loads command files via require()).
await build({
  entryPoints: {
    export: 'src/incontainer/cmd-export.ts',
    import: 'src/incontainer/cmd-import.ts',
    projects: 'src/incontainer/cmd-projects.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outdir: 'dist/n8n-cmd',
  minify: true,
  legalComments: 'none',
});

// External hook (CJS) — in-process export-on-save, reusing n8n's DataSource via the bridge. The
// logic bundles to dist/hook-impl.cjs (named exports); the committed shim becomes dist/hook.cjs
// (the EXTERNAL_HOOK_FILES entrypoint) and assembles the n8n hook shape from it.
await build({
  entryPoints: ['src/incontainer/hook.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: 'dist/hook-impl.cjs',
  minify: true,
  legalComments: 'none',
});
copyFileSync('src/incontainer/hook-shim.cjs', 'dist/hook.cjs');

console.error(`built ${OUT} + dist/hook.cjs (+hook-impl) + dist/n8n-cmd/{export,import,projects}.js`);
