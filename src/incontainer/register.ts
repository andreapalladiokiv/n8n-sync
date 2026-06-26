import * as bridge from './bridge';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Register a drop-in n8n CLI command at module load. n8n's CommandRegistry dispatches by
// dynamically `require()`-ing ./commands/<name with ':'→'/'>.js (command-registry.js) and then
// looking the name up in the CommandMetadata singleton — so registering here, into n8n's OWN
// @n8n/di Container, makes `n8n <name>` resolve. We register WITHOUT extending BaseCommand (which
// would need emitted DI metadata); instead the engine opens what it needs via the bridge.
export function registerCommand(
  name: string,
  description: string,
  run: () => Promise<number | void>,
): void {
  const { Container, Service } = bridge.pkg('@n8n/di');
  const { CommandMetadata } = bridge.pkg('@n8n/decorators');
  const { z } = bridge.pkg('zod');

  class SyncCommand {
    async run(): Promise<void> {
      let rc = 0;
      try {
        rc = (await run()) || 0;
      } catch (e: any) {
        process.stderr.write(`n8n-sync: ${e?.stack ?? e?.message ?? String(e)}\n`);
        rc = 1;
      }
      // A fresh `n8n <cmd>` process holds n8n's open DataSource pool, so the event loop never
      // drains on its own. Exit explicitly — our logging is synchronous stderr, nothing is lost.
      process.exit(rc);
    }
  }
  Service()(SyncCommand);
  Container.get(CommandMetadata).register(name, { class: SyncCommand, description, flagsSchema: z.object({}) });
}
