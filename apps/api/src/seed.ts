// Synthetic demo data only. Wipes and recreates demo tables. Refuses to run in production.
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { config } from './config';
import { DB, applySchema, makePool } from './db';
import { addDays, newId, today } from './util';

const PW = 'Demo@12345';
const STUB_PDF = (t: string) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 70>>stream\nBT /F1 10 Tf 10 50 Td (SYNTHETIC DEMO DOCUMENT - ${t}) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
const PATH: Record<string, string[]> = {
  DRAFT: ['DRAFT'], SUBMITTED: ['DRAFT', 'SUBMITTED'], UNDER_SCRUTINY: ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY'],
  CORRECTION_REQUESTED: ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'CORRECTION_REQUESTED'],
  VERIFICATION_PENDING: ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'VERIFICATION_PENDING'],
  DISCREPANCY_FOUND: ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'VERIFICATION_PENDING', 'DISCREPANCY_FOUND'],
  VERIFIED: ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'VERIFICATION_PENDING', 'VERIFIED'],
  APPROVED: ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'VERIFICATION_PENDING', 'VERIFIED', 'APPROVED'],
  RENEWAL_DUE: ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'VERIFICATION_PENDING', 'VERIFIED', 'APPROVED', 'RENEWAL_DUE'],
  EXPIRED: ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'VERIFICATION_PENDING', 'VERIFIED', 'APPROVED', 'EXPIRED'],
  RELEASE_REQUESTED: ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'VERIFICATION_PENDING', 'VERIFIED', 'APPROVED', 'RELEASE_REQUESTED'],
  REJECTED: ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'REJECTED'],
};
const ACTOR: Record<string, [string, string]> = { DRAFT: ['inst', 'INSTITUTION_ADMIN'], SUBMITTED: ['inst', 'INSTITUTION_ADMIN'], VERIFIED: ['bank', 'BANK_VERIFIER'], DISCREPANCY_FOUND: ['bank', 'BANK_VERIFIER'], RELEASE_REQUESTED: ['inst', 'INSTITUTION_ADMIN'] };

