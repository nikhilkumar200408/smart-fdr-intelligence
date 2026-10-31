import { Actor, ActorRole } from './auth';
import { audit, notify } from './audit';
import { Q } from './db';
import { HttpError, newId, nowIso } from './util';

export const STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'CORRECTION_REQUESTED', 'VERIFICATION_PENDING', 'VERIFIED',
  'DISCREPANCY_FOUND', 'APPROVED', 'REJECTED', 'RENEWAL_DUE', 'RENEWED', 'EXPIRED', 'RELEASE_REQUESTED', 'RELEASED'] as const;
export type Status = (typeof STATUSES)[number];
export const ACTIVE: Status[] = ['APPROVED', 'RENEWAL_DUE']; // FDRs under active monitoring
export const SECURED: Status[] = ['APPROVED', 'RENEWAL_DUE', 'RELEASE_REQUESTED']; // deposit currently held

const INST: ActorRole[] = ['INSTITUTION_ADMIN'];
const STAFF: ActorRole[] = ['AICTE_OFFICER', 'SUPER_ADMIN'];
const STAFF_SYS: ActorRole[] = [...STAFF, 'SYSTEM'];
const VERIFIERS: ActorRole[] = [...STAFF, 'BANK_VERIFIER'];

// from -> to -> roles allowed to perform the move
export const TRANSITIONS: Record<string, Record<string, ActorRole[]>> = {
  DRAFT: { SUBMITTED: INST },
  SUBMITTED: { UNDER_SCRUTINY: STAFF },
  UNDER_SCRUTINY: { CORRECTION_REQUESTED: STAFF, VERIFICATION_PENDING: STAFF, REJECTED: STAFF },
  CORRECTION_REQUESTED: { SUBMITTED: INST },
  VERIFICATION_PENDING: { VERIFIED: VERIFIERS, DISCREPANCY_FOUND: VERIFIERS },
  VERIFIED: { APPROVED: STAFF, REJECTED: STAFF },
  DISCREPANCY_FOUND: { CORRECTION_REQUESTED: STAFF, REJECTED: STAFF, VERIFICATION_PENDING: STAFF },
  APPROVED: { RENEWAL_DUE: STAFF_SYS, EXPIRED: STAFF_SYS, RENEWED: STAFF_SYS, RELEASE_REQUESTED: INST },
  RENEWAL_DUE: { EXPIRED: STAFF_SYS, RENEWED: STAFF_SYS, RELEASE_REQUESTED: INST },
  EXPIRED: { RENEWED: STAFF_SYS, RELEASE_REQUESTED: INST },
  RENEWED: { RELEASE_REQUESTED: INST },
  RELEASE_REQUESTED: { RELEASED: STAFF, APPROVED: STAFF, RENEWAL_DUE: STAFF, EXPIRED: STAFF, RENEWED: STAFF },
  REJECTED: {}, RELEASED: {},
};
// Moves that must go through a dedicated endpoint (they need extra data/records).
export const DEDICATED = new Set(['VERIFIED', 'DISCREPANCY_FOUND', 'RELEASE_REQUESTED', 'RELEASED', 'RENEWED']);
export const NEEDS_REMARKS = new Set(['CORRECTION_REQUESTED', 'REJECTED', 'DISCREPANCY_FOUND', 'RELEASED']);

export const canTransition = (from: string, to: string, role: ActorRole) => !!TRANSITIONS[from]?.[to]?.includes(role);
export const allowedFor = (from: string, role: ActorRole, generic = true) =>
  Object.entries(TRANSITIONS[from] || {}).filter(([to, roles]) => roles.includes(role) && !(generic && DEDICATED.has(to))).map(([to]) => to);

export async function doTransition(q: Q, fdr: { id: string; status: string; institution_id: string; fdr_number: string; replaces_id?: string | null },
  to: Status, actor: Actor, remarks?: string | null) {
  if (!canTransition(fdr.status, to, actor.role)) throw new HttpError(409, `Transition ${fdr.status} → ${to} is not allowed for ${actor.role}`);
  if (NEEDS_REMARKS.has(to) && !(remarks && remarks.trim().length >= 3)) throw new HttpError(400, 'Remarks are required for this action');
  const at = nowIso();
  await q.query('update fdrs set status=$1, updated_at=$2, submitted_at=case when $1=$3 then $2 else submitted_at end where id=$4', [to, at, 'SUBMITTED', fdr.id]);
  await q.query('insert into fdr_events(id,fdr_id,from_status,to_status,actor_id,actor_name,actor_role,remarks,at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [newId(), fdr.id, fdr.status, to, actor.id, actor.name, actor.role, remarks ?? null, at]);
  await audit(q, actor, 'FDR_STATUS_CHANGED', 'fdr', fdr.id, fdr.institution_id, { from: fdr.status, to, remarks });
  if (to === 'SUBMITTED') await notify(q, { staff: true, fdrId: fdr.id, type: 'SUBMISSION', title: 'FDR submitted for scrutiny', message: `FDR ${fdr.fdr_number} is awaiting scrutiny.` });
  if (to === 'CORRECTION_REQUESTED' || to === 'REJECTED' || to === 'APPROVED' || to === 'UNDER_SCRUTINY')
    await notify(q, { institutionId: fdr.institution_id, fdrId: fdr.id, type: 'STATUS', title: `FDR ${fdr.fdr_number}: ${to.replace(/_/g, ' ').toLowerCase()}`, message: remarks || 'Status updated by AICTE.' });
  // A replacement being approved retires the original FDR as RENEWED.
  if (to === 'APPROVED' && fdr.replaces_id) {
    const o = (await q.query('select * from fdrs where id=$1', [fdr.replaces_id])).rows[0];
    if (o && canTransition(o.status, 'RENEWED', 'SYSTEM'))
      await doTransition(q, o, 'RENEWED', { id: 'system', name: 'System (renewal link)', email: '', role: 'SYSTEM', institutionId: null }, `Replaced by ${fdr.fdr_number}`);
  }
}
