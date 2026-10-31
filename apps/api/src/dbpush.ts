import { config } from './config';
import { applySchema, makePool } from './db';
(async () => { const db = makePool(config.databaseUrl); await applySchema(db); console.log('Schema applied.'); process.exit(0); })().catch((e) => { console.error(e.message); process.exit(1); });
