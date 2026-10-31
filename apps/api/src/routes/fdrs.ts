import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import { z } from 'zod';
import { Actor, isStaff, requireRole } from '../auth';
import { audit, notify } from '../audit';
import { config } from '../config';
import { toCsv } from '../csv';
import { DB, Q, tx } from '../db';
import { DOC_KINDS, safeName, sniff } from '../files';
import { ACTIVE, STATUSES, DEDICATED, Status, allowedFor, doTransition } from '../lifecycle';
import { FDR_SELECT, computeFlags, loadFdr, mapDoc, mapFdr, visibility } from '../repo';
import { getBankAdapter } from '../verification';
import { HttpError, newId, nowIso } from '../util';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((d) => !isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, 'Invalid date');
export const fdrInput = z.object({
  aicteRef: z.string().trim().min(3).max(60), fdrNumber: z.string().trim().regex(/^[A-Za-z0-9\-\/]{3,40}$/, 'FDR number: 3-40 letters, digits, - or /'),
  bank: z.string().trim().min(2).max(80), branch: z.string().trim().min(2).max(80),
  amount: z.coerce.number().positive().max(100_000_000_000), issueDate: date, maturityDate: date, validityDate: date,
  beneficiary: z.string().trim().min(2).max(150), purpose: z.string().trim().min(3).max(300), remarks: z.string().trim().max(1000).optional().or(z.literal('')),
  replacesId: z.string().optional(),
}).refine((v) => v.maturityDate > v.issueDate, { path: ['maturityDate'], message: 'Maturity must be after issue date' })
  .refine((v) => v.validityDate >= v.issueDate, { path: ['validityDate'], message: 'Validity cannot be before issue date' });

