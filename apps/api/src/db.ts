import { Pool, types } from 'pg';
import { SCHEMA } from './schema';

types.setTypeParser(1700, (v) => parseFloat(v)); // numeric -> number
types.setTypeParser(20, (v) => parseInt(v, 10)); // bigint (count) -> number

export interface Q { query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount: number | null }>; }
export interface DB extends Q { connect(): Promise<Q & { release(): void }>; }

export async function tx<T>(db: DB, fn: (q: Q) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { try { await c.query('ROLLBACK'); } catch { /* ignore */ } throw e; }
  finally { c.release(); }
}
export async function applySchema(db: Q) {
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
}
export const makePool = (url: string): DB => new Pool({ connectionString: url }) as unknown as DB;
