import { registerCommand } from './register';
import { runImport, envConfig } from './engine';

// Drop-in command: `n8n n8n-sync:import` — mounted into <n8nRoot>/dist/commands/n8n-sync/import.js
registerCommand(
  'n8n-sync:import',
  'n8n-sync: import workflows from the repo into n8n (in-process; ImportService + in-process activation)',
  () => runImport(envConfig()),
);