const bankKey = (bank: string, no: string) => `${bank.trim().toLowerCase()}|${no.trim().toLowerCase()}`;
const EDITABLE = ['DRAFT', 'CORRECTION_REQUESTED'];
const SORTS: Record<string, string> = { createdAt: 'f.created_at', amount: 'f.amount', maturityDate: 'f.maturity_date', status: 'f.status', institution: 'i.name', bank: 'f.bank', fdrNumber: 'f.fdr_number', updatedAt: 'f.updated_at' };
const listQ = z.object({
  q: z.string().max(100).optional(), status: z.string().optional(), bank: z.string().optional(), institutionId: z.string().optional(),
  verification: z.string().optional(), minAmount: z.coerce.number().optional(), maxAmount: z.coerce.number().optional(),
  maturityFrom: date.optional(), maturityTo: date.optional(), createdFrom: date.optional(), createdTo: date.optional(),
  sort: z.string().default('createdAt'), dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
function listWhere(actor: Actor, raw: unknown) {
  const p = listQ.parse(raw); const params: any[] = []; const w = [visibility(actor, params)];
  const add = (sql: string, v: any) => { params.push(v); w.push(sql.replace('?', `$${params.length}`)); };
  if (p.q) { params.push(`%${p.q.toLowerCase()}%`); const n = params.length; w.push(`(lower(f.fdr_number) like $${n} or lower(f.aicte_ref) like $${n} or lower(f.bank) like $${n} or lower(i.name) like $${n})`); }
  if (p.status) { const ss = p.status.split(',').filter((s) => (STATUSES as readonly string[]).includes(s)); if (ss.length) w.push(`f.status in (${ss.map((s) => `'${s}'`).join(',')})`); }
  if (p.bank) add('lower(f.bank) = ?', p.bank.toLowerCase());
  if (p.institutionId && actor.role !== 'INSTITUTION_ADMIN') add('f.institution_id = ?', p.institutionId);
  if (p.verification) add('f.verification_status = ?', p.verification);
  if (p.minAmount !== undefined) add('f.amount >= ?', p.minAmount);
  if (p.maxAmount !== undefined) add('f.amount <= ?', p.maxAmount);
  if (p.maturityFrom) add('f.maturity_date >= ?', p.maturityFrom);
  if (p.maturityTo) add('f.maturity_date <= ?', p.maturityTo);
  if (p.createdFrom) add('f.created_at >= ?', p.createdFrom);
  if (p.createdTo) add('f.created_at <= ?', p.createdTo + 'T23:59:59.999Z');
  return { p, params, where: w.join(' and '), order: `${SORTS[p.sort] || SORTS.createdAt} ${p.dir}, f.id` };
}

export function fdrRoutes(db: DB) {
  const r = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });
  fs.mkdirSync(config.storageDir, { recursive: true });

  r.get('/fdrs', async (req, res) => {
    const { p, params, where, order } = listWhere(req.actor!, req.query);
    const total = Number((await db.query(`select count(*) as c from fdrs f join institutions i on i.id=f.institution_id where ${where}`, params)).rows[0].c);
    const rows = (await db.query(`${FDR_SELECT} where ${where} order by ${order} limit ${p.pageSize} offset ${(p.page - 1) * p.pageSize}`, params)).rows;
    res.json({ items: rows.map(mapFdr), total, page: p.page, pageSize: p.pageSize });
  });

  r.get('/fdrs/export.csv', requireRole('AICTE_OFFICER', 'SUPER_ADMIN', 'INSTITUTION_ADMIN'), async (req, res) => {
    const { params, where, order } = listWhere(req.actor!, req.query);
    const rows = (await db.query(`${FDR_SELECT} where ${where} order by ${order} limit 5000`, params)).rows.map(mapFdr);
    await audit(db, req.actor!, 'CSV_EXPORT', 'fdr', null, req.actor!.institutionId, { rows: rows.length, filters: req.query });
    const cols = [['institutionName', 'Institution'], ['aicteRef', 'AICTE Ref'], ['fdrNumber', 'FDR Number'], ['bank', 'Bank'], ['branch', 'Branch'], ['amount', 'Amount (INR)'],
      ['issueDate', 'Issue Date'], ['maturityDate', 'Maturity Date'], ['validityDate', 'Validity Date'], ['status', 'Status'], ['verificationStatus', 'Verification'], ['createdAt', 'Created']];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fdr-export.csv"');
    res.send(toCsv(rows as any, cols.map(([key, label]) => ({ key, label }))));
  });

  // ---- create (also used for renewal/replacement via replacesId)
  r.post('/fdrs', requireRole('INSTITUTION_ADMIN'), async (req, res) => {
    const b = fdrInput.parse(req.body); const a = req.actor!;
    const id = await tx(db, async (q) => {
      if (b.replacesId) {
        const o = (await q.query('select * from fdrs where id=$1 and institution_id=$2', [b.replacesId, a.institutionId])).rows[0];
        if (!o) throw new HttpError(404, 'Original FDR not found');
        if (!['APPROVED', 'RENEWAL_DUE', 'EXPIRED'].includes(o.status)) throw new HttpError(409, 'Only approved / renewal-due / expired FDRs can be renewed or replaced');
        const open = await q.query(`select 1 from fdrs where replaces_id=$1 and status not in ('REJECTED')`, [o.id]);
        if (open.rows.length) throw new HttpError(409, 'A replacement for this FDR already exists');
      }
      if ((await q.query('select 1 from fdrs where bank_key=$1', [bankKey(b.bank, b.fdrNumber)])).rows.length) throw new HttpError(409, 'This FDR number already exists for this bank');
      const id = newId(), t = nowIso();
      await q.query(`insert into fdrs(id,institution_id,aicte_ref,fdr_number,bank,branch,amount,issue_date,maturity_date,validity_date,beneficiary,purpose,remarks,status,replaces_id,created_by,created_at,updated_at,bank_key)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'DRAFT',$14,$15,$16,$16,$17)`,
        [id, a.institutionId, b.aicteRef, b.fdrNumber, b.bank, b.branch, b.amount, b.issueDate, b.maturityDate, b.validityDate, b.beneficiary, b.purpose, b.remarks || null, b.replacesId ?? null, a.id, t, bankKey(b.bank, b.fdrNumber)]);
      await q.query('insert into fdr_events(id,fdr_id,from_status,to_status,actor_id,actor_name,actor_role,remarks,at) values($1,$2,null,$3,$4,$5,$6,$7,$8)', [newId(), id, 'DRAFT', a.id, a.name, a.role, b.replacesId ? 'Renewal/replacement draft created' : 'Draft created', t]);
      await audit(q, a, b.replacesId ? 'FDR_RENEWAL_CREATED' : 'FDR_CREATED', 'fdr', id, a.institutionId, { fdrNumber: b.fdrNumber, replacesId: b.replacesId });
      return id;
    });
    res.status(201).json({ id });
  });

  r.put('/fdrs/:id', requireRole('INSTITUTION_ADMIN'), async (req, res) => {
    const f = await loadFdr(db, req.actor!, req.params.id);
    if (!EDITABLE.includes(f.status)) throw new HttpError(409, 'Only Draft or Correction Requested FDRs can be edited');
    const b = fdrInput.parse(req.body);
    const dup = await db.query('select id from fdrs where bank_key=$1 and id<>$2', [bankKey(b.bank, b.fdrNumber), f.id]);
    if (dup.rows.length) throw new HttpError(409, 'This FDR number already exists for this bank');
    await db.query(`update fdrs set aicte_ref=$1,fdr_number=$2,bank=$3,branch=$4,amount=$5,issue_date=$6,maturity_date=$7,validity_date=$8,beneficiary=$9,purpose=$10,remarks=$11,bank_key=$12,updated_at=$13,verification_status='NOT_VERIFIED',verified_amount=null,verified_maturity_date=null where id=$14`,
      [b.aicteRef, b.fdrNumber, b.bank, b.branch, b.amount, b.issueDate, b.maturityDate, b.validityDate, b.beneficiary, b.purpose, b.remarks || null, bankKey(b.bank, b.fdrNumber), nowIso(), f.id]);
    await audit(db, req.actor!, 'FDR_EDITED', 'fdr', f.id, f.institution_id, { before: { amount: f.amount, maturityDate: f.maturity_date }, after: { amount: b.amount, maturityDate: b.maturityDate } });
    res.json({ ok: true });
  });

  // ---- detail
  r.get('/fdrs/:id', async (req, res) => {
    const a = req.actor!; const f = await loadFdr(db, a, req.params.id);
    const docs = (await db.query('select * from documents where fdr_id=$1 and removed=false order by uploaded_at', [f.id])).rows;
    const obs = (await db.query('select * from observations where fdr_id=$1 order by created_at desc', [f.id])).rows;
    const events = (await db.query('select * from fdr_events where fdr_id=$1 order by at, id', [f.id])).rows;
    const ver = (await db.query('select * from verifications where fdr_id=$1 order by created_at desc', [f.id])).rows;
    const timeline = (await db.query('select at,actor_name,actor_role,action,details from audit_log where entity_id=$1 order by at desc limit 200', [f.id])).rows;
    const rel = (await db.query('select * from release_requests where fdr_id=$1 order by requested_at desc', [f.id])).rows;
    const repl = (await db.query('select id,fdr_number,status from fdrs where replaces_id=$1', [f.id])).rows[0] || null;
    const orig = f.replaces_id ? (await db.query('select id,fdr_number,status from fdrs where id=$1', [f.replaces_id])).rows[0] : null;
    const flags = await computeFlags(db, f, docs);
    const relOpen = rel.find((x: any) => ['PENDING', 'CLARIFICATION_REQUESTED'].includes(x.status));
    res.json({
      fdr: mapFdr(f),
      submittedData: { amount: f.amount, maturityDate: f.maturity_date, note: 'Declared by the institution — not independently verified' },
      verifiedData: { status: f.verification_status, amount: f.verified_amount, maturityDate: f.verified_maturity_date, latest: ver[0] || null },
      verifications: ver.map((v: any) => ({ id: v.id, outcome: v.outcome, source: v.source, reference: v.reference, remarks: v.remarks, verifiedAmount: v.verified_amount, verifiedMaturityDate: v.verified_maturity_date, verifiedOn: v.verified_on, verifier: v.verifier_name, method: v.method, createdAt: v.created_at })),
      documents: docs.map(mapDoc),
      observations: obs.map((o: any) => ({ id: o.id, kind: o.kind, severity: o.severity, text: o.text, author: o.author_name, resolved: o.resolved, createdAt: o.created_at })),
      events: events.map((e: any) => ({ from: e.from_status, to: e.to_status, by: e.actor_name, role: e.actor_role, remarks: e.remarks, at: e.at })),
      timeline: timeline.map((t: any) => ({ at: t.at, by: t.actor_name, role: t.actor_role, action: t.action, details: t.details ? JSON.parse(t.details) : null })),
      releases: rel.map((x: any) => ({ id: x.id, status: x.status, reason: x.reason, requestedAt: x.requested_at, officerNote: x.officer_note, institutionResponse: x.institution_response, decidedAt: x.decided_at, decisionRemarks: x.decision_remarks })),
      replacedBy: repl && { id: repl.id, fdrNumber: repl.fdr_number, status: repl.status }, replaces: orig && { id: orig.id, fdrNumber: orig.fdr_number, status: orig.status },
      flags,
      permissions: {
        canEdit: a.role === 'INSTITUTION_ADMIN' && EDITABLE.includes(f.status),
        transitions: allowedFor(f.status, a.role).filter((t) => !(a.role === 'INSTITUTION_ADMIN' && t === 'RELEASE_REQUESTED')),
        canVerify: ['AICTE_OFFICER', 'SUPER_ADMIN', 'BANK_VERIFIER'].includes(a.role) && f.status === 'VERIFICATION_PENDING',
        canRenew: a.role === 'INSTITUTION_ADMIN' && ['APPROVED', 'RENEWAL_DUE', 'EXPIRED'].includes(f.status) && !repl,
        canRequestRelease: a.role === 'INSTITUTION_ADMIN' && ['APPROVED', 'RENEWAL_DUE', 'EXPIRED', 'RENEWED'].includes(f.status) && !relOpen,
        canObserve: isStaff(a.role) && !['DRAFT', 'RELEASED', 'REJECTED'].includes(f.status),
        canUpload: a.role === 'INSTITUTION_ADMIN' && (EDITABLE.includes(f.status) || ['APPROVED', 'RENEWAL_DUE', 'EXPIRED', 'RENEWED', 'RELEASE_REQUESTED'].includes(f.status)),
        editableDocs: a.role === 'INSTITUTION_ADMIN' && EDITABLE.includes(f.status),
      },
    });
  });

  // ---- generic transition (dedicated moves are blocked here)
  r.post('/fdrs/:id/transition', async (req, res) => {
    const b = z.object({ to: z.enum(STATUSES), remarks: z.string().trim().max(1000).optional() }).parse(req.body); const a = req.actor!;
    if (DEDICATED.has(b.to)) throw new HttpError(400, 'This status change must use its dedicated workflow (verification / release / renewal)');
    await tx(db, async (q) => {
      const f = await loadFdr(q, a, req.params.id);
      if (b.to === 'SUBMITTED') {
        const d = await q.query(`select 1 from documents where fdr_id=$1 and kind='FDR_DOCUMENT' and removed=false`, [f.id]);
        if (!d.rows.length) throw new HttpError(422, 'Upload the FDR document before submitting');
        await q.query('update observations set resolved=true where fdr_id=$1', [f.id]);
      }
      if (b.to === 'APPROVED' && f.status === 'VERIFIED' && f.verification_status !== 'VERIFIED') throw new HttpError(409, 'Approval requires a recorded verification');
      await doTransition(q, f, b.to as Status, a, b.remarks);
    });
    res.json({ ok: true });
  });

  // ---- documents (private storage; download only through authorised endpoint)
  r.post('/fdrs/:id/documents', requireRole('INSTITUTION_ADMIN'), upload.single('file'), async (req, res) => {
    const a = req.actor!; const f = await loadFdr(db, a, req.params.id);
    const kind = z.enum(DOC_KINDS).parse(req.body.kind);
    const releaseStage = ['APPROVED', 'RENEWAL_DUE', 'EXPIRED', 'RENEWED', 'RELEASE_REQUESTED'].includes(f.status);
    if (!(EDITABLE.includes(f.status) || (releaseStage && ['RELEASE_SUPPORT', 'SUPPORTING'].includes(kind)))) throw new HttpError(409, 'Documents cannot be added in the current status');
    if (!req.file) throw new HttpError(400, 'No file received');
    const type = sniff(req.file.buffer);
    if (!type) throw new HttpError(415, 'Only PDF, PNG or JPEG files are accepted (content check failed)');
    const ext = path.extname(req.file.originalname).toLowerCase();
    const okExt: Record<string, string[]> = { 'application/pdf': ['.pdf'], 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'] };
    if (!okExt[type.mime].includes(ext)) throw new HttpError(415, 'File extension does not match file content');
    const id = newId(), storage = `${id}.bin`;
    fs.writeFileSync(path.join(config.storageDir, storage), req.file.buffer, { mode: 0o600 });
    const sha = createHash('sha256').update(req.file.buffer).digest('hex');
    await db.query('insert into documents(id,fdr_id,kind,original_name,mime,size,sha256,storage_name,uploaded_by,uploaded_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, f.id, kind, safeName(req.file.originalname), type.mime, req.file.size, sha, storage, a.name, nowIso()]);
    await audit(db, a, 'DOCUMENT_UPLOADED', 'fdr', f.id, f.institution_id, { kind, name: safeName(req.file.originalname), sha256: sha });
    res.status(201).json({ id });
  });
  r.get('/documents/:id/download', async (req, res) => {
    const d = (await db.query('select * from documents where id=$1 and removed=false', [req.params.id])).rows[0];
    if (!d) throw new HttpError(404, 'Document not found');
    await loadFdr(db, req.actor!, d.fdr_id); // enforces the same access rule as the FDR itself
    await audit(db, req.actor!, 'DOCUMENT_DOWNLOADED', 'fdr', d.fdr_id, null, { documentId: d.id });
    res.setHeader('Content-Type', d.mime); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${d.original_name}"`);
    res.sendFile(path.resolve(config.storageDir, d.storage_name));
  });
  r.delete('/documents/:id', requireRole('INSTITUTION_ADMIN'), async (req, res) => {
    const d = (await db.query('select * from documents where id=$1 and removed=false', [req.params.id])).rows[0];
    if (!d) throw new HttpError(404, 'Document not found');
    const f = await loadFdr(db, req.actor!, d.fdr_id);
    if (!EDITABLE.includes(f.status)) throw new HttpError(409, 'Documents cannot be removed in the current status');
    await db.query('update documents set removed=true where id=$1', [d.id]);
    await audit(db, req.actor!, 'DOCUMENT_REMOVED', 'fdr', f.id, f.institution_id, { name: d.original_name });
    res.json({ ok: true });
  });

  // ---- scrutiny observations / correction requests
  r.post('/fdrs/:id/observations', requireRole('AICTE_OFFICER', 'SUPER_ADMIN'), async (req, res) => {
    const b = z.object({ kind: z.enum(['OBSERVATION', 'CORRECTION_REQUEST', 'FLAG']), severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'), text: z.string().trim().min(3).max(1500) }).parse(req.body);
    const a = req.actor!;
    await tx(db, async (q) => {
      const f = await loadFdr(q, a, req.params.id);
      if (['DRAFT', 'RELEASED', 'REJECTED'].includes(f.status)) throw new HttpError(409, 'Observations cannot be added in this status');
      await q.query('insert into observations(id,fdr_id,kind,severity,text,author_id,author_name,created_at) values($1,$2,$3,$4,$5,$6,$7,$8)', [newId(), f.id, b.kind, b.severity, b.text, a.id, a.name, nowIso()]);
      await audit(q, a, 'OBSERVATION_ADDED', 'fdr', f.id, f.institution_id, { kind: b.kind, severity: b.severity });
      if (b.kind === 'CORRECTION_REQUEST') await doTransition(q, f, 'CORRECTION_REQUESTED', a, b.text);
      else await notify(q, { institutionId: f.institution_id, fdrId: f.id, type: 'OBSERVATION', title: `New scrutiny observation on ${f.fdr_number}`, message: b.text.slice(0, 160) });
    });
    res.status(201).json({ ok: true });
  });

  // ---- verification (manual, authorised). No bank connectivity is claimed.
  r.get('/verification/adapter', (_req, res) => { const ad = getBankAdapter(); res.json({ name: ad.name, configured: ad.configured, mode: 'MANUAL', note: 'No bank API is connected. Verification is recorded manually by an authorised verifier.' }); });
  r.post('/fdrs/:id/verification', requireRole('AICTE_OFFICER', 'SUPER_ADMIN', 'BANK_VERIFIER'), async (req, res) => {
    const b = z.object({
      outcome: z.enum(['VERIFIED', 'DISCREPANCY']), source: z.enum(['BANK_LETTER', 'BANK_BRANCH_CONFIRMATION', 'BANK_PORTAL_MANUAL', 'OTHER']),
      reference: z.string().trim().min(3).max(80), remarks: z.string().trim().max(1000).optional(), verifiedAmount: z.coerce.number().positive(), verifiedMaturityDate: date, verifiedOn: date,
    }).parse(req.body); const a = req.actor!;
    await tx(db, async (q) => {
      const f = await loadFdr(q, a, req.params.id);
      if (f.status !== 'VERIFICATION_PENDING') throw new HttpError(409, 'FDR is not awaiting verification');
      const match = Number(b.verifiedAmount) === Number(f.amount) && b.verifiedMaturityDate === f.maturity_date;
      if (b.outcome === 'VERIFIED' && !match) throw new HttpError(422, 'Verified values differ from the submitted FDR. Record the outcome as DISCREPANCY.');
      if (b.outcome === 'DISCREPANCY' && !(b.remarks && b.remarks.length >= 3)) throw new HttpError(400, 'Remarks are required when recording a discrepancy');
      await q.query('insert into verifications(id,fdr_id,outcome,source,reference,remarks,verified_amount,verified_maturity_date,verified_on,verifier_id,verifier_name,method,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [newId(), f.id, b.outcome, b.source, b.reference, b.remarks ?? null, b.verifiedAmount, b.verifiedMaturityDate, b.verifiedOn, a.id, a.name, 'MANUAL', nowIso()]);
      await q.query('update fdrs set verification_status=$1, verified_amount=$2, verified_maturity_date=$3 where id=$4', [b.outcome === 'VERIFIED' ? 'VERIFIED' : 'DISCREPANCY', b.verifiedAmount, b.verifiedMaturityDate, f.id]);
      await audit(q, a, 'VERIFICATION_RECORDED', 'fdr', f.id, f.institution_id, { outcome: b.outcome, source: b.source, reference: b.reference });
      await doTransition(q, f, b.outcome === 'VERIFIED' ? 'VERIFIED' : 'DISCREPANCY_FOUND', a, b.remarks || `Verified via ${b.source} (${b.reference})`);
      if (b.outcome === 'DISCREPANCY') {
        await notify(q, { institutionId: f.institution_id, staff: true, fdrId: f.id, type: 'DISCREPANCY', title: `Discrepancy found on ${f.fdr_number}`, message: b.remarks! });
      }
    });
    res.status(201).json({ ok: true });
  });
  r.post('/fdrs/:id/verification/bank-api', requireRole('AICTE_OFFICER', 'SUPER_ADMIN'), (_req, res) => {
    const ad = getBankAdapter();
    if (!ad.configured) throw new HttpError(501, 'No bank API integration is configured. Use manual verification.');
    throw new HttpError(501, 'Bank API verification is not enabled in this build.');
  });
  return r;
}
export type { Q };
export const ACTIVE_STATUSES = ACTIVE;
