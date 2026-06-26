import { build } from 'esbuild';
import { chmodSync, copyFileSync } from 'node:fs';

// n8n-sync 2.x build. TWO artifacts, neither bundles a DB driver — all DB work runs inside the n8n
// process against n8n's OWN DataSource + services (see src/incontainer/bridge.ts):
//   1. dist/n8n-sync.mjs — the bin. HOST: normalize / hook-path. IN-CONTAINER: export / import /
//      projects, run as `docker exec <c> node n8n-sync.mjs <cmd>` (bridge.bootstrap brings up n8n's
//      runtime; the engine reuses n8n's DataSource + ImportService). No registered n8n commands.
//   2. dist/hook.cjs (+hook-impl.cjs) — external hook (EXTERNAL_HOOK_FILES): in-process export-on-save.
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
    // 1) shebang (directly executable bin).
    // 2) require shim — commander 13.x is CJS, and the bridge's createRequire/dynamic require of
    //    n8n's modules needs a `require` in this ESM bundle.
    // 3) __filename/__dirname — the bridge walks up from __dirname to locate the n8n install root;
    //    an ESM bundle has neither, so synthesize them from import.meta.url.
    js:
      "#!/usr/bin/env node\n" +
      "import { createRequire as __ns_cr } from 'node:module';\n" +
      "import { fileURLToPath as __ns_ftp } from 'node:url';\n" +
      "import { dirname as __ns_dn } from 'node:path';\n" +
      "const require = __ns_cr(import.meta.url);\n" +
      "const __filename = __ns_ftp(import.meta.url);\n" +
      "const __dirname = __ns_dn(__filename);",
  },
});
chmodSync(OUT, 0o755);

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

console.error(`built ${OUT} + dist/hook.cjs (+hook-impl.cjs)`);
