import { CheckCircle2, FileUp, Loader2, Trash2, XCircle } from 'lucide-react';
import { DragEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import { Field, PageHeader, Spinner, useToast } from '../ui';

const KINDS = [['FDR_DOCUMENT', 'FDR document'], ['BANK_CONFIRMATION', 'Bank confirmation'], ['RENEWAL_DOCUMENT', 'Renewal / replacement document'], ['SUPPORTING', 'Supporting file']];
const MAX = 5 * 1024 * 1024; const OK = ['application/pdf', 'image/png', 'image/jpeg'];
type Staged = { file: File; kind: string; state: 'queued' | 'uploading' | 'done' | 'error'; msg?: string };
const blank = { aicteRef: '', fdrNumber: '', bank: '', branch: '', amount: '', issueDate: '', maturityDate: '', validityDate: '', beneficiary: 'AICTE', purpose: '', remarks: '' };

export default function FdrForm() {
  const { id } = useParams(); const [sp] = useSearchParams(); const renew = sp.get('renew'); const nav = useNavigate(); const toast = useToast();
  const [f, setF] = useState<any>(blank); const [errs, setErrs] = useState<Record<string, string>>({}); const [files, setFiles] = useState<Staged[]>([]); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(!id && !renew); const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const src = id || renew; if (!src) return; api(`/fdrs/${src}`).then((r) => { const x = r.fdr; setF(id ? { ...x, amount: String(x.amount), remarks: x.remarks || '' } : { ...blank, bank: x.bank, branch: x.branch, amount: String(x.amount), purpose: x.purpose, beneficiary: x.beneficiary, aicteRef: x.aicteRef }); setReady(true); }).catch((e) => toast('err', e.message)); }, [id, renew]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  function add(list: FileList | File[]) {
    const next: Staged[] = [];
    for (const file of Array.from(list)) {
      if (!OK.includes(file.type)) { toast('err', `${file.name}: only PDF, PNG or JPEG allowed`); continue; }
      if (file.size > MAX) { toast('err', `${file.name}: larger than 5 MB`); continue; }
      next.push({ file, kind: files.length + next.length === 0 ? 'FDR_DOCUMENT' : renew ? 'RENEWAL_DOCUMENT' : 'SUPPORTING', state: 'queued' });
    }
    setFiles([...files, ...next]);
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); };
  async function save(submit: boolean) {
    setBusy(true); setErrs({}); let fid = id;
    try {
      const body = { ...f, amount: Number(f.amount), replacesId: renew || f.replacesId || undefined };
      delete body.id; if (id) await api(`/fdrs/${id}`, { method: 'PUT', body }); else fid = (await api('/fdrs', { body })).id;
      const upd = [...files];
      for (let i = 0; i < upd.length; i++) {
        if (upd[i].state === 'done') continue; upd[i] = { ...upd[i], state: 'uploading' }; setFiles([...upd]);
        const form = new FormData(); form.append('kind', upd[i].kind); form.append('file', upd[i].file);
        try { await api(`/fdrs/${fid}/documents`, { form }); upd[i] = { ...upd[i], state: 'done' }; } catch (x) { upd[i] = { ...upd[i], state: 'error', msg: (x as Error).message }; }
        setFiles([...upd]);
      }
      if (upd.some((u) => u.state === 'error')) { toast('err', 'Saved, but some files failed. Fix them below and save again.'); if (!id) nav(`/fdrs/${fid}/edit`, { replace: true }); return; }
      if (submit) { await api(`/fdrs/${fid}/transition`, { body: { to: 'SUBMITTED' } }); toast('ok', 'Submitted for scrutiny'); } else toast('ok', 'Draft saved');
      nav(`/fdrs/${fid}`);
    } catch (x) {
      if (x instanceof ApiError && x.fields) setErrs(x.fields);
      toast('err', (x as Error).message); if (fid && !id) nav(`/fdrs/${fid}/edit`, { replace: true });
    } finally { setBusy(false); }
  }
  if (!ready) return <Spinner />;
  const T = (k: string, l: string, p: any = {}) => <Field label={l} error={errs[k]}><input className="input" value={f[k] ?? ''} onChange={set(k)} {...p} /></Field>;
  return <>
    <PageHeader title={id ? 'Edit FDR application' : renew ? 'Renewal / replacement FDR' : 'New FDR application'} sub={renew ? 'This FDR will be linked to the original instrument.' : 'Fields declared here are institution-submitted and are not treated as verified.'} />
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="card grid gap-4 p-5 md:grid-cols-2 lg:col-span-2">
        {T('aicteRef', 'AICTE application / reference no.')}{T('fdrNumber', 'FDR number')}{T('bank', 'Issuing bank')}{T('branch', 'Branch')}
        {T('amount', 'Amount (₹)', { type: 'number', min: 1 })}{T('beneficiary', 'Beneficiary')}
        {T('issueDate', 'Issue date', { type: 'date' })}{T('maturityDate', 'Maturity date', { type: 'date' })}{T('validityDate', 'Validity date', { type: 'date' })}
        <div className="md:col-span-2">{T('purpose', 'Purpose')}</div>
        <div className="md:col-span-2"><Field label="Remarks (optional)" error={errs.remarks}><textarea className="input" rows={3} value={f.remarks} onChange={set('remarks')} /></Field></div>
      </div>
      <div className="card p-5"><h3 className="mb-3 font-semibold text-brand-900">Documents</h3>
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop} onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
          className={`flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed p-6 text-center ${drag ? 'border-accent-500 bg-amber-50' : 'border-slate-300 hover:bg-slate-50'}`}>
          <FileUp className="mb-2 text-brand-600" /><p className="text-sm font-medium">Drag & drop or click to choose</p><p className="text-xs text-slate-500">PDF, PNG, JPEG · max 5 MB each</p>
          <input ref={input} type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} /></div>
        <ul className="mt-3 space-y-2">{files.map((s, i) => <li key={i} className="rounded-lg border border-slate-200 p-2 text-sm"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{s.file.name}</span>
          {s.state === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-brand-600" />}{s.state === 'done' && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}{s.state === 'error' && <XCircle className="h-4 w-4 text-red-600" />}
          {s.state !== 'done' && <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4 text-slate-400" /></button>}</div>
          <select className="input mt-1 !py-1 text-xs" value={s.kind} disabled={s.state === 'done'} onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <p className="mt-1 text-xs text-slate-400">{(s.file.size / 1024).toFixed(0)} KB · {s.state}{s.msg ? ` · ${s.msg}` : ''}</p></li>)}</ul>
        {id && <p className="mt-3 text-xs text-slate-500">Previously uploaded files are listed on the FDR detail page.</p>}
        <div className="mt-5 flex flex-col gap-2"><button className="btn-primary" disabled={busy} onClick={() => save(true)}>{busy ? 'Working…' : 'Submit for scrutiny'}</button><button className="btn-ghost" disabled={busy} onClick={() => save(false)}>Save as draft</button></div>
        <p className="mt-3 text-xs text-slate-400">Submission requires at least one FDR document.</p></div>
    </div></>;
}
