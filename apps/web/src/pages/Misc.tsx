import { Bell, CheckCheck, ScanLine } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, qs } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, Field, PageHeader, Pagination, Spinner, fmtDateTime, inr, label, useToast } from '../ui';

export function Alerts() {
  const { user } = useAuth(); const toast = useToast(); const [d, setD] = useState<any>(null);
  const load = useCallback(() => api('/notifications').then(setD), []); useEffect(() => { load(); }, [load]);
  if (!d) return <Spinner />;
  return <><PageHeader title="Alerts & notifications" sub={`${d.unread} unread · full alert history`}>
    {user!.role !== 'INSTITUTION_ADMIN' && <button className="btn-ghost" onClick={async () => { const r = await api('/alerts/scan', { method: 'POST', body: {} }); toast('ok', `Scan complete: ${r.created} new alert(s), ${r.moved} status update(s)`); load(); }}><ScanLine size={16} />Run scan now</button>}
    <button className="btn-ghost" onClick={async () => { await api('/notifications/read-all', { method: 'POST', body: {} }); load(); }}><CheckCheck size={16} />Mark all read</button></PageHeader>
    <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{d.externalDelivery} External delivery status for every alert: <b>unavailable (demo)</b>.</p>
    <div className="card divide-y divide-slate-100">{d.items.length === 0 ? <Empty title="No alerts yet" /> : d.items.map((n: any) => <div key={n.id} className={`flex gap-3 p-4 ${n.read ? '' : 'bg-brand-50/60'}`}><Bell className={`mt-0.5 h-5 w-5 shrink-0 ${n.read ? 'text-slate-300' : 'text-accent-600'}`} />
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-800">{n.title}</p><Badge v="LOW" text={label(n.type)} /></div><p className="text-sm text-slate-600">{n.message}</p><p className="mt-1 text-xs text-slate-400">{fmtDateTime(n.createdAt)} · email/SMS: unavailable (demo)</p></div>
      <div className="flex shrink-0 flex-col items-end gap-1">{n.fdrId && <Link className="text-sm text-brand-700 underline" to={`/fdrs/${n.fdrId}`} onClick={() => api(`/notifications/${n.id}/read`, { method: 'POST', body: {} })}>Open FDR</Link>}{!n.read && <button className="text-xs text-slate-500 underline" onClick={async () => { await api(`/notifications/${n.id}/read`, { method: 'POST', body: {} }); load(); }}>Mark read</button>}</div></div>)}</div></>;
}

export function Audit() {
  const [f, setF] = useState<any>({ q: '', action: '', page: 1, pageSize: 20 }); const [d, setD] = useState<any>(null);
  useEffect(() => { const t = setTimeout(() => api('/audit?' + qs(f)).then(setD), 250); return () => clearTimeout(t); }, [f]);
  return <><PageHeader title="Audit log" sub="Append-only record of important actions" />
    <div className="card mb-4 grid gap-3 p-4 md:grid-cols-2"><input className="input" placeholder="Search by user or details…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} /><input className="input" placeholder="Exact action, e.g. CSV_EXPORT" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value.toUpperCase(), page: 1 })} /></div>
    <div className="card overflow-x-auto">{!d ? <Spinner /> : d.items.length === 0 ? <Empty title="No audit entries match" /> : <table className="w-full min-w-[700px]"><thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Details</th></tr></thead><tbody className="divide-y divide-slate-100">
      {d.items.map((a: any) => <tr key={a.id}><td className="td whitespace-nowrap">{fmtDateTime(a.at)}</td><td className="td">{a.by}<p className="text-xs text-slate-400">{label(a.role)}</p></td><td className="td">{label(a.action)}{a.entityId && a.entity === 'fdr' && <Link className="ml-2 text-xs text-brand-700 underline" to={`/fdrs/${a.entityId}`}>open</Link>}</td><td className="td max-w-sm truncate font-mono text-xs text-slate-500" title={JSON.stringify(a.details)}>{a.details ? JSON.stringify(a.details) : '—'}</td></tr>)}</tbody></table>}
      {d && <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={(page) => setF({ ...f, page })} />}</div></>;
}

export function Institutions() {
  const [items, setItems] = useState<any[] | null>(null); useEffect(() => { api('/institutions').then((r) => setItems(r.items)); }, []);
  if (!items) return <Spinner />;
  return <><PageHeader title="Institutions" sub="Institution-wise summary" /><div className="card overflow-x-auto"><table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Institution</th><th className="th">AICTE ID</th><th className="th">Location</th><th className="th">FDRs</th><th className="th">Secured</th><th className="th" /></tr></thead><tbody className="divide-y divide-slate-100">
    {items.map((i) => <tr key={i.id}><td className="td font-medium">{i.name}</td><td className="td">{i.aicteId}</td><td className="td">{[i.city, i.state].filter(Boolean).join(', ') || '—'}</td><td className="td">{i.fdrs}</td><td className="td">{inr(i.secured)}</td><td className="td text-right"><Link className="btn-ghost" to={`/fdrs?institutionId=${i.id}`}>View register</Link></td></tr>)}</tbody></table></div></>;
}

export function Profile() {
  const toast = useToast(); const [f, setF] = useState<any>(null); const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { api('/institution/me').then(setF); }, []);
  async function save(e: FormEvent) { e.preventDefault(); setErrs({}); try { await api('/institution/me', { method: 'PUT', body: { city: f.city || '', state: f.state || '', contactEmail: f.contactEmail || '', contactPhone: f.contactPhone || '' } }); toast('ok', 'Profile saved'); } catch (x) { if (x instanceof ApiError && x.fields) setErrs(x.fields); toast('err', (x as Error).message); } }
  if (!f) return <Spinner />; const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return <><PageHeader title="Institution profile" /><form onSubmit={save} className="card grid max-w-2xl gap-4 p-5 md:grid-cols-2">
    <Field label="Institution name"><input className="input bg-slate-50" value={f.name} disabled /></Field><Field label="AICTE ID"><input className="input bg-slate-50" value={f.aicteId} disabled /></Field>
    <Field label="City"><input className="input" value={f.city || ''} onChange={set('city')} /></Field><Field label="State"><input className="input" value={f.state || ''} onChange={set('state')} /></Field>
    <Field label="Contact email" error={errs.contactEmail}><input className="input" value={f.contactEmail || ''} onChange={set('contactEmail')} /></Field><Field label="Contact phone" error={errs.contactPhone}><input className="input" value={f.contactPhone || ''} onChange={set('contactPhone')} /></Field>
    <div className="md:col-span-2"><button className="btn-primary">Save profile</button></div></form></>;
}
