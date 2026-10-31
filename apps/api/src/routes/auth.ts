import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { COOKIE, authenticate, setCookie } from '../auth';
import { audit } from '../audit';
import { DB, tx } from '../db';
import { HttpError, newId, nowIso } from '../util';

export const passwordRule = z.string().min(10, 'At least 10 characters').max(100).regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a digit');
const login = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1) });
const register = z.object({
  name: z.string().trim().min(2).max(80), email: z.string().email().toLowerCase(), password: passwordRule,
  role: z.string(), institutionName: z.string().trim().min(3).max(150), aicteId: z.string().trim().regex(/^[A-Za-z0-9\-]{4,25}$/, 'AICTE ID: 4-25 letters/digits'),
  city: z.string().trim().max(60).optional(), state: z.string().trim().max(60).optional(),
});

export function authRoutes(db: DB, limit = 20) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } });

  r.post('/login', limiter, async (req, res) => {
    const b = login.parse(req.body);
    const u = (await db.query('select * from users where email=$1', [b.email])).rows[0];
    // Same message for unknown user / wrong password / disabled account.
    const ok = u && u.active && (await bcrypt.compare(b.password, u.password_hash));
    if (!ok) throw new HttpError(401, 'Invalid email or password');
    setCookie(res, u.id);
    await audit(db, { id: u.id, name: u.name, email: u.email, role: u.role, institutionId: u.institution_id }, 'LOGIN', 'user', u.id, u.institution_id);
    res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role, institutionId: u.institution_id } });
  });

  r.post('/register', limiter, async (req, res) => {
    const b = register.parse(req.body);
    // Only institution accounts self-register. Staff / bank / super-admin accounts are created by a Super Admin.
    if (b.role !== 'INSTITUTION_ADMIN') throw new HttpError(403, 'Only Institution Admin accounts can self-register. Officer, Bank and Super Admin accounts are issued by a Super Admin.');
    const out = await tx(db, async (q) => {
      if ((await q.query('select 1 from users where email=$1', [b.email])).rows.length) throw new HttpError(409, 'Email already registered');
      if ((await q.query('select 1 from institutions where aicte_id=$1', [b.aicteId])).rows.length) throw new HttpError(409, 'An institution with this AICTE ID is already registered');
      const iid = newId(), uid = newId();
      await q.query('insert into institutions(id,name,aicte_id,city,state,created_at) values($1,$2,$3,$4,$5,$6)', [iid, b.institutionName, b.aicteId, b.city ?? null, b.state ?? null, nowIso()]);
      await q.query('insert into users(id,email,name,password_hash,role,institution_id,created_at) values($1,$2,$3,$4,$5,$6,$7)',
        [uid, b.email, b.name, await bcrypt.hash(b.password, 11), 'INSTITUTION_ADMIN', iid, nowIso()]);
      const actor = { id: uid, name: b.name, email: b.email, role: 'INSTITUTION_ADMIN' as const, institutionId: iid };
      await audit(q, actor, 'REGISTER', 'user', uid, iid);
      return actor;
    });
    setCookie(res, out.id);
    res.status(201).json({ user: out });
  });

  r.post('/logout', (_req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });
  r.get('/me', authenticate(db), (req, res) => res.json({ user: req.actor }));
  return r;
}
