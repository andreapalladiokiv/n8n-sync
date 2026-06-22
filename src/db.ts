import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// `pg` is NOT bundled — it is resolved at runtime from n8n's own node_modules
// (the engine runs inside the n8n container, where pg is always present and is
// the exact driver n8n uses). Mirrors the legacy NODE_PG resolution.
function loadPg(): { Client: new (cfg: unknown) => PgClient } {
  const require = createRequire(import.meta.url);
  const tried: string[] = [];
  const cands: string[] = [];
  const pnpm = '/usr/local/lib/node_modules/n8n/node_modules/.pnpm';
  try {
    for (const e of fs.readdirSync(pnpm)) if (/^pg@\d/.test(e)) cands.push(path.join(pnpm, e, 'node_modules', 'pg'));
  } catch { /* not in the n8n image layout */ }
  cands.push('pg', '/usr/local/lib/node_modules/n8n/node_modules/pg', '/n8ncicd/node_modules/pg');
  for (const c of cands) {
    try { return require(c) as { Client: new (cfg: unknown) => PgClient }; }
    catch (e) { tried.push(`${c}:${(e as NodeJS.ErrnoException).code}`); }
  }
  throw new Error(`no resolvable \`pg\` module in the n8n image (tried ${tried.join(', ')})`);
}

interface PgClient {
  connect(): Promise<void>;
  query(q: { text: string; values?: unknown[]; rowMode?: 'array' } | string, values?: unknown[]): Promise<{ rows: unknown[][] | Record<string, unknown>[]; rowCount: number | null }>;
  end(): Promise<void>;
}

const envFile = (v: string | undefined, f: string | undefined): string | undefined => {
  try { return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/\s+$/, '') : v; }
  catch { return v; }
};

/** Thin wrapper over n8n's bundled `pg`, using n8n's OWN DB_POSTGRESDB_* env.
 *  All callers use parameterized queries — no string interpolation, no escaping. */
export class Db {
  private constructor(private readonly client: PgClient) {}

  static async open(): Promise<Db> {
    const { Client } = loadPg();
    const E = process.env;
    const sslOn = E.DB_POSTGRESDB_SSL_ENABLED === 'true' || !!E.DB_POSTGRESDB_SSL_CA || !!E.DB_POSTGRESDB_SSL_CERT;
    const client = new Client({
      host: E.DB_POSTGRESDB_HOST || 'localhost',
      port: parseInt(E.DB_POSTGRESDB_PORT || '5432', 10),
      user: E.DB_POSTGRESDB_USER || 'postgres',
      password: String(envFile(E.DB_POSTGRESDB_PASSWORD, E.DB_POSTGRESDB_PASSWORD_FILE) || ''),
      database: E.DB_POSTGRESDB_DATABASE || E.DB_POSTGRESDB_USER || 'n8n',
      ssl: sslOn
        ? { rejectUnauthorized: E.DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED !== 'false', ca: E.DB_POSTGRESDB_SSL_CA || undefined }
        : false,
    });
    await client.connect();
    const schema = E.DB_POSTGRESDB_SCHEMA;
    if (schema && schema !== 'public') {
      await client.query(`SET search_path TO "${schema.replace(/"/g, '""')}", public`);
    }
    return new Db(client);
  }

  /** SELECT → array of row objects. */
  async rows<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
    const r = await this.client.query({ text, values });
    return r.rows as T[];
  }

  /** Single scalar (first column of first row), or undefined. */
  async scalar<T = string>(text: string, values: unknown[] = []): Promise<T | undefined> {
    const r = await this.client.query({ text, values, rowMode: 'array' });
    const first = (r.rows as unknown[][])[0];
    return first ? (first[0] as T) : undefined;
  }

  /** INSERT/UPDATE/DELETE → affected row count. */
  async exec(text: string, values: unknown[] = []): Promise<number> {
    const r = await this.client.query({ text, values });
    return r.rowCount ?? 0;
  }

  /** Run fn inside a single transaction; commit on success, rollback on throw.
   *  This is what makes import atomic — no half-applied ownership/folder/tag state. */
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    await this.client.query('BEGIN');
    try {
      const out = await fn(this);
      await this.client.query('COMMIT');
      return out;
    } catch (e) {
      await this.client.query('ROLLBACK');
      throw e;
    }
  }

  async close(): Promise<void> { await this.client.end(); }
}
