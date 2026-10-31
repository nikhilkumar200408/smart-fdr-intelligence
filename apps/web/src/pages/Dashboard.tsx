import { AlertTriangle, Banknote, CalendarClock, ClipboardCheck, FileText, Hourglass, RefreshCw, Undo2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ROLE_LABEL, isStaff, useAuth } from '../auth';
import { Badge, Empty, Kpi, PageHeader, Spinner, fmtDateTime, inr, inrShort, label } from '../ui';

const COLORS = ['#0f2a5e', '#2f5aa8', '#f59e0b', '#14b8a6', '#8b5cf6', '#ef4444', '#64748b', '#10b981'];
export default function Dashboard() {
  const { user } = useAuth(); const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { api('/dashboard').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <Empty title="Could not load dashboard" hint={err} />; if (!d) return <Spinner />;
  const k = d.kpis;
  return <>
    <PageHeader title="Dashboard" sub={`${ROLE_LABEL[user!.role]} view${user!.role === 'INSTITUTION_ADMIN' ? ' · your institution only' : ''}`}>
      {user!.role === 'INSTITUTION_ADMIN' && <Link to="/fdrs/new" className="btn-accent">New FDR application</Link>}</PageHeader>
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      <Kpi title="Total FDRs" value={k.totalFdrs} icon={<FileText size={20} />} />
      <Kpi title="Amount secured" value={inrShort(k.totalSecuredAmount)} icon={<Banknote size={20} />} tone="text-emerald-600" hint="Approved, renewal-due & release-requested" />
      <Kpi title="Pending scrutiny" value={k.pendingScrutiny} icon={<ClipboardCheck size={20} />} tone="text-indigo-600" />
      <Kpi title="Verification pending" value={k.verificationPending} icon={<Hourglass size={20} />} tone="text-violet-600" />
      <Kpi title="Discrepancies" value={k.discrepancies} icon={<AlertTriangle size={20} />} tone="text-red-600" />
      <Kpi title="Maturing ≤ 30 days" value={k.upcomingMaturities} icon={<CalendarClock size={20} />} tone="text-orange-600" />
      <Kpi title="Expired" value={k.expired} icon={<XCircle size={20} />} tone="text-rose-600" />
      <Kpi title="Renewals due" value={k.renewalsDue} icon={<RefreshCw size={20} />} tone="text-amber-600" />
      <Kpi title="Release requests" value={k.releaseRequests} icon={<Undo2 size={20} />} tone="text-fuchsia-600" />
      {user!.role === 'INSTITUTION_ADMIN' && <Kpi title="Needs your action" value={k.correctionRequested + k.drafts} icon={<ClipboardCheck size={20} />} tone="text-amber-600" hint="Drafts + corrections requested" />}
    </div>
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <div className="card p-5"><h3 className="mb-3 font-semibold text-brand-900">FDRs by status</h3><div className="h-64">
        {d.byStatus.length ? <ResponsiveContainer><PieChart><Pie data={d.byStatus} dataKey="count" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>{d.byStatus.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip formatter={(v: any, n: any) => [v, label(String(n))]} /></PieChart></ResponsiveContainer> : <Empty title="No data yet" />}</div>
        <div className="mt-2 flex flex-wrap gap-2">{d.byStatus.map((s: any) => <span key={s.name} className="text-xs text-slate-600"><b>{s.count}</b> {label(s.name)}</span>)}</div></div>
      <div className="card p-5"><h3 className="mb-3 font-semibold text-brand-900">Maturity profile (active FDRs)</h3><div className="h-64"><ResponsiveContainer><BarChart data={d.maturityBuckets}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
      <div className="card p-5"><h3 className="mb-3 font-semibold text-brand-900">Secured amount by bank</h3><div className="h-64"><ResponsiveContainer><BarChart data={d.byBank} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" fontSize={12} tickFormatter={(v) => inrShort(v)} /><YAxis dataKey="name" type="category" fontSize={11} width={120} /><Tooltip formatter={(v: any) => inr(v)} /><Bar dataKey="amount" fill="#2f5aa8" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div></div>
      <div className="card p-5"><h3 className="mb-3 font-semibold text-brand-900">FDRs by amount band</h3><div className="h-64"><ResponsiveContainer><BarChart data={d.amountBuckets}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Bar dataKey="count" fill="#0f2a5e" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
      {isStaff(user!.role) && <div className="card p-5 lg:col-span-2"><h3 className="mb-3 font-semibold text-brand-900">Institution-wise amount</h3><div className="h-64"><ResponsiveContainer><BarChart data={d.byInstitution}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={11} /><YAxis fontSize={12} tickFormatter={(v) => inrShort(v)} /><Tooltip formatter={(v: any) => inr(v)} /><Bar dataKey="amount" fill="#14b8a6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></div>}
      <div className="card overflow-hidden"><div className="p-5 pb-2"><h3 className="font-semibold text-brand-900">Upcoming maturities (≤ 60 days)</h3></div>
        {d.upcoming.length === 0 ? <Empty title="Nothing maturing soon" /> : <table className="w-full"><tbody className="divide-y divide-slate-100">{d.upcoming.map((x: any) => <tr key={x.id}><td className="td"><Link className="font-medium text-brand-700 hover:underline" to={`/fdrs/${x.id}`}>{x.fdrNumber}</Link><p className="text-xs text-slate-500">{x.institutionName}</p></td><td className="td">{inr(x.amount)}</td><td className="td"><Badge v={x.daysToMaturity < 0 ? 'EXPIRED' : 'RENEWAL_DUE'} text={x.daysToMaturity < 0 ? 'Overdue' : `${x.daysToMaturity} days`} /></td></tr>)}</tbody></table>}</div>
      <div className="card p-5"><h3 className="mb-3 font-semibold text-brand-900">Recent activity</h3>{d.recent.length === 0 ? <Empty title="No activity yet" /> : <ul className="space-y-3">{d.recent.map((a: any, i: number) => <li key={i} className="flex gap-3 text-sm"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent-500" /><div><p className="text-slate-800">{label(a.action)} <span className="text-slate-500">by {a.by}</span></p><p className="text-xs text-slate-400">{fmtDateTime(a.at)}</p></div></li>)}</ul>}</div>
    </div></>;
}
