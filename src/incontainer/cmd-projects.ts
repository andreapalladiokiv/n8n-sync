import { registerCommand } from './register';
import { runProjects } from './engine';

// Drop-in command: `n8n n8n-sync:projects` — mounted into <n8nRoot>/dist/commands/n8n-sync/projects.js
registerCommand(
  'n8n-sync:projects',
  'n8n-sync: list projects (id|name|type) to pick an N8N_PROJECT_ID',
  () => runProjects(),
);
