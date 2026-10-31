import { Actor, isStaff } from './auth';
import { Q } from './db';
import { ACTIVE } from './lifecycle';
import { HttpError, daysBetween, today } from './util';

export const FDR_SELECT = 'select f.*, i.name as institution_name, i.aicte_id as institution_aicte_id from fdrs f join institutions i on i.id=f.institution_id';
const BANK_VISIBLE = ['VERIFICATION_PENDING', 'VERIFIED', 'DISCREPANCY_FOUND'];

/** Row visibility per role. Institution users only ever see their own institution. */
export function visibility(actor: Actor, params: any[]): string {
  if (actor.role === 'INSTITUTION_ADMIN') { params.push(actor.institutionId); return `f.institution_id=$${params.length}`; }
  if (actor.role === 'BANK_VERIFIER') return `f.status in (${BANK_VISIBLE.map((s) => `'${s}'`).join(',')})`;
  return `f.status <> 'DRAFT'`; // staff do not see institutions' private drafts
}
export async function loadFdr(q: Q, actor: Actor, id: string) {
  const params: any[] = [id];
  const { rows } = await q.query(`${FDR_SELECT} where f.id=$1 and ${visibility(actor, params)}`, params);
  if (!rows[0]) throw new HttpError(404, 'FDR not found'); // 404 (not 403) so existence is not leaked
  return rows[0];
}
export const mapFdr = (r: any) => ({
  id: r.id, institutionId: r.institution_id, institutionName: r.institution_name, institutionAicteId: r.institution_aicte_id,
  aicteRef: r.aicte_ref, fdrNumber: r.fdr_number, bank: r.bank, branch: r.branch, amount: r.amount,
  issueDate: r.issue_date, maturityDate: r.maturity_date, validityDate: r.validity_date, beneficiary: r.beneficiary,
  purpose: r.purpose, remarks: r.remarks, status: r.status, replacesId: r.replaces_id, verificationStatus: r.verification_status,
  createdAt: r.created_at, updatedAt: r.updated_at, submittedAt: r.submitted_at,
  daysToMaturity: daysBetween(today(), r.maturity_date),
});
export const mapDoc = (d: any) => ({ id: d.id, kind: d.kind, name: d.original_name, mime: d.mime, size: d.size, sha256: d.sha256, uploadedAt: d.uploaded_at, uploadedBy: d.uploaded_by });

export interface Flag { code: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; message: string; }
/** Rule-based checks (not AI). Submitted values are institution-declared; "verified" values come only from recorded verification. */
export async function computeFlags(q: Q, f: any, docs: any[]): Promise<Flag[]> {
  const flags: Flag[] = [];
  const t = today();
  const submitted = f.status !== 'DRAFT';
  if (submitted && !docs.some((d) => d.kind === 'FDR_DOCUMENT')) flags.push({ code: 'MISSING_FDR_DOCUMENT', severity: 'HIGH', message: 'No FDR document uploaded' });
  if (submitted && !docs.some((d) => d.kind === 'BANK_CONFIRMATION')) flags.push({ code: 'MISSING_BANK_CONFIRMATION', severity: 'MEDIUM', message: 'No bank confirmation uploaded' });
  if (f.maturity_date <= f.issue_date) flags.push({ code: 'DATE_INCONSISTENT', severity: 'HIGH', message: 'Maturity date is not after issue date' });
  if (f.validity_date < f.maturity_date) flags.push({ code: 'VALIDITY_BEFORE_MATURITY', severity: 'MEDIUM', message: 'Validity date is earlier than maturity date' });
  if ((ACTIVE as string[]).includes(f.status) || ['SUBMITTED', 'UNDER_SCRUTINY', 'VERIFICATION_PENDING', 'VERIFIED'].includes(f.status)) {
    if (f.maturity_date < t) flags.push({ code: 'EXPIRED', severity: 'HIGH', message: 'FDR maturity date has passed' });
    else if (f.validity_date < t) flags.push({ code: 'VALIDITY_EXPIRED', severity: 'HIGH', message: 'Validity date has passed' });
  }
  if (f.verified_amount !== null && Number(f.verified_amount) !== Number(f.amount))
    flags.push({ code: 'AMOUNT_MISMATCH', severity: 'HIGH', message: `Verified amount ${f.verified_amount} differs from submitted ${f.amount}` });
  if (f.verified_maturity_date && f.verified_maturity_date !== f.maturity_date)
    flags.push({ code: 'DATE_MISMATCH', severity: 'HIGH', message: `Verified maturity ${f.verified_maturity_date} differs from submitted ${f.maturity_date}` });
  const dup = await q.query('select count(*) as c from fdrs where lower(fdr_number)=$1 and id<>$2 and institution_id<>$3', [f.fdr_number.toLowerCase(), f.id, f.institution_id]);
  if (Number(dup.rows[0].c) > 0) flags.push({ code: 'FDR_NUMBER_REUSED', severity: 'MEDIUM', message: 'Same FDR number appears under another institution (possible duplicate/suspicious)' });
  return flags;
}
export const staffOnly = (a: Actor) => isStaff(a.role);
