import { createApp } from './app';
import { runAlertScan } from './alerts';
import { config } from './config';
import { applySchema, makePool } from './db';

(async () => {
  const db = makePool(config.databaseUrl);
  await applySchema(db);
  createApp(db).listen(config.port, () => console.log(`API on http://localhost:${config.port}`));
  const scan = () => runAlertScan(db).then((r) => console.log('[alerts] scan', r)).catch((e) => console.error('[alerts] failed', e.message));
  setTimeout(scan, 3000); setInterval(scan, 6 * 3600 * 1000);
})().catch((e) => { console.error(e); process.exit(1); });
