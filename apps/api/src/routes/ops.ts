import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { isStaff, requireRole } from '../auth';
import { audit, notify } from '../audit';
import { getSettings, runAlertScan, saveSettings } from '../alerts';
import { DB, tx } from '../db';
import { ACTIVE, SECURED, doTransition } from '../lifecycle';
import { FDR_SELECT, loadFdr, mapFdr, visibility } from '../repo';
import { HttpError, newId, nowIso } from '../util';
import { passwordRule } from './auth';

const FIN = ['APPROVED', 'RENEWAL_DUE', 'EXPIRED', 'RENEWED'];

export function opsRoutes(db: DB) {
  const r = Router();

  // ---------- dashboard (scoped by role)
  r.get('/dashboard', async (req, res) => {
    const a = req.actor!; const params: any[] = [];
    const rows = (await db.query(`${FDR_SELECT} where ${visibility(a, params)}`, params)).rows.map(mapFdr);
    const sum = (xs: any[]) => xs.reduce((s, x) => s + Number(x.amount), 0);
    const count = (...st: string[]) => rows.filter((x) => st.includes(x.status)).length;
    const secured = rows.filter((x) => (SECURED as string[]).includes(x.status));
    const monitored = rows.filter((x) => (ACTIVE as string[]).includes(x.status));
    const group = (key: (x: any) => string, list = rows) => { const m = new Map<string, { name: string; count: number; amount: number }>(); for (const x of list) { const k = key(x); const g = m.get(k) || { name: k, count: 0, amount: 0 }; g.count++; g.amount += Number(x.amount); m.set(k, g); } return [...m.values()].sort((p, q) => q.amount - p.amount); };
    const mb: Record<string, number> = { 'Overdue': 0, '0-30 days': 0, '31-60 days': 0, '61-90 days': 0, '90+ days': 0 };
    for (const x of monitored) { const d = x.daysToMaturity; mb[d < 0 ? 'Overdue' : d <= 30 ? '0-30 days' : d <= 60 ? '31-60 days' : d <= 90 ? '61-90 days' : '90+ days']++; }
    const L = 100000, C = 10000000; const ab: Record<string, number> = { '< ₹10 L': 0, '₹10-50 L': 0, '₹50 L-1 Cr': 0, '> ₹1 Cr': 0 };
    for (const x of rows) ab[x.amount < 10 * L ? '< ₹10 L' : x.amount < 50 * L ? '₹10-50 L' : x.amount < C ? '₹50 L-1 Cr' : '> ₹1 Cr']++;
    const ap: any[] = []; const wh = a.role === 'INSTITUTION_ADMIN' ? (ap.push(a.institutionId), 'where institution_id=$1') : isStaff(a.role) ? '' : `where actor_role='BANK_VERIFIER' and actor_id='${a.id.replace(/'/g, '')}'`;
    const recent = (await db.query(`select at,actor_name,actor_role,action,entity_id,details from audit_log ${wh} order by at desc limit 8`, ap)).rows;
    res.json({
      kpis: { totalFdrs: rows.length, totalSecuredAmount: sum(secured), pendingScrutiny: count('SUBMITTED', 'UNDER_SCRUTINY'), verificationPending: count('VERIFICATION_PENDING'), discrepancies: count('DISCREPANCY_FOUND'),
        upcomingMaturities: monitored.filter((x) => x.daysToMaturity >= 0 && x.daysToMaturity <= 30).length, expired: count('EXPIRED'), renewalsDue: count('RENEWAL_DUE'), releaseRequests: count('RELEASE_REQUESTED'), correctionRequested: count('CORRECTION_REQUESTED'), drafts: count('DRAFT') },
      byStatus: group((x) => x.status), byBank: group((x) => x.bank).slice(0, 8), byInstitution: group((x) => x.institutionName).slice(0, 8),
      maturityBuckets: Object.entries(mb).map(([name, count]) => ({ name, count })), amountBuckets: Object.entries(ab).map(([name, count]) => ({ name, count })),
      upcoming: monitored.filter((x) => x.daysToMaturity <= 60).sort((p, q) => p.daysToMaturity - q.daysToMaturity).slice(0, 6),
      recent: recent.map((x: any) => ({ at: x.at, by: x.actor_name, role: x.actor_role, action: x.action, fdrId: x.entity_id })),
    });
  });

  // ---------- notifications (in-app only; external delivery unavailable)
  r.get('/notifications', async (req, res) => {
    const a = req.actor!; const p: any[] = []; let aud = '1=0';
    if (a.role === 'INSTITUTION_ADMIN') { p.push(a.institutionId); aud = 'n.institution_id=$1'; } else if (isStaff(a.role)) aud = 'n.staff=true';
    const rows = (await db.query(`select n.* from notifications n where ${aud} order by n.created_at desc limit 200`, p)).rows;
    const read = new Set((await db.query('select notification_id from notification_reads where user_id=$1', [a.id])).rows.map((x: any) => x.notification_id));
    const items = rows.map((n: any) => ({ id: n.id, type: n.type, title: n.title, message: n.message, fdrId: n.fdr_id, createdAt: n.created_at, read: read.has(n.id), externalDelivery: n.external_delivery }));
    res.json({ items, unread: items.filter((n: any) => !n.read).length, externalDelivery: 'Email/SMS is not configured in this prototype — alerts are shown in-app only.' });
  });
  r.post('/notifications/:id/read', async (req, res) => {
    const ex = await db.query('select 1 from notification_reads where notification_id=$1 and user_id=$2', [req.params.id, req.actor!.id]);
    if (!ex.rows.length) await db.query('insert into notification_reads(notification_id,user_id) values($1,$2)', [req.params.id, req.actor!.id]).catch(() => undefined);
    res.json({ ok: true });
  });
  r.post('/notifications/read-all', async (req, res) => {
    const a = req.actor!; const p: any[] = []; let aud = '1=0';
    if (a.role === 'INSTITUTION_ADMIN') { p.push(a.institutionId); aud = 'institution_id=$1'; } else if (isStaff(a.role)) aud = 'staff=true';
    const read = new Set((await db.query('select notification_id from notification_reads where user_id=$1', [a.id])).rows.map((x: any) => x.notification_id));
    for (const n of (await db.query(`select id from notifications where ${aud}`, p)).rows) if (!read.has(n.id)) await db.query('insert into notification_reads(notification_id,user_id) values($1,$2)', [n.id, a.id]);
    res.json({ ok: true });
  });
  r.post('/alerts/scan', requireRole('AICTE_OFFICER', 'SUPER_ADMIN'), async (req, res) => {
    const out = await runAlertScan(db); await audit(db, req.actor!, 'ALERT_SCAN', 'system', null, null, out); res.json(out);
  });
  r.get('/settings', requireRole('AICTE_OFFICER', 'SUPER_ADMIN'), async (_q, res) => res.json(await getSettings(db)));
  r.put('/settings', requireRole('SUPER_ADMIN'), async (req, res) => {
    const b = z.object({ reminderDays: z.array(z.number().int().min(1).max(365)).min(1).max(8), scrutinySlaDays: z.number().int().min(1).max(60) }).parse(req.body);
    await saveSettings(db, b); await audit(db, req.actor!, 'SETTINGS_CHANGED', 'settings', null, null, b); res.json(b);
  });

  // ---------- audit log
  r.get('/audit', requireRole('AICTE_OFFICER', 'SUPER_ADMIN'), async (req, res) => {
    const q = z.object({ q: z.string().max(80).optional(), action: z.string().max(60).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    const p: any[] = []; const w = ['1=1'];
    if (q.q) { p.push(`%${q.q.toLowerCase()}%`); w.push(`(lower(actor_name) like $${p.length} or lower(coalesce(details,'')) like $${p.length})`); }
    if (q.action) { p.push(q.action); w.push(`action=$${p.length}`); }
    const total = Number((await db.query(`select count(*) as c from audit_log where ${w.join(' and ')}`, p)).rows[0].c);
    const rows = (await db.query(`select * from audit_log where ${w.join(' and ')} order by at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, p)).rows;
    res.json({ total, page: q.page, pageSize: q.pageSize, items: rows.map((x: any) => ({ id: x.id, at: x.at, by: x.actor_name, role: x.actor_role, action: x.action, entity: x.entity, entityId: x.entity_id, details: x.details ? JSON.parse(x.details) : null })) });
  });

  // ---------- institutions & users
  r.get('/institutions', requireRole('AICTE_OFFICER', 'SUPER_ADMIN'), async (_q, res) => {
    const rows = (await db.query(`select i.*, (select count(*) from fdrs f where f.institution_id=i.id and f.status<>'DRAFT') as fdrs, (select coalesce(sum(amount),0) from fdrs f where f.institution_id=i.id and f.status in ('APPROVED','RENEWAL_DUE','RELEASE_REQUESTED')) as secured from institutions i order by i.name`)).rows;
    res.json({ items: rows.map((i: any) => ({ id: i.id, name: i.name, aicteId: i.aicte_id, city: i.city, state: i.state, fdrs: Number(i.fdrs), secured: Number(i.secured) })) });
  });
  r.get('/institution/me', requireRole('INSTITUTION_ADMIN'), async (req, res) => {
    const i = (await db.query('select * from institutions where id=$1', [req.actor!.institutionId])).rows[0];
    res.json({ id: i.id, name: i.name, aicteId: i.aicte_id, city: i.city, state: i.state, contactEmail: i.contact_email, contactPhone: i.contact_phone });
  });
  r.put('/institution/me', requireRole('INSTITUTION_ADMIN'), async (req, res) => {
    const b = z.object({ city: z.string().trim().max(60).optional(), state: z.string().trim().max(60).optional(), contactEmail: z.string().email().optional().or(z.literal('')), contactPhone: z.string().regex(/^[0-9+\- ]{6,20}$/).optional().or(z.literal('')) }).parse(req.body);
    await db.query('update institutions set city=$1,state=$2,contact_email=$3,contact_phone=$4 where id=$5', [b.city || null, b.state || null, b.contactEmail || null, b.contactPhone || null, req.actor!.institutionId]);
    await audit(db, req.actor!, 'INSTITUTION_PROFILE_UPDATED', 'institution', req.actor!.institutionId, req.actor!.institutionId); res.json({ ok: true });
  });
  r.get('/admin/users', requireRole('SUPER_ADMIN'), async (_q, res) => {
    const rows = (await db.query('select u.id,u.email,u.name,u.role,u.active,u.created_at,i.name as institution from users u left join institutions i on i.id=u.institution_id order by u.created_at')).rows;
    res.json({ items: rows });
  });
  r.post('/admin/users', requireRole('SUPER_ADMIN'), async (req, res) => {
    const b = z.object({ name: z.string().trim().min(2).max(80), email: z.string().email().toLowerCase(), password: passwordRule, role: z.enum(['AICTE_OFFICER', 'BANK_VERIFIER', 'SUPER_ADMIN']) }).parse(req.body);
    if ((await db.query('select 1 from users where email=$1', [b.email])).rows.length) throw new HttpError(409, 'Email already registered');
    const id = newId();
    await db.query('insert into users(id,email,name,password_hash,role,created_at) values($1,$2,$3,$4,$5,$6)', [id, b.email, b.name, await bcrypt.hash(b.password, 11), b.role, nowIso()]);
    await audit(db, req.actor!, 'USER_CREATED', 'user', id, null, { email: b.email, role: b.role }); res.status(201).json({ id });
  });
  r.patch('/admin/users/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
    const b = z.object({ active: z.boolean() }).parse(req.body);
    if (req.params.id === req.actor!.id) throw new HttpError(400, 'You cannot deactivate your own account');
    await db.query('update users set active=$1 where id=$2', [b.active, req.params.id]);
    await audit(db, req.actor!, b.active ? 'USER_ENABLED' : 'USER_DISABLED', 'user', req.params.id, null); res.json({ ok: true });
  });

  // ---------- release / discharge requests (records a decision only; no funds are moved by this system)
  r.get('/releases', async (req, res) => {
    const a = req.actor!; if (a.role === 'BANK_VERIFIER') throw new HttpError(403, 'Not permitted');
    const p: any[] = []; let w = '1=1'; if (a.role === 'INSTITUTION_ADMIN') { p.push(a.institutionId); w = 'rr.institution_id=$1'; }
    const rows = (await db.query(`select rr.*, f.fdr_number, f.bank, f.amount, i.name as institution_name from release_requests rr join fdrs f on f.id=rr.fdr_id join institutions i on i.id=rr.institution_id where ${w} order by rr.requested_at desc`, p)).rows;
    res.json({ items: rows.map((x: any) => ({ id: x.id, fdrId: x.fdr_id, fdrNumber: x.fdr_number, bank: x.bank, amount: x.amount, institutionName: x.institution_name, reason: x.reason, status: x.status, requestedAt: x.requested_at, officerNote: x.officer_note, institutionResponse: x.institution_response, decidedAt: x.decided_at, decisionRemarks: x.decision_remarks })) });
  });
  r.post('/fdrs/:id/release', requireRole('INSTITUTION_ADMIN'), async (req, res) => {
    const b = z.object({ reason: z.string().trim().min(10, 'Please give a reason (min 10 characters)').max(1500) }).parse(req.body); const a = req.actor!;
    const id = await tx(db, async (q) => {
      const f = await loadFdr(q, a, req.params.id);
      if (!FIN.includes(f.status)) throw new HttpError(409, 'Release can only be requested for approved / renewal-due / expired / renewed FDRs');
      if ((await q.query(`select 1 from release_requests where fdr_id=$1 and status in ('PENDING','CLARIFICATION_REQUESTED')`, [f.id])).rows.length) throw new HttpError(409, 'A release request is already open');
      const sup = await q.query(`select 1 from documents where fdr_id=$1 and kind='RELEASE_SUPPORT' and removed=false`, [f.id]);
      const id = newId();
      await q.query('insert into release_requests(id,fdr_id,institution_id,reason,status,prev_status,requested_by,requested_at) values($1,$2,$3,$4,$5,$6,$7,$8)', [id, f.id, f.institution_id, b.reason, 'PENDING', f.status, a.id, nowIso()]);
      await doTransition(q, f, 'RELEASE_REQUESTED', a, b.reason);
      await audit(q, a, 'RELEASE_REQUESTED', 'fdr', f.id, f.institution_id, { releaseId: id, supportingDocs: sup.rows.length > 0 });
      await notify(q, { staff: true, fdrId: f.id, type: 'RELEASE_REQUEST', title: `Release requested for ${f.fdr_number}`, message: b.reason.slice(0, 160) });
      return id;
    });
    res.status(201).json({ id });
  });
  r.post('/releases/:id/respond', requireRole('INSTITUTION_ADMIN'), async (req, res) => {
    const b = z.object({ message: z.string().trim().min(3).max(1500) }).parse(req.body); const a = req.actor!;
    const rr = (await db.query('select * from release_requests where id=$1 and institution_id=$2', [req.params.id, a.institutionId])).rows[0];
    if (!rr) throw new HttpError(404, 'Release request not found');
    if (rr.status !== 'CLARIFICATION_REQUESTED') throw new HttpError(409, 'No clarification is pending');
    await db.query(`update release_requests set status='PENDING', institution_response=$1 where id=$2`, [b.message, rr.id]);
    await audit(db, a, 'RELEASE_CLARIFICATION_PROVIDED', 'fdr', rr.fdr_id, rr.institution_id, { releaseId: rr.id });
    await notify(db, { staff: true, fdrId: rr.fdr_id, type: 'RELEASE_REQUEST', title: 'Clarification provided on release request', message: b.message.slice(0, 160) });
    res.json({ ok: true });
  });
  r.post('/releases/:id/decision', requireRole('AICTE_OFFICER', 'SUPER_ADMIN'), async (req, res) => {
    const b = z.object({ action: z.enum(['CLARIFY', 'APPROVE', 'REJECT']), remarks: z.string().trim().min(3, 'Remarks are required').max(1500) }).parse(req.body); const a = req.actor!;
    await tx(db, async (q) => {
      const rr = (await q.query('select * from release_requests where id=$1', [req.params.id])).rows[0];
      if (!rr) throw new HttpError(404, 'Release request not found');
      if (rr.status !== 'PENDING') throw new HttpError(409, 'Request is not awaiting a decision');
      const f = await loadFdr(q, a, rr.fdr_id); const at = nowIso();
      if (b.action === 'CLARIFY') {
        await q.query(`update release_requests set status='CLARIFICATION_REQUESTED', officer_note=$1 where id=$2`, [b.remarks, rr.id]);
        await audit(q, a, 'RELEASE_CLARIFICATION_REQUESTED', 'fdr', f.id, f.institution_id, { releaseId: rr.id, remarks: b.remarks });
        await notify(q, { institutionId: f.institution_id, fdrId: f.id, type: 'RELEASE_REQUEST', title: `Clarification needed: release of ${f.fdr_number}`, message: b.remarks });
      } else {
        const approve = b.action === 'APPROVE';
        await q.query('update release_requests set status=$1, decided_by=$2, decided_at=$3, decision_remarks=$4 where id=$5', [approve ? 'APPROVED' : 'REJECTED', a.id, at, b.remarks, rr.id]);
        await doTransition(q, f, approve ? 'RELEASED' : (rr.prev_status as any), a, b.remarks);
        await audit(q, a, approve ? 'RELEASE_APPROVED' : 'RELEASE_REJECTED', 'fdr', f.id, f.institution_id, { releaseId: rr.id, remarks: b.remarks });
        await notify(q, { institutionId: f.institution_id, fdrId: f.id, type: 'RELEASE_REQUEST', title: `Release ${approve ? 'approved' : 'rejected'}: ${f.fdr_number}`, message: b.remarks });
      }
    });
    res.json({ ok: true, note: 'Decision recorded. This system does not transfer funds; payout is handled outside this prototype.' });
  });
  return r;
}
