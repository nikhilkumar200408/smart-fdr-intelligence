import fs from 'fs'; import os from 'os'; import path from 'path';
import { newDb } from 'pg-mem';
import { expect, it } from 'vitest';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fdr-seed-')); process.env.JWT_SECRET = 'x';
it('seed populates demo data and alert scan runs on it', async () => {
  const { seed } = await import('../src/seed'); const { runAlertScan } = await import('../src/alerts');
  const { Pool } = newDb().adapters.createPg(); const db: any = new Pool();
  expect(await seed(db)).toBe(16);
  expect((await db.query('select count(*) as c from fdrs')).rows[0].c).toBe(16);
  const r = await runAlertScan(db); expect(r.created).toBeGreaterThan(0);
});
