import 'dotenv/config';
import { randomBytes } from 'crypto';

const prod = process.env.NODE_ENV === 'production';
if (prod && !process.env.JWT_SECRET) throw new Error('JWT_SECRET is required in production');
if (!process.env.JWT_SECRET) console.warn('[config] JWT_SECRET not set: using a random per-process secret (sessions reset on restart).');

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://fdr:fdr@localhost:5432/fdr',
  jwtSecret: process.env.JWT_SECRET || randomBytes(32).toString('hex'),
  cookieSecure: process.env.COOKIE_SECURE === 'true' || prod,
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:5173',
  storageDir: process.env.STORAGE_DIR || './storage',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 5) * 1024 * 1024,
  prod,
};
