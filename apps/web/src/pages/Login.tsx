import { ShieldCheck } from 'lucide-react';
import { FormEvent, ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api';
import { useAuth } from '../auth';
import { Field, useToast } from '../ui';

const DEMO = [['Super Admin', 'admin@demo.local'], ['AICTE Officer', 'officer@demo.local'], ['Bank Verifier', 'bank@demo.local'], ['Institution 1', 'inst1@demo.local'], ['Institution 2', 'inst2@demo.local']];
function Frame({ title, children }: { title: string; children: ReactNode }) {
  return <div className="grid min-h-screen lg:grid-cols-2">
    <div className="hidden flex-col justify-between bg-gradient-to-br from-brand-900 to-brand-700 p-12 text-white lg:flex">
      <div className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="text-accent-400" />Smart FDR Intelligence</div>
      <div><h2 className="text-4xl font-bold leading-tight">One register for every security deposit.</h2><p className="mt-4 max-w-md text-slate-200">Institution-wise and instrument-wise FDR tracking with scrutiny, manual verification, maturity alerts, renewals, release workflow and a full audit trail.</p></div>
      <p className="text-xs text-slate-300">Hackathon prototype · synthetic data · not an official AICTE or government system.</p></div>
    <div className="flex items-center justify-center p-6"><div className="w-full max-w-md"><h1 className="mb-6 text-2xl font-bold text-brand-900">{title}</h1>{children}</div></div></div>;
}
export function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const { setUser } = useAuth(); const toast = useToast(); const nav = useNavigate();
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); try { setUser((await api('/auth/login', { body: { email, password } })).user); nav('/'); } catch (x) { toast('err', (x as Error).message); } finally { setBusy(false); } }
  return <Frame title="Sign in">
    <form onSubmit={submit} className="space-y-4"><Field label="Email"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></Field>
      <Field label="Password"><input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form>
    <p className="mt-4 text-sm text-slate-600">New institution? <Link className="font-semibold text-brand-700 underline" to="/register">Register here</Link></p>
    <div className="card mt-6 p-4"><p className="mb-2 text-xs font-semibold uppercase text-slate-500">Demo accounts (password: Demo@12345)</p><div className="flex flex-wrap gap-2">
      {DEMO.map(([n, e]) => <button key={e} type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => { setEmail(e); setPassword('Demo@12345'); }}>{n}</button>)}</div>
      <p className="mt-2 text-xs text-slate-500">Demo credentials for a local prototype only. Not production-secure.</p></div></Frame>;
}
export function Register() {
  const [f, setF] = useState<any>({ role: 'INSTITUTION_ADMIN' }); const [errs, setErrs] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const { setUser } = useAuth(); const toast = useToast(); const nav = useNavigate();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setErrs({}); try { setUser((await api('/auth/register', { body: f })).user); toast('ok', 'Account created'); nav('/'); } catch (x) { if (x instanceof ApiError && x.fields) setErrs(x.fields); toast('err', (x as Error).message); } finally { setBusy(false); } }
  return <Frame title="Register your institution">
    <form onSubmit={submit} className="space-y-3">
      <Field label="Account type"><select className="input" value={f.role} onChange={set('role')}><option value="INSTITUTION_ADMIN">Institution Admin</option><option value="AICTE_OFFICER">AICTE Officer (issued by Super Admin)</option><option value="BANK_VERIFIER">Bank / Verification Officer (issued by Super Admin)</option><option value="SUPER_ADMIN">Super Admin (issued by Super Admin)</option></select>
        {f.role !== 'INSTITUTION_ADMIN' && <p className="mt-1 text-xs text-amber-700">Only Institution Admin accounts can self-register; this will be rejected by the server.</p>}</Field>
      <Field label="Your name" error={errs.name}><input className="input" required onChange={set('name')} /></Field>
      <Field label="Email" error={errs.email}><input className="input" type="email" required onChange={set('email')} /></Field>
      <Field label="Password (min 10 chars, letter + digit)" error={errs.password}><input className="input" type="password" required onChange={set('password')} autoComplete="new-password" /></Field>
      <Field label="Institution name" error={errs.institutionName}><input className="input" required onChange={set('institutionName')} /></Field>
      <Field label="AICTE institution ID" error={errs.aicteId}><input className="input" required onChange={set('aicteId')} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="City"><input className="input" onChange={set('city')} /></Field><Field label="State"><input className="input" onChange={set('state')} /></Field></div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button></form>
    <p className="mt-4 text-sm text-slate-600">Already registered? <Link className="font-semibold text-brand-700 underline" to="/">Sign in</Link></p></Frame>;
}
