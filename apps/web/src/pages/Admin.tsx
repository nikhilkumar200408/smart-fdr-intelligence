import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { ROLE_LABEL, Role } from '../auth';
import { Badge, Field, PageHeader, Spinner, useToast } from '../ui';

export default function Admin() {
  const toast = useToast(); const [users, setUsers] = useState<any[] | null>(null); const [s, setS] = useState<any>(null); const [days, setDays] = useState('');
  const [f, setF] = useState<any>({ role: 'AICTE_OFFICER' }); const [errs, setErrs] = useState<Record<string, string>>({});
  const load = useCallback(() => { api('/admin/users').then((r) => setUsers(r.items)); api('/settings').then((r) => { setS(r); setDays(r.reminderDays.join(', ')); }); }, []); useEffect(() => { load(); }, [load]);
  async function create(e: FormEvent) { e.preventDefault(); setErrs({}); try { await api('/admin/users', { body: f }); toast('ok', 'User created'); setF({ role: 'AICTE_OFFICER' }); load(); } catch (x) { if (x instanceof ApiError && x.fields) setErrs(x.fields); toast('err', (x as Error).message); } }
  async function save() { try { await api('/settings', { method: 'PUT', body: { reminderDays: days.split(',').map((x) => Number(x.trim())).filter(Boolean), scrutinySlaDays: Number(s.scrutinySlaDays) } }); toast('ok', 'Settings saved'); load(); } catch (x) { toast('err', (x as Error).message); } }
  if (!users || !s) return <Spinner />;
  return <><PageHeader title="Administration" sub="Issue staff accounts and configure reminder periods" />
    <div className="grid gap-6 lg:grid-cols-2"><div className="card p-5"><h3 className="mb-3 font-semibold text-brand-900">Alert settings</h3><div className="space-y-3">
      <Field label="Reminder days before maturity / validity (comma separated)"><input className="input" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
      <Field label="Scrutiny SLA (days)"><input className="input" type="number" value={s.scrutinySlaDays} onChange={(e) => setS({ ...s, scrutinySlaDays: e.target.value })} /></Field><button className="btn-primary" onClick={save}>Save settings</button></div></div>
      <form onSubmit={create} className="card grid gap-3 p-5"><h3 className="font-semibold text-brand-900">Create staff user</h3>
        <Field label="Name" error={errs.name}><input className="input" required value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Email" error={errs.email}><input className="input" type="email" required value={f.email || ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Temporary password" error={errs.password}><input className="input" type="password" required value={f.password || ''} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="Role"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{(['AICTE_OFFICER', 'BANK_VERIFIER', 'SUPER_ADMIN'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field><button className="btn-primary">Create user</button></form></div>
    <div className="card mt-6 overflow-x-auto"><table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Name</th><th className="th">Email</th><th className="th">Role</th><th className="th">Institution</th><th className="th">Status</th><th className="th" /></tr></thead><tbody className="divide-y divide-slate-100">
      {users.map((u) => <tr key={u.id}><td className="td">{u.name}</td><td className="td">{u.email}</td><td className="td">{ROLE_LABEL[u.role as Role]}</td><td className="td">{u.institution || '—'}</td><td className="td"><Badge v={u.active ? 'APPROVED' : 'REJECTED'} text={u.active ? 'Active' : 'Disabled'} /></td>
        <td className="td text-right"><button className="btn-ghost" onClick={async () => { try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); load(); } catch (x) { toast('err', (x as Error).message); } }}>{u.active ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table></div></>;
}
