import * as bridge from './bridge';
import { registerCommand } from './register';
import { runExport, runImport, runProjects, envConfig } from './engine';

// NODE_OPTIONS=--require=<this file> — registers n8n-sync's CLI commands into n8n's CommandMetadata
// at PROCESS START, before the bin calls CommandRegistry.execute(). Wired purely by env (sibling to
// EXTERNAL_HOOK_FILES); the file lives anywhere (no <n8nRoot>/dist/commands mount). It runs in every
// n8n process in the container — cheap, since it only REGISTERS (the engine runs only when a command
// is actually dispatched, by which point the bin has done its full bootstrap: config + loadModules).
//
// reflect-metadata must be present before @n8n/di's decorators are touched; the bin loads it too,
// but we run earlier, so load it first ourselves (idempotent — the bin's later require is a no-op).
bridge.pkg('reflect-metadata');

registerCommand('n8n-sync:export', 'n8n-sync: export workflows from n8n into the repo (in-process)', () => runExport(envConfig()));
registerCommand('n8n-sync:import', 'n8n-sync: import workflows from the repo into n8n (ImportService + in-process activation)', () => runImport(envConfig()));
registerCommand('n8n-sync:projects', 'n8n-sync: list projects (id|name|type) to pick an N8N_PROJECT_ID', () => runProjects());
