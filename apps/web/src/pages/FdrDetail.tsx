import { AlertTriangle, ArrowRight, Download, ShieldAlert } from 'lucide-react';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, Field, Modal, PageHeader, Spinner, fmtDate, fmtDateTime, inr, label, useToast } from '../ui';

const TABS = ['Overview', 'Documents', 'Scrutiny', 'Verification', 'Release', 'History'];
const SOURCES = ['BANK_LETTER', 'BANK_BRANCH_CONFIRMATION', 'BANK_PORTAL_MANUAL', 'OTHER'];
const Row = ({ k, v }: { k: string; v: ReactNode }) => <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm"><span className="text-slate-500">{k}</span><span className="text-right font-medium text-slate-800">{v}</span></div>;

export default function FdrDetail() {
  const { id } = useParams(); const { user } = useAuth(); const toast = useToast();
  const [d, setD] = useState<any>(null); const [tab, setTab] = useState('Overview'); const [err, setErr] = useState('');
  const [modal, setModal] = useState<{ to: string } | 'release' | null>(null); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const [obs, setObs] = useState({ kind: 'OBSERVATION', severity: 'MEDIUM', text: '' });
  const [ver, setVer] = useState<any>({ outcome: 'VERIFIED', source: 'BANK_LETTER', reference: '', remarks: '', verifiedAmount: '', verifiedMaturityDate: '', verifiedOn: new Date().toISOString().slice(0, 10) });
  const [ferr, setFerr] = useState<Record<string, string>>({});
  const load = useCallback(() => api(`/fdrs/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { setD(null); load(); }, [load]);
  async function run(fn: () => Promise<unknown>, ok: string) { setBusy(true); setFerr({}); try { await fn(); toast('ok', ok); setModal(null); setText(''); await load(); } catch (x) { if (x instanceof ApiError && x.fields) setFerr(x.fields); toast('err', (x as Error).message); } finally { setBusy(false); } }
  if (err) return <Empty title="FDR not available" hint={err} action={<Link className="btn-ghost" to="/fdrs">Back to register</Link>} />; if (!d) return <Spinner />;
  const { fdr, permissions: p, verifiedData: vd } = d; const staff = user!.role === 'AICTE_OFFICER' || user!.role === 'SUPER_ADMIN'; const inst = user!.role === 'INSTITUTION_ADMIN';
  const mismatch = (a: any, b: any) => vd.status !== 'NOT_VERIFIED' && a !== b;
  return <>
    <PageHeader title={`FDR ${fdr.fdrNumber}`} sub={`${fdr.institutionName} · ${fdr.bank}, ${fdr.branch}`}>
      <Badge v={fdr.status} />{p.canEdit && <Link to={`/fdrs/${fdr.id}/edit`} className="btn-ghost">Edit</Link>}
      {p.canRenew && <Link to={`/fdrs/new?renew=${fdr.id}`} className="btn-accent">Renew / replace</Link>}
      {p.canRequestRelease && <button className="btn-ghost" onClick={() => setModal('release')}>Request release</button>}</PageHeader>
    {(fdr.status === 'CORRECTION_REQUESTED' && inst) && <div className="mb-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-5 w-5 shrink-0" />AICTE has requested corrections. Edit the application / upload documents, then resubmit.</div>}
    <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
      <span className="text-xs font-semibold uppercase text-slate-500">Actions</span>
      {p.transitions.length === 0 && !p.canVerify && <span className="text-sm text-slate-400">No actions available in this status</span>}
      {p.transitions.map((t: string) => <button key={t} className={t === 'REJECTED' ? 'btn-danger' : 'btn-primary'} onClick={() => ['CORRECTION_REQUESTED', 'REJECTED'].includes(t) || t === 'APPROVED' ? setModal({ to: t }) : run(() => api(`/fdrs/${fdr.id}/transition`, { body: { to: t } }), `Moved to ${label(t)}`)}>{t === 'SUBMITTED' ? 'Submit' : <>{label(t)}<ArrowRight size={14} /></>}</button>)}
      {p.canVerify && <button className="btn-accent" onClick={() => setTab('Verification')}>Record verification</button>}</div>
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">{TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={`whitespace-nowrap px-4 py-2 text-sm font-medium ${tab === t ? 'border-b-2 border-brand-700 text-brand-800' : 'text-slate-500 hover:text-slate-800'}`}>{t}{t === 'Scrutiny' && d.observations.length ? ` (${d.observations.length})` : ''}</button>)}</div>

    {tab === 'Overview' && <div className="grid gap-6 lg:grid-cols-2">
      <div className="card p-5"><h3 className="mb-1 font-semibold text-brand-900">Submitted by institution <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Declared · unverified</span></h3>
        <Row k="AICTE reference" v={fdr.aicteRef} /><Row k="Amount" v={inr(fdr.amount)} /><Row k="Issue date" v={fmtDate(fdr.issueDate)} /><Row k="Maturity date" v={fmtDate(fdr.maturityDate)} /><Row k="Validity date" v={fmtDate(fdr.validityDate)} /><Row k="Beneficiary" v={fdr.beneficiary} /><Row k="Purpose" v={fdr.purpose} />{fdr.remarks && <Row k="Remarks" v={fdr.remarks} />}
        {d.replaces && <Row k="Replaces" v={<Link className="text-brand-700 underline" to={`/fdrs/${d.replaces.id}`}>{d.replaces.fdrNumber} ({label(d.replaces.status)})</Link>} />}
        {d.replacedBy && <Row k="Replaced by" v={<Link className="text-brand-700 underline" to={`/fdrs/${d.replacedBy.id}`}>{d.replacedBy.fdrNumber} ({label(d.replacedBy.status)})</Link>} />}</div>
      <div className="space-y-6"><div className="card p-5"><h3 className="mb-1 font-semibold text-brand-900">Independently verified <Badge v={vd.status} /></h3>
        {vd.status === 'NOT_VERIFIED' ? <p className="py-4 text-sm text-slate-500">No verification recorded yet. Values above have not been confirmed with the bank.</p> : <>
          <Row k="Verified amount" v={<span className={mismatch(vd.amount, fdr.amount) ? 'text-red-600' : ''}>{inr(vd.amount)}</span>} /><Row k="Verified maturity" v={<span className={mismatch(vd.maturityDate, fdr.maturityDate) ? 'text-red-600' : ''}>{fmtDate(vd.maturityDate)}</span>} />
          <Row k="Source / ref" v={`${label(vd.latest.source)} · ${vd.latest.reference}`} /><Row k="Verified by" v={`${vd.latest.verifier_name} (manual)`} /></>}</div>
        <div className="card p-5"><h3 className="mb-2 flex items-center gap-2 font-semibold text-brand-900"><ShieldAlert size={18} />Automated checks</h3>{d.flags.length === 0 ? <p className="text-sm text-emerald-700">No rule-based issues detected.</p> : <ul className="space-y-2">{d.flags.map((f: any) => <li key={f.code} className="flex items-start gap-2 text-sm"><Badge v={f.severity} /><span>{f.message}</span></li>)}</ul>}
          <p className="mt-3 text-xs text-slate-400">Simple rule checks on recorded data — not AI or bank verification.</p></div></div></div>}

    {tab === 'Documents' && <div className="card p-5">{d.documents.length === 0 ? <Empty title="No documents uploaded" hint={p.canUpload ? 'Use Edit to add documents.' : undefined} /> : <table className="w-full"><thead><tr><th className="th">File</th><th className="th">Type</th><th className="th">Uploaded</th><th className="th">SHA-256</th><th className="th" /></tr></thead><tbody className="divide-y divide-slate-100">
      {d.documents.map((x: any) => <tr key={x.id}><td className="td">{x.name}<p className="text-xs text-slate-400">{(x.size / 1024).toFixed(0)} KB</p></td><td className="td">{label(x.kind)}</td><td className="td">{fmtDateTime(x.uploadedAt)}</td><td className="td font-mono text-xs">{x.sha256.slice(0, 12)}…</td><td className="td text-right"><a className="btn-ghost" href={`/api/documents/${x.id}/download`}><Download size={14} />Download</a></td></tr>)}</tbody></table>}
      {p.canUpload && !p.editableDocs && <DocUpload id={fdr.id} onDone={load} />}<p className="mt-3 text-xs text-slate-400">Files are stored privately and served only to authorised users.</p></div>}

    {tab === 'Scrutiny' && <div className="grid gap-6 lg:grid-cols-3"><div className="card p-5 lg:col-span-2"><h3 className="mb-3 font-semibold text-brand-900">Observations & correction requests</h3>
      {d.observations.length === 0 ? <Empty title="No observations" /> : <ul className="space-y-3">{d.observations.map((o: any) => <li key={o.id} className="rounded-lg border border-slate-200 p-3 text-sm"><div className="mb-1 flex flex-wrap items-center gap-2"><Badge v={o.kind} /><Badge v={o.severity} />{o.resolved && <Badge v="VERIFIED" text="Addressed" />}<span className="text-xs text-slate-400">{o.author} · {fmtDateTime(o.createdAt)}</span></div>{o.text}</li>)}</ul>}</div>
      {p.canObserve && <div className="card p-5"><h3 className="mb-3 font-semibold text-brand-900">Add observation</h3><div className="space-y-3">
        <Field label="Type"><select className="input" value={obs.kind} onChange={(e) => setObs({ ...obs, kind: e.target.value })}><option value="OBSERVATION">Observation</option><option value="FLAG">Flag (missing / mismatch / suspicious)</option><option value="CORRECTION_REQUEST">Request correction</option></select></Field>
        <Field label="Severity"><select className="input" value={obs.severity} onChange={(e) => setObs({ ...obs, severity: e.target.value })}><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></Field>
        <Field label="Details" error={ferr.text}><textarea className="input" rows={4} value={obs.text} onChange={(e) => setObs({ ...obs, text: e.target.value })} /></Field>
        <button className="btn-primary w-full" disabled={busy} onClick={() => run(() => api(`/fdrs/${fdr.id}/observations`, { body: obs }), 'Observation recorded').then(() => setObs({ ...obs, text: '' }))}>Add</button>
        {obs.kind === 'CORRECTION_REQUEST' && <p className="text-xs text-amber-700">This will move the FDR to “Correction requested”.</p>}</div></div>}</div>}

    {tab === 'Verification' && <div className="grid gap-6 lg:grid-cols-2"><div className="card p-5"><h3 className="mb-1 font-semibold text-brand-900">Verification history</h3><p className="mb-3 rounded bg-slate-50 p-2 text-xs text-slate-500">Mode: manual authorised verification. No live bank API is connected; nothing here is auto-confirmed.</p>
      {d.verifications.length === 0 ? <Empty title="No verification recorded" /> : <ul className="space-y-3">{d.verifications.map((v: any) => <li key={v.id} className="rounded-lg border border-slate-200 p-3 text-sm"><div className="mb-1 flex items-center gap-2"><Badge v={v.outcome === 'VERIFIED' ? 'VERIFIED' : 'DISCREPANCY_FOUND'} text={label(v.outcome)} /><span className="text-xs text-slate-400">{fmtDateTime(v.createdAt)}</span></div>
        <p>{label(v.source)} · ref <b>{v.reference}</b></p><p>Amount {inr(v.verifiedAmount)} · maturity {fmtDate(v.verifiedMaturityDate)} · on {fmtDate(v.verifiedOn)}</p><p className="text-slate-500">By {v.verifier} ({v.method.toLowerCase()}){v.remarks ? ` — ${v.remarks}` : ''}</p></li>)}</ul>}</div>
      {p.canVerify && <div className="card p-5"><h3 className="mb-3 font-semibold text-brand-900">Record verification</h3><div className="grid gap-3">
        <Field label="Outcome"><select className="input" value={ver.outcome} onChange={(e) => setVer({ ...ver, outcome: e.target.value })}><option value="VERIFIED">Verified (matches submitted data)</option><option value="DISCREPANCY">Discrepancy found</option></select></Field>
        <Field label="Source"><select className="input" value={ver.source} onChange={(e) => setVer({ ...ver, source: e.target.value })}>{SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
        <Field label="Reference (letter / ticket no.)" error={ferr.reference}><input className="input" value={ver.reference} onChange={(e) => setVer({ ...ver, reference: e.target.value })} /></Field>
        <Field label="Verified amount (₹)" error={ferr.verifiedAmount}><input className="input" type="number" value={ver.verifiedAmount} onChange={(e) => setVer({ ...ver, verifiedAmount: e.target.value })} /></Field>
        <Field label="Verified maturity date" error={ferr.verifiedMaturityDate}><input className="input" type="date" value={ver.verifiedMaturityDate} onChange={(e) => setVer({ ...ver, verifiedMaturityDate: e.target.value })} /></Field>
        <Field label="Verified on"><input className="input" type="date" value={ver.verifiedOn} onChange={(e) => setVer({ ...ver, verifiedOn: e.target.value })} /></Field>
        <Field label="Remarks"><textarea className="input" rows={2} value={ver.remarks} onChange={(e) => setVer({ ...ver, remarks: e.target.value })} /></Field>
        <button className="btn-primary" disabled={busy} onClick={() => run(() => api(`/fdrs/${fdr.id}/verification`, { body: { ...ver, verifiedAmount: Number(ver.verifiedAmount) } }), 'Verification recorded')}>Save verification</button></div></div>}</div>}

    {tab === 'Release' && <div className="card p-5">{d.releases.length === 0 ? <Empty title="No release requests" hint="Release can be requested once an FDR is approved." /> : <ul className="space-y-3">{d.releases.map((r: any) => <li key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm"><div className="mb-1 flex items-center gap-2"><Badge v={r.status} /><span className="text-xs text-slate-400">{fmtDateTime(r.requestedAt)}</span></div><p><b>Reason:</b> {r.reason}</p>{r.officerNote && <p><b>AICTE note:</b> {r.officerNote}</p>}{r.institutionResponse && <p><b>Institution response:</b> {r.institutionResponse}</p>}{r.decisionRemarks && <p><b>Decision ({fmtDateTime(r.decidedAt)}):</b> {r.decisionRemarks}</p>}</li>)}</ul>}
      <p className="mt-3 text-xs text-slate-400">This system records approvals only. It does not move funds. <Link to="/releases" className="underline">Open release queue</Link></p></div>}

    {tab === 'History' && <div className="grid gap-6 lg:grid-cols-2"><div className="card p-5"><h3 className="mb-3 font-semibold text-brand-900">Status history</h3><ol className="space-y-3 border-l-2 border-slate-200 pl-4">{d.events.map((e: any, i: number) => <li key={i} className="text-sm"><div className="flex flex-wrap items-center gap-2">{e.from && <><Badge v={e.from} /><ArrowRight size={12} /></>}<Badge v={e.to} /></div><p className="text-xs text-slate-500">{e.by} ({label(e.role)}) · {fmtDateTime(e.at)}</p>{e.remarks && <p className="text-slate-600">{e.remarks}</p>}</li>)}</ol></div>
      <div className="card p-5"><h3 className="mb-3 font-semibold text-brand-900">Audit timeline</h3><ul className="max-h-[32rem] space-y-3 overflow-y-auto">{d.timeline.map((t: any, i: number) => <li key={i} className="flex gap-3 text-sm"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent-500" /><div><p>{label(t.action)} <span className="text-slate-500">· {t.by}</span></p><p className="text-xs text-slate-400">{fmtDateTime(t.at)}</p></div></li>)}</ul></div></div>}

    {modal && <Modal title={modal === 'release' ? 'Request release / discharge' : `${label(modal.to)}`} onClose={() => setModal(null)}>
      <Field label={modal === 'release' ? 'Reason for release' : 'Remarks'} error={ferr.reason || ferr._}><textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      {modal === 'release' && <p className="mt-2 text-xs text-slate-500">Add supporting documents from the Documents tab. Release needs approval by an authorised AICTE officer; no funds are moved by this system.</p>}
      <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={() => run(() => modal === 'release' ? api(`/fdrs/${fdr.id}/release`, { body: { reason: text } }) : api(`/fdrs/${fdr.id}/transition`, { body: { to: modal.to, remarks: text } }), 'Done')}>Confirm</button></div></Modal>}
  </>;
}

function DocUpload({ id, onDone }: { id: string; onDone: () => void }) {
  const toast = useToast(); const [kind, setKind] = useState('RELEASE_SUPPORT');
  async function up(file?: File) { if (!file) return; const form = new FormData(); form.append('kind', kind); form.append('file', file); try { await api(`/fdrs/${id}/documents`, { form }); toast('ok', 'Uploaded'); onDone(); } catch (e) { toast('err', (e as Error).message); } }
  return <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4"><select className="input !w-auto" value={kind} onChange={(e) => setKind(e.target.value)}><option value="RELEASE_SUPPORT">Release supporting document</option><option value="SUPPORTING">Other supporting file</option></select>
    <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => up(e.target.files?.[0])} className="text-sm" /></div>;
}
