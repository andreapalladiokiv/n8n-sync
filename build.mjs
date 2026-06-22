import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

const OUT = 'dist/n8n-sync.mjs';

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: OUT,
  // `pg` is resolved at RUNTIME from n8n's own node_modules inside the container
  // (the only external; commander has zero transitive deps and bundles in).
  external: ['pg'],
  banner: {
    // 1) shebang so the bundle is directly executable as the `n8n-sync` bin.
    // 2) createRequire shim — commander 13.x ships CommonJS; an ESM bundle's
    //    __require would otherwise throw "Dynamic require of node:events" at
    //    startup. This is mandatory, do not remove (verified by the lib review).
    js:
      "#!/usr/bin/env node\n" +
      "import { createRequire as __ns_cr } from 'node:module';\n" +
      "const require = __ns_cr(import.meta.url);",
  },
});

chmodSync(OUT, 0o755);
console.error(`built ${OUT}`);
