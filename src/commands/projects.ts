import { Db } from '../db';

/** List the target's projects so a --project-id can be chosen. Header → stderr so
 *  stdout stays clean "id|name|type" rows (scriptable). */
export async function cmdProjects(): Promise<void> {
  process.stderr.write('id|name|type   (set one as --project-id / N8N_PROJECT_ID; empty uses the personal project)\n');
  const db = await Db.open();
  try {
    const rows = await db.rows<{ id: string; name: string; type: string }>(
      'SELECT id, name, type FROM project ORDER BY "createdAt"',
    );
    for (const r of rows) process.stdout.write(`${r.id}|${r.name}|${r.type}\n`);
  } finally {
    await db.close();
  }
}
