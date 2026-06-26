import fs from 'node:fs';
import path from 'node:path';
import { DataSource } from '@n8n/typeorm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Self-contained DB layer: `@n8n/typeorm` (+ the pure-JS `pg` driver) is a DIRECT
// dependency, bundled into the single-file build — so the engine carries its own ORM and
// resolves NOTHING from n8n's install at runtime. The Postgres path (what the consumers
// use) needs no optional drivers. (DB_TYPE=sqlite would additionally need the native
// `sqlite3` driver present at runtime — it can't be bundled; not installed by default.)

const envFile = (v: string | undefined, f: string | undefined): string | undefined => {
  try { return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/\s+$/, '') : v; }
  catch { return v; }
};

export type Dialect = 'postgres' | 'sqlite';

// Postgres uses $1,$2,… ; sqlite/better-sqlite use positional `?`. Callers write the
// pg `$N` form; for sqlite we rewrite to `?` and re-emit params positionally (so a
// reused $N is bound once per occurrence). No `?`/`$` ever appears inside our SQL
// literals, so this purely-syntactic pass is safe.
function toQmark(text: string, values: unknown[]): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const sql = text.replace(/\$(\d+)/g, (_m, n: string) => { params.push(values[Number(n) - 1]); return '?'; });
  return { sql, params };
}

/** Thin DB layer over n8n's own ORM, DB-agnostic (Postgres + SQLite). Built by hand
 *  from n8n's DB_* env — no n8n DI. All callers use parameterized `$N` queries. */
export class Db {
  private constructor(
    private readonly ds: any,
    readonly dialect: Dialect,
    private readonly runner: any | null = null, // a QueryRunner while inside tx()
  ) {}

  static async open(): Promise<Db> {
    const E = process.env;
    const dbType = (E.DB_TYPE || 'sqlite').toLowerCase();

    let opts: Record<string, unknown>;
    let dialect: Dialect;
    if (dbType === 'postgresdb' || dbType === 'postgres') {
      dialect = 'postgres';
      const sslOn = E.DB_POSTGRESDB_SSL_ENABLED === 'true' || !!E.DB_POSTGRESDB_SSL_CA || !!E.DB_POSTGRESDB_SSL_CERT;
      opts = {
        type: 'postgres',
        host: E.DB_POSTGRESDB_HOST || 'localhost',
        port: parseInt(E.DB_POSTGRESDB_PORT || '5432', 10),
        username: E.DB_POSTGRESDB_USER || 'postgres',
        password: String(envFile(E.DB_POSTGRESDB_PASSWORD, E.DB_POSTGRESDB_PASSWORD_FILE) || ''),
        database: E.DB_POSTGRESDB_DATABASE || E.DB_POSTGRESDB_USER || 'n8n',
        schema: E.DB_POSTGRESDB_SCHEMA && E.DB_POSTGRESDB_SCHEMA !== 'public' ? E.DB_POSTGRESDB_SCHEMA : undefined,
        ssl: sslOn ? { rejectUnauthorized: E.DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED !== 'false', ca: E.DB_POSTGRESDB_SSL_CA || undefined } : false,
      };
    } else if (dbType === 'sqlite' || dbType === '') {
      dialect = 'sqlite';
      const userFolder = E.N8N_USER_FOLDER || E.HOME || '/home/node';
      const file = E.DB_SQLITE_DATABASE || path.join(userFolder, '.n8n', 'database.sqlite');
      opts = { type: 'sqlite', database: file };
    } else {
      throw new Error(`n8n-sync: DB_TYPE='${dbType}' is not supported yet — only 'postgresdb' and 'sqlite' (MySQL/MariaDB: TBD).`);
    }

    const ds = new DataSource({ ...opts, entities: [], synchronize: false, migrationsRun: false, logging: false } as any);
    await ds.initialize();
    // SQLite is a file shared with the running n8n: wait on a lock instead of erroring.
    if (dialect === 'sqlite') await ds.query('PRAGMA busy_timeout = 10000');
    return new Db(ds, dialect);
  }

  private async run(text: string, values: unknown[]): Promise<any[]> {
    const q = this.dialect === 'sqlite' ? toQmark(text, values) : { sql: text, params: values };
    const exec = this.runner ?? this.ds;
    const r = await exec.query(q.sql, q.params);
    return Array.isArray(r) ? r : [];
  }

  /** SELECT → array of row objects (keyed by column/alias name). */
  async rows<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await this.run(text, values)) as T[];
  }

  /** Single scalar (first column of the first row), or undefined. */
  async scalar<T = string>(text: string, values: unknown[] = []): Promise<T | undefined> {
    const r0 = (await this.run(text, values))[0];
    return r0 ? (Object.values(r0)[0] as T) : undefined;
  }

  /** INSERT/UPDATE/DELETE. (Affected-row count is not consumed by any caller.) */
  async exec(text: string, values: unknown[] = []): Promise<number> {
    await this.run(text, values);
    return 0;
  }

  /** Run fn in a single transaction (one held connection via a QueryRunner — a pooled
   *  ds.query() would scatter BEGIN/work/COMMIT across connections). Atomic import. */
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const out = await fn(new Db(this.ds, this.dialect, qr));
      await qr.commitTransaction();
      return out;
    } catch (e) {
      await qr.rollbackTransaction();
      throw e;
    } finally {
      await qr.release();
    }
  }

  async close(): Promise<void> { await this.ds.destroy(); }
}