export async function seed(db: DB) {
  if (config.prod) throw new Error('Refusing to seed in production');
  await applySchema(db);
  for (const t of ['notification_reads', 'notifications', 'release_requests', 'verifications', 'observations', 'documents', 'fdr_events', 'audit_log', 'fdrs', 'settings', 'users', 'institutions']) await db.query(`delete from ${t}`);
  fs.mkdirSync(config.storageDir, { recursive: true });
  const now = new Date().toISOString(); const hash = await bcrypt.hash(PW, 11);
  const inst = [['i1', 'Demo Institute of Technology', 'DEMO-1-1001', 'Indore', 'Madhya Pradesh'], ['i2', 'Sample College of Engineering', 'DEMO-1-1002', 'Pune', 'Maharashtra']];
  for (const [id, n, a, c, s] of inst) await db.query('insert into institutions(id,name,aicte_id,city,state,contact_email,created_at) values($1,$2,$3,$4,$5,$6,$7)', [id, n, a, c, s, `contact@${id}.demo.local`, now]);
  const users = [['u-admin', 'admin@demo.local', 'Demo Super Admin', 'SUPER_ADMIN', null], ['u-off', 'officer@demo.local', 'Demo Scrutiny Officer', 'AICTE_OFFICER', null], ['u-bank', 'bank@demo.local', 'Demo Bank Verifier', 'BANK_VERIFIER', null],
    ['u-i1', 'inst1@demo.local', 'Institute 1 Admin', 'INSTITUTION_ADMIN', 'i1'], ['u-i2', 'inst2@demo.local', 'Institute 2 Admin', 'INSTITUTION_ADMIN', 'i2']];
  for (const [id, e, n, r, i] of users) await db.query('insert into users(id,email,name,password_hash,role,institution_id,created_at) values($1,$2,$3,$4,$5,$6,$7)', [id, e, n, hash, r, i, now]);
  const name = (k: string) => (k === 'inst' ? 'Institute Admin' : k === 'bank' ? 'Demo Bank Verifier' : 'Demo Scrutiny Officer');
  const banks = ['State Bank of India', 'Punjab National Bank', 'Canara Bank', 'HDFC Bank', 'Bank of Baroda'];
  // [institution, status, amount, maturity offset (days from today), note]
  const specs: [string, string, number, number, string?][] = [
    ['i1', 'APPROVED', 5000000, 200], ['i1', 'APPROVED', 2500000, 18], ['i1', 'RENEWAL_DUE', 1000000, 9], ['i1', 'EXPIRED', 750000, -25], ['i1', 'DRAFT', 3000000, 365],
    ['i1', 'CORRECTION_REQUESTED', 1500000, 300], ['i1', 'RELEASE_REQUESTED', 2000000, 60], ['i1', 'UNDER_SCRUTINY', 4000000, 400],
    ['i2', 'APPROVED', 10000000, 120], ['i2', 'APPROVED', 800000, 45], ['i2', 'VERIFICATION_PENDING', 2200000, 330], ['i2', 'DISCREPANCY_FOUND', 1200000, 280],
    ['i2', 'SUBMITTED', 600000, 500], ['i2', 'REJECTED', 900000, 200], ['i2', 'VERIFIED', 3500000, 250], ['i2', 'EXPIRED', 500000, -70],
  ];
  let n = 0;
  for (const [iid, status, amount, mat] of specs) {
    n++; const id = newId(); const bank = banks[n % banks.length]; const fdrNo = `DEMO-FDR-${String(1000 + n)}`;
    const maturity = addDays(today(), mat), issue = addDays(maturity, -365), created = new Date(Date.now() - (30 + n) * 86400000);
    const verified = ['VERIFIED', 'APPROVED', 'RENEWAL_DUE', 'EXPIRED', 'RELEASE_REQUESTED'].includes(status);
    const disc = status === 'DISCREPANCY_FOUND';
    await db.query(`insert into fdrs(id,institution_id,aicte_ref,fdr_number,bank,branch,amount,issue_date,maturity_date,validity_date,beneficiary,purpose,remarks,status,verification_status,verified_amount,verified_maturity_date,created_by,created_at,updated_at,submitted_at,bank_key)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19,$20,$21)`,
      [id, iid, `DEMO/AICTE/2026/${100 + n}`, fdrNo, bank, `${bank.split(' ')[0]} Main Branch`, amount, issue, maturity, addDays(maturity, 30), 'AICTE (demo)', 'Security deposit for approval of intake', null, status,
        verified ? 'VERIFIED' : disc ? 'DISCREPANCY' : 'NOT_VERIFIED', verified ? amount : disc ? amount - 100000 : null, verified ? maturity : disc ? maturity : null,
        iid === 'i1' ? 'u-i1' : 'u-i2', created.toISOString(), status === 'DRAFT' ? null : created.toISOString(), `${bank.toLowerCase()}|${fdrNo.toLowerCase()}`]);
    const steps = PATH[status]; let prev: string | null = null;
    for (let k = 0; k < steps.length; k++) {
      const [who, role] = ACTOR[steps[k]] || ['off', 'AICTE_OFFICER'];
      await db.query('insert into fdr_events(id,fdr_id,from_status,to_status,actor_id,actor_name,actor_role,remarks,at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [newId(), id, prev, steps[k], who, name(who), role, steps[k] === 'CORRECTION_REQUESTED' ? 'Bank confirmation letter is not legible' : steps[k] === 'REJECTED' ? 'Instrument does not match AICTE reference' : null, new Date(created.getTime() + k * 86400000).toISOString()]);
      await db.query('insert into audit_log(id,at,actor_id,actor_name,actor_role,action,entity,entity_id,institution_id,details) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [newId(), new Date(created.getTime() + k * 86400000).toISOString(), who, name(who), role, k === 0 ? 'FDR_CREATED' : 'FDR_STATUS_CHANGED', 'fdr', id, iid, JSON.stringify({ from: prev, to: steps[k] })]);
      prev = steps[k];
    }
    if (status !== 'DRAFT' || n % 2) for (const kind of status === 'DRAFT' ? ['FDR_DOCUMENT'] : ['FDR_DOCUMENT', 'BANK_CONFIRMATION']) {
      if (kind === 'BANK_CONFIRMATION' && status === 'CORRECTION_REQUESTED') continue;
      const did = newId(), buf = STUB_PDF(`${fdrNo} ${kind}`); fs.writeFileSync(path.join(config.storageDir, `${did}.bin`), buf, { mode: 0o600 });
      await db.query('insert into documents(id,fdr_id,kind,original_name,mime,size,sha256,storage_name,uploaded_by,uploaded_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [did, id, kind, `${fdrNo}-${kind.toLowerCase()}.pdf`, 'application/pdf', buf.length, require('crypto').createHash('sha256').update(buf).digest('hex'), `${did}.bin`, 'Institute Admin', created.toISOString()]);
    }
    if (verified || disc) await db.query('insert into verifications(id,fdr_id,outcome,source,reference,remarks,verified_amount,verified_maturity_date,verified_on,verifier_id,verifier_name,method,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [newId(), id, disc ? 'DISCREPANCY' : 'VERIFIED', 'BANK_LETTER', `DEMO-BANK-REF-${n}`, disc ? 'Bank letter shows a lower principal than declared' : null, disc ? amount - 100000 : amount, maturity, today(), 'u-bank', 'Demo Bank Verifier', 'MANUAL', created.toISOString()]);
    if (status === 'CORRECTION_REQUESTED') await db.query('insert into observations(id,fdr_id,kind,severity,text,author_id,author_name,created_at) values($1,$2,$3,$4,$5,$6,$7,$8)', [newId(), id, 'CORRECTION_REQUEST', 'MEDIUM', 'Bank confirmation letter is not legible. Please upload a clear copy.', 'u-off', 'Demo Scrutiny Officer', created.toISOString()]);
    if (status === 'RELEASE_REQUESTED') await db.query('insert into release_requests(id,fdr_id,institution_id,reason,status,prev_status,requested_by,requested_at) values($1,$2,$3,$4,$5,$6,$7,$8)', [newId(), id, iid, 'Programme closure approved; requesting discharge of the security deposit.', 'PENDING', 'APPROVED', 'u-i1', now]);
  }
  await db.query('insert into settings(key,value) values($1,$2)', ['reminderDays', '[30,15,7,1]']); await db.query('insert into settings(key,value) values($1,$2)', ['scrutinySlaDays', '7']);
  return specs.length;
}
if (require.main === module) seed(makePool(config.databaseUrl)).then((n) => { console.log(`Seeded ${n} demo FDRs. Password for all demo users: ${PW}`); process.exit(0); }).catch((e) => { console.error(e.message); process.exit(1); });
