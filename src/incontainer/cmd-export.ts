import { registerCommand } from './register';
import { runExport, envConfig } from './engine';

// Drop-in command: `n8n n8n-sync:export` — mounted into <n8nRoot>/dist/commands/n8n-sync/export.js
registerCommand(
  'n8n-sync:export',
  'n8n-sync: export workflows from n8n into the repo (in-process; reuses n8n\'s DataSource)',
  () => runExport(envConfig()),
);
