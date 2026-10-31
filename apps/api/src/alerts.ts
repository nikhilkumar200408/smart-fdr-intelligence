import { SYSTEM } from './auth';
import { notify } from './audit';
import { DB, Q, tx } from './db';
import { doTransition } from './lifecycle';
import { addDays, daysBetween, today } from './util';

export const DEFAULT_SETTINGS = { reminderDays: [30, 15, 7, 1], scrutinySlaDays: 7 };
export async function getSettings(q: Q) {
  const { rows } = await q.query('select key,value from settings');
  const m = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
  return {
    reminderDays: m.reminderDays ? (JSON.parse(m.reminderDays) as number[]) : DEFAULT_SETTINGS.reminderDays,
    scrutinySlaDays: m.scrutinySlaDays ? Number(m.scrutinySlaDays) : DEFAULT_SETTINGS.scrutinySlaDays,
  };
}
export async function saveSettings(q: Q, s: { reminderDays: number[]; scrutinySlaDays: number }) {
  for (const [k, v] of [['reminderDays', JSON.stringify(s.reminderDays)], ['scrutinySlaDays', String(s.scrutinySlaDays)]]) {
    const u = await q.query('update settings set value=$2 where key=$1', [k, v]);
    if (!u.rowCount) await q.query('insert into settings(key,value) values($1,$2)', [k, v]);
  }
}
const bucket = (days: number, steps: number[]) => [...steps].sort((a, b) => a - b).find((s) => days <= s);

/** Idempotent scan: de-duplicated in-app notifications + automatic RENEWAL_DUE / EXPIRED moves. External email/SMS is NOT implemented. */
export async function runAlertScan(db: DB) {
  return tx(db, async (q) => {
    const s = await getSettings(q);
    const t = today();
    let created = 0, moved = 0;
    const n = async (x: Parameters<typeof notify>[1]) => { if (await notify(q, x)) created++; };
    const active = (await q.query(`select * from fdrs where status in ('APPROVED','RENEWAL_DUE')`)).rows;
    for (const f of active) {
      const dm = daysBetween(t, f.maturity_date), dv = daysBetween(t, f.validity_date);
      if (dm < 0) {
        await doTransition(q, f, 'EXPIRED', SYSTEM, 'Maturity date passed (automatic scan)'); moved++;
        await n({ institutionId: f.institution_id, staff: true, fdrId: f.id, type: 'EXPIRED', title: `FDR ${f.fdr_number} has expired`, message: `Matured on ${f.maturity_date}. Renewal/replacement or release action is needed.`, dedupeKey: `exp:${f.id}` });
        continue;
      }
      const b = bucket(dm, s.reminderDays);
      if (b !== undefined) {
        if (f.status === 'APPROVED') { await doTransition(q, f, 'RENEWAL_DUE', SYSTEM, `Within ${b}-day reminder window`); moved++; }
        await n({ institutionId: f.institution_id, staff: true, fdrId: f.id, type: 'MATURITY_REMINDER', title: `FDR ${f.fdr_number} matures in ${dm} day(s)`, message: `Maturity ${f.maturity_date} (reminder threshold ${b} days).`, dedupeKey: `mat:${f.id}:${b}` });
      }
      const vb = bucket(dv, s.reminderDays);
      if (dv >= 0 && vb !== undefined)
        await n({ institutionId: f.institution_id, staff: true, fdrId: f.id, type: 'VALIDITY_REMINDER', title: `FDR ${f.fdr_number} validity ends in ${dv} day(s)`, message: `Validity date ${f.validity_date}.`, dedupeKey: `val:${f.id}:${vb}` });
      if (dv < 0) await n({ institutionId: f.institution_id, staff: true, fdrId: f.id, type: 'VALIDITY_EXPIRED', title: `FDR ${f.fdr_number} validity has lapsed`, message: `Validity date ${f.validity_date} has passed.`, dedupeKey: `valexp:${f.id}` });
    }
    const overdue = (await q.query(`select * from fdrs where status='SUBMITTED' and submitted_at < $1`, [addDays(t, -s.scrutinySlaDays)])).rows;
    for (const f of overdue)
      await n({ staff: true, fdrId: f.id, type: 'SCRUTINY_OVERDUE', title: `Scrutiny overdue: ${f.fdr_number}`, message: `Submitted ${f.submitted_at.slice(0, 10)}, not picked up within ${s.scrutinySlaDays} days.`, dedupeKey: `overdue:${f.id}` });
    const withDoc = new Set((await q.query(`select fdr_id from documents where kind='FDR_DOCUMENT' and removed=false`)).rows.map((r: any) => r.fdr_id));
    const missing = (await q.query(`select * from fdrs where status in ('DRAFT','CORRECTION_REQUESTED')`)).rows.filter((f: any) => !withDoc.has(f.id));
    for (const f of missing)
      await n({ institutionId: f.institution_id, fdrId: f.id, type: 'MISSING_DOCUMENT', title: `FDR ${f.fdr_number}: document missing`, message: 'Upload the FDR document before (re)submitting.', dedupeKey: `miss:${f.id}:${f.status}` });
    return { created, moved };
  });
}
