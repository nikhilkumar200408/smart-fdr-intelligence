import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import 'express-async-errors';
import { ZodError } from 'zod';
import { authenticate } from './auth';
import { config } from './config';
import { DB } from './db';
import { authRoutes } from './routes/auth';
import { fdrRoutes } from './routes/fdrs';
import { opsRoutes } from './routes/ops';
import { HttpError } from './util';

export function createApp(db: DB, opts: { authLimit?: number } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });
  app.use(cors({ origin: config.webOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  // CSRF defence in depth (on top of SameSite=Lax): state-changing calls must carry a custom header, which cross-site forms cannot set.
  app.use((req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'fdr-web') throw new HttpError(403, 'Missing request header');
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, mode: 'prototype', note: 'Synthetic data. Not an official AICTE system.' }));
  app.use('/api/auth', authRoutes(db, opts.authLimit));
  app.use('/api', authenticate(db), fdrRoutes(db), opsRoutes(db));
  app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', fields: Object.fromEntries(err.issues.map((i) => [i.path.join('.') || '_', i.message])) });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large (max ${Math.round(config.maxUploadBytes / 1048576)} MB)` });
    if (err?.code === '23505') return res.status(409).json({ error: 'Duplicate record' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
