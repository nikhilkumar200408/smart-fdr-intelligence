import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { DB } from './db';
import { HttpError } from './util';

export type Role = 'INSTITUTION_ADMIN' | 'AICTE_OFFICER' | 'BANK_VERIFIER' | 'SUPER_ADMIN';
export type ActorRole = Role | 'SYSTEM';
export interface Actor { id: string; name: string; email: string; role: ActorRole; institutionId: string | null; }
export const SYSTEM: Actor = { id: 'system', name: 'System (alert scan)', email: '', role: 'SYSTEM', institutionId: null };
export const isStaff = (r: ActorRole) => r === 'AICTE_OFFICER' || r === 'SUPER_ADMIN';
export const COOKIE = 'fdr_token';

declare global { namespace Express { interface Request { actor?: Actor } } }

export const signToken = (userId: string) => jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '8h' });
export const setCookie = (res: Response, userId: string) =>
  res.cookie(COOKIE, signToken(userId), { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 8 * 3600 * 1000 });

export function authenticate(db: DB) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[COOKIE];
    if (!token) throw new HttpError(401, 'Not signed in');
    let sub: string;
    try { sub = (jwt.verify(token, config.jwtSecret) as any).sub; } catch { throw new HttpError(401, 'Session expired'); }
    const { rows } = await db.query('select id,name,email,role,institution_id,active from users where id=$1', [sub]);
    const u = rows[0];
    if (!u || !u.active) throw new HttpError(401, 'Account unavailable');
    req.actor = { id: u.id, name: u.name, email: u.email, role: u.role, institutionId: u.institution_id };
    next();
  };
}
export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.actor || !roles.includes(req.actor.role as Role)) throw new HttpError(403, 'You do not have permission for this action');
  next();
};
