import fs from 'fs';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import bcrypt from 'bcryptjs';
import { newDb } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fdr-'));
process.env.JWT_SECRET = 'test-secret';

let base = '';
let server: any; let db: any;
const jar: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: any, form?: FormData) {
  const headers: any = { 'x-requested-with': 'fdr-web' };
  if (jar[who]) headers.cookie = jar[who];
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const sc = res.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
}
const pdf = () => { const f = new FormData(); f.append('kind', 'FDR_DOCUMENT'); f.append('file', new Blob([Buffer.from('%PDF-1.4\n%demo\n')], { type: 'application/pdf' }), 'fdr.pdf'); return f; };
const t = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const fdr = (over: any = {}) => ({ aicteRef: 'AICTE/2026/001', fdrNumber: 'FDR-1001', bank: 'State Bank', branch: 'Main', amount: 1000000, issueDate: t(-300), maturityDate: t(20), validityDate: t(40), beneficiary: 'AICTE', purpose: 'Approval security deposit', ...over });

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  const { applySchema } = await import('../src/db');
  const mem = newDb(); const { Pool } = mem.adapters.createPg(); db = new Pool();
  await applySchema(db);
  const h = await bcrypt.hash('Demo@12345', 4);
  for (const [id, email, role] of [['o1', 'officer@t.local', 'AICTE_OFFICER'], ['b1', 'bank@t.local', 'BANK_VERIFIER'], ['s1', 'admin@t.local', 'SUPER_ADMIN']])
    await db.query('insert into users(id,email,name,password_hash,role,created_at) values($1,$2,$3,$4,$5,$6)', [id, email, id, h, role, new Date().toISOString()]);
  server = createApp(db, { authLimit: 1000 }).listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

