import { registerCommand } from './register';
import { runWatch } from './watch';
import { envConfig } from './engine';

// Drop-in command: `n8n n8n-sync:watch` — long-lived poller (run it detached / in a terminal /
// as a sidecar). Interval via N8N_SYNC_WATCH_INTERVAL (seconds, default 3).
const intervalMs = Math.max(1, Number(process.env.N8N_SYNC_WATCH_INTERVAL) || 3) * 1000;
registerCommand(
  'n8n-sync:watch',
  'n8n-sync: long-lived poller — export workflows on change (sidecar alternative to the hook)',
  () => runWatch(envConfig(), intervalMs),
);
