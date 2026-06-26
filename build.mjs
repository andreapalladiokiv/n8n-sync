import { build } from 'esbuild';
import { chmodSync, copyFileSync } from 'node:fs';

const OUT = 'dist/n8n-sync.mjs';

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: OUT,
  // Minify to shrink the bundled TypeORM (~2.3M → ~1.0M). Identifier-minification is safe
  // here: we use TypeORM with `entities: []` (no name-based entity metadata), and the full
  // path — DataSource init, raw queries, QueryRunner transactions, a real import — was
  // verified working minified (so no `keepNames`). `legalComments:'none'` drops licenses.
  minify: true,
  legalComments: 'none',
  // Self-contained bundle: `@n8n/typeorm` + `pg` (pure JS) are bundled IN, so the engine
  // carries its own DB layer and needs nothing resolved from n8n's install at runtime.
  // TypeORM lazily `require()`s every optional driver; the NATIVE ones (and drivers we
  // don't use) can't/shouldn't be bundled → keep them external. The pg path needs none of
  // them; `sqlite3` is only touched for DB_TYPE=sqlite (native — must be present at runtime).
  external: [
    'sqlite3', 'better-sqlite3', 'mysql2', 'mysql', 'pg-native', 'pg-query-stream',
    'mongodb', 'oracledb', 'mssql', 'ioredis', 'redis', 'sql.js', 'react-native-sqlite-storage',
    'typeorm-aurora-data-api-driver', '@sap/hana-client', 'hdb-pool', '@google-cloud/spanner', '@sentry/node',
  ],
  banner: {
    // 1) shebang so the bundle is directly executable as the `n8n-sync` bin.
    // 2) require shim — commander 13.x ships CommonJS; an ESM bundle's __require would
    //    otherwise throw "Dynamic require of node:events" at startup. Mandatory.
    // 3) __filename/__dirname — some CJS transitive deps of typeorm (e.g. app-root-path)
    //    read them, and an ESM bundle has neither. Mandatory for the bundle to load.
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

// Ship the n8n external hook (plain CJS — n8n loads hook files via require()) next
// to the bundle, so it can resolve the sibling CLI at runtime. Copied verbatim.
copyFileSync('src/hook.cjs', 'dist/hook.cjs');

console.error(`built ${OUT} + dist/hook.cjs`);