describe('FDR lifecycle end to end', () => {
  let id = '', newId = '', rel = '';
  const reg = (n: string, aicte: string) => call(n, 'POST', '/api/auth/register', { name: n, email: `${n}@t.local`, password: 'Demo@12345', role: 'INSTITUTION_ADMIN', institutionName: `${n} Institute`, aicteId: aicte });

  it('1. institution registers (only institution role allowed) and submits an FDR', async () => {
    expect((await call('x', 'POST', '/api/auth/register', { name: 'Evil', email: 'e@t.local', password: 'Demo@12345', role: 'SUPER_ADMIN', institutionName: 'Evil Inst', aicteId: 'EVIL-1' })).status).toBe(403);
    expect((await reg('inst1', '1-1001')).status).toBe(201);
    expect((await reg('inst2', '1-1002')).status).toBe(201);
    const c = await call('inst1', 'POST', '/api/fdrs', fdr()); expect(c.status).toBe(201); id = c.body.id;
    expect((await call('inst1', 'POST', `/api/fdrs/${id}/transition`, { to: 'SUBMITTED' })).status).toBe(422); // no document yet
    expect((await call('inst1', 'POST', `/api/fdrs/${id}/documents`, undefined, pdf())).status).toBe(201);
    expect((await call('inst1', 'POST', `/api/fdrs/${id}/transition`, { to: 'SUBMITTED' })).status).toBe(200);
  });
  it('rejects bad uploads (fake pdf) and duplicate FDR numbers', async () => {
    const d = (await call('inst1', 'POST', '/api/fdrs', fdr({ fdrNumber: 'FDR-2002' }))).body.id;
    const f = new FormData(); f.append('kind', 'FDR_DOCUMENT'); f.append('file', new Blob(['MZ not a pdf']), 'x.pdf');
    expect((await call('inst1', 'POST', `/api/fdrs/${d}/documents`, undefined, f)).status).toBe(415);
    expect((await call('inst1', 'POST', '/api/fdrs', fdr())).status).toBe(409);
  });
  it('2. officer requests correction (remarks mandatory); 3. institution fixes and resubmits', async () => {
    expect((await call('officer', 'POST', '/api/auth/login', { email: 'officer@t.local', password: 'Demo@12345' })).status).toBe(200);
    expect((await call('officer', 'POST', `/api/fdrs/${id}/transition`, { to: 'UNDER_SCRUTINY' })).status).toBe(200);
    expect((await call('officer', 'POST', `/api/fdrs/${id}/transition`, { to: 'APPROVED' })).status).toBe(409); // invalid transition
    expect((await call('officer', 'POST', `/api/fdrs/${id}/observations`, { kind: 'CORRECTION_REQUEST', text: 'Bank confirmation missing' })).status).toBe(201);
    const bc = new FormData(); bc.append('kind', 'BANK_CONFIRMATION'); bc.append('file', new Blob([Buffer.from('%PDF-1.4\n')]), 'bank.pdf');
    expect((await call('inst1', 'POST', `/api/fdrs/${id}/documents`, undefined, bc)).status).toBe(201);
    expect((await call('inst1', 'POST', `/api/fdrs/${id}/transition`, { to: 'SUBMITTED' })).status).toBe(200);
  });
  it('4. verification: mismatch cannot be marked verified; discrepancy then verified', async () => {
    await call('officer', 'POST', `/api/fdrs/${id}/transition`, { to: 'UNDER_SCRUTINY' });
    await call('officer', 'POST', `/api/fdrs/${id}/transition`, { to: 'VERIFICATION_PENDING' });
    await call('bank', 'POST', '/api/auth/login', { email: 'bank@t.local', password: 'Demo@12345' });
    const v = { source: 'BANK_LETTER', reference: 'REF-1', verifiedOn: t(0), verifiedMaturityDate: t(20), verifiedAmount: 900000 };
    expect((await call('bank', 'POST', `/api/fdrs/${id}/verification`, { ...v, outcome: 'VERIFIED' })).status).toBe(422);
    expect((await call('bank', 'POST', `/api/fdrs/${id}/verification`, { ...v, outcome: 'DISCREPANCY', remarks: 'Amount differs' })).status).toBe(201);
    const d = await call('officer', 'GET', `/api/fdrs/${id}`);
    expect(d.body.flags.map((f: any) => f.code)).toContain('AMOUNT_MISMATCH');
    expect(d.body.verifiedData.amount).toBe(900000); expect(d.body.submittedData.amount).toBe(1000000); // submitted vs verified kept apart
    await call('officer', 'POST', `/api/fdrs/${id}/transition`, { to: 'VERIFICATION_PENDING' });
    expect((await call('bank', 'POST', `/api/fdrs/${id}/verification`, { ...v, verifiedAmount: 1000000, outcome: 'VERIFIED' })).status).toBe(201);
    expect((await call('officer', 'POST', `/api/fdrs/${id}/transition`, { to: 'APPROVED', remarks: 'ok' })).status).toBe(200);
  });
  it('5. dashboard shows upcoming maturity; alert scan moves FDR to renewal due and is idempotent', async () => {
    const d = await call('officer', 'GET', '/api/dashboard'); expect(d.body.kpis.upcomingMaturities).toBe(1); expect(d.body.kpis.totalSecuredAmount).toBe(1000000);
    const s1 = await call('officer', 'POST', '/api/alerts/scan'); expect(s1.body.moved).toBe(1); expect(s1.body.created).toBeGreaterThan(0);
    const s2 = await call('officer', 'POST', '/api/alerts/scan'); expect(s2.body.created).toBe(0);
    expect((await call('inst1', 'GET', `/api/fdrs/${id}`)).body.fdr.status).toBe('RENEWAL_DUE');
    const n = await call('inst1', 'GET', '/api/notifications'); expect(n.body.items.length).toBeGreaterThan(0); expect(n.body.externalDelivery).toMatch(/not configured/i);
  });
  it('6. renewal linked to the original; approving it marks the original RENEWED', async () => {
    const c = await call('inst1', 'POST', '/api/fdrs', fdr({ fdrNumber: 'FDR-1001-R', maturityDate: t(400), validityDate: t(420), replacesId: id })); expect(c.status).toBe(201); newId = c.body.id;
    expect((await call('inst1', 'POST', '/api/fdrs', fdr({ fdrNumber: 'FDR-1001-R2', replacesId: id }))).status).toBe(409);
    await call('inst1', 'POST', `/api/fdrs/${newId}/documents`, undefined, pdf());
    await call('inst1', 'POST', `/api/fdrs/${newId}/transition`, { to: 'SUBMITTED' });
    for (const to of ['UNDER_SCRUTINY', 'VERIFICATION_PENDING']) await call('officer', 'POST', `/api/fdrs/${newId}/transition`, { to });
    await call('bank', 'POST', `/api/fdrs/${newId}/verification`, { outcome: 'VERIFIED', source: 'BANK_LETTER', reference: 'REF-2', verifiedOn: t(0), verifiedAmount: 1000000, verifiedMaturityDate: t(400) });
    await call('officer', 'POST', `/api/fdrs/${newId}/transition`, { to: 'APPROVED' });
    const o = await call('inst1', 'GET', `/api/fdrs/${id}`); expect(o.body.fdr.status).toBe('RENEWED'); expect(o.body.replacedBy.fdrNumber).toBe('FDR-1001-R');
  });
  it('7. release request: clarification, response, approval with remarks', async () => {
    expect((await call('inst1', 'POST', `/api/fdrs/${id}/release`, { reason: 'short' })).status).toBe(400);
    const r = await call('inst1', 'POST', `/api/fdrs/${id}/release`, { reason: 'Institution closed its programme' }); expect(r.status).toBe(201); rel = r.body.id;
    expect((await call('inst1', 'POST', `/api/releases/${rel}/decision`, { action: 'APPROVE', remarks: 'self' })).status).toBe(403);
    expect((await call('officer', 'POST', `/api/releases/${rel}/decision`, { action: 'APPROVE' })).status).toBe(400);
    expect((await call('officer', 'POST', `/api/releases/${rel}/decision`, { action: 'CLARIFY', remarks: 'Attach closure letter' })).status).toBe(200);
    expect((await call('inst1', 'POST', `/api/releases/${rel}/respond`, { message: 'Attached to file' })).status).toBe(200);
    expect((await call('officer', 'POST', `/api/releases/${rel}/decision`, { action: 'APPROVE', remarks: 'Compliance cleared' })).status).toBe(200);
    expect((await call('inst1', 'GET', `/api/fdrs/${id}`)).body.fdr.status).toBe('RELEASED');
  });
  it('8. users cannot reach another institution\'s records or documents; bank verifier is limited', async () => {
    expect((await call('inst2', 'GET', `/api/fdrs/${id}`)).status).toBe(404);
    const docs = (await call('inst1', 'GET', `/api/fdrs/${id}`)).body.documents;
    expect((await call('inst2', 'GET', `/api/documents/${docs[0].id}/download`)).status).toBe(404);
    expect((await call('inst1', 'GET', `/api/documents/${docs[0].id}/download`)).status).toBe(200);
    expect((await call('inst2', 'GET', '/api/fdrs')).body.total).toBe(0);
    expect((await call('inst2', 'GET', '/api/audit')).status).toBe(403);
    expect((await call('inst2', 'POST', `/api/fdrs/${id}/observations`, { kind: 'OBSERVATION', text: 'hack' })).status).toBe(403);
    expect((await call('bank', 'GET', '/api/releases')).status).toBe(403);
    expect((await call('bank', 'POST', '/api/admin/users', {})).status).toBe(403);
    expect((await call('anon', 'GET', '/api/fdrs')).status).toBe(401);
    const noHeader = await fetch(base + '/api/auth/logout', { method: 'POST' }); expect(noHeader.status).toBe(403); // CSRF header required
  });
  it('9. search, filters, sort, pagination, CSV export, audit log, status history', async () => {
    const s = await call('officer', 'GET', '/api/fdrs?q=inst1&status=RELEASED,APPROVED&sort=amount&dir=asc&pageSize=1&page=1');
    expect(s.body.total).toBe(2); expect(s.body.items.length).toBe(1);
    expect((await call('officer', 'GET', '/api/fdrs?bank=state bank&minAmount=2000000')).body.total).toBe(0);
    const csv = await call('officer', 'GET', '/api/fdrs/export.csv?status=RELEASED'); expect(csv.status).toBe(200); expect(csv.body).toContain('FDR-1001'); expect(csv.body.split('\r\n').length).toBe(2);
    const det = (await call('officer', 'GET', `/api/fdrs/${id}`)).body;
    expect(det.events.map((e: any) => e.to)).toEqual(expect.arrayContaining(['DRAFT', 'SUBMITTED', 'CORRECTION_REQUESTED', 'VERIFIED', 'APPROVED', 'RENEWAL_DUE', 'RENEWED', 'RELEASE_REQUESTED', 'RELEASED']));
    expect(det.timeline.length).toBeGreaterThan(10);
    const a = await call('officer', 'GET', '/api/audit?action=CSV_EXPORT'); expect(a.body.total).toBeGreaterThan(0);
  });
});
