import { Actor } from './auth';
import { Q } from './db';
import { newId, nowIso } from './util';

export async function audit(q: Q, actor: Actor, action: string, entity: string, entityId: string | null, institutionId: string | null, details?: unknown) {
  await q.query(
    'insert into audit_log(id,at,actor_id,actor_name,actor_role,action,entity,entity_id,institution_id,details) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [newId(), nowIso(), actor.id, actor.name, actor.role, action, entity, entityId, institutionId, details ? JSON.stringify(details) : null]);
}
export async function notify(q: Q, n: { institutionId?: string | null; staff?: boolean; fdrId?: string | null; type: string; title: string; message: string; dedupeKey?: string }) {
  const r = await q.query(
    'select id from notifications where dedupe_key=$1', [n.dedupeKey ?? '__none__']);
  if (n.dedupeKey && r.rows.length) return false;
  await q.query(
    'insert into notifications(id,institution_id,staff,fdr_id,type,title,message,dedupe_key,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [newId(), n.institutionId ?? null, !!n.staff, n.fdrId ?? null, n.type, n.title, n.message, n.dedupeKey ?? null, nowIso()]);
  return true;
}
