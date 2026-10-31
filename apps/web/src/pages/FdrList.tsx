import { ArrowDownUp, Download, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { isStaff, useAuth } from '../auth';
import { Badge, Empty, PageHeader, Pagination, Spinner, fmtDate, inr, label } from '../ui';

const STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'CORRECTION_REQUESTED', 'VERIFICATION_PENDING', 'VERIFIED', 'DISCREPANCY_FOUND', 'APPROVED', 'REJECTED', 'RENEWAL_DUE', 'RENEWED', 'EXPIRED', 'RELEASE_REQUESTED', 'RELEASED'];
export default function FdrList() {
  const { user } = useAuth(); const nav = useNavigate(); const [sp] = useSearchParams();
  const [f, setF] = useState<any>({ q: '', status: '', bank: '', institutionId: sp.get('institutionId') || '', minAmount: '', maxAmount: '', maturityFrom: '', maturityTo: '', sort: 'createdAt', dir: 'desc', page: 1, pageSize: 10 });
  const [data, setData] = useState<any>(null); const [insts, setInsts] = useState<any[]>([]); const [err, setErr] = useState('');
  useEffect(() => { if (isStaff(user!.role)) api('/institutions').then((r) => setInsts(r.items)).catch(() => undefined); }, [user]);
  useEffect(() => { const t = setTimeout(() => { setErr(''); api('/fdrs?' + qs(f)).then(setData).catch((e) => setErr(e.message)); }, 250); return () => clearTimeout(t); }, [f]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value, page: 1 });
  const sortBy = (k: string) => setF({ ...f, sort: k, dir: f.sort === k && f.dir === 'asc' ? 'desc' : 'asc', page: 1 });
  const Th = ({ k, children }: any) => <th className="th"><button className="inline-flex items-center gap-1" onClick={() => sortBy(k)}>{children}<ArrowDownUp size={12} className={f.sort === k ? 'text-brand-700' : 'text-slate-300'} /></button></th>;
  const exportUrl = '/api/fdrs/export.csv?' + qs({ ...f, page: '', pageSize: '' });
  return <>
    <PageHeader title="FDR Register" sub="Search, filter and export instrument-wise records">
      {user!.role !== 'BANK_VERIFIER' && <a className="btn-ghost" href={exportUrl}><Download size={16} />Export CSV</a>}
      {user!.role === 'INSTITUTION_ADMIN' && <Link to="/fdrs/new" className="btn-accent">New FDR</Link>}</PageHeader>
    <div className="card mb-4 grid gap-3 p-4 md:grid-cols-4">
      <div className="relative md:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input pl-9" placeholder="Search FDR no., AICTE ref, bank, institution…" value={f.q} onChange={set('q')} aria-label="Search" /></div>
      <select className="input" value={f.status} onChange={set('status')} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      <input className="input" placeholder="Bank (exact name)" value={f.bank} onChange={set('bank')} />
      {isStaff(user!.role) && <select className="input" value={f.institutionId} onChange={set('institutionId')} aria-label="Institution"><option value="">All institutions</option>{insts.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>}
      <input className="input" type="number" placeholder="Min amount ₹" value={f.minAmount} onChange={set('minAmount')} /><input className="input" type="number" placeholder="Max amount ₹" value={f.maxAmount} onChange={set('maxAmount')} />
      <div><input className="input" type="date" title="Maturity from" value={f.maturityFrom} onChange={set('maturityFrom')} /></div><div><input className="input" type="date" title="Maturity to" value={f.maturityTo} onChange={set('maturityTo')} /></div>
    </div>
    <div className="card overflow-x-auto">{err ? <Empty title="Could not load records" hint={err} /> : !data ? <Spinner /> : data.items.length === 0 ? <Empty title="No FDRs match your filters" hint="Try clearing filters or creating a new application." /> :
      <table className="w-full min-w-[900px]"><thead className="bg-slate-50"><tr><Th k="fdrNumber">FDR No.</Th>{user!.role !== 'INSTITUTION_ADMIN' && <Th k="institution">Institution</Th>}<Th k="bank">Bank</Th><Th k="amount">Amount</Th><Th k="maturityDate">Maturity</Th><Th k="status">Status</Th><th className="th">Verification</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{data.items.map((x: any) => <tr key={x.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/fdrs/${x.id}`)}>
          <td className="td font-medium text-brand-700">{x.fdrNumber}<p className="text-xs font-normal text-slate-400">{x.aicteRef}</p></td>{user!.role !== 'INSTITUTION_ADMIN' && <td className="td">{x.institutionName}</td>}
          <td className="td">{x.bank}<p className="text-xs text-slate-400">{x.branch}</p></td><td className="td font-medium">{inr(x.amount)}</td>
          <td className="td">{fmtDate(x.maturityDate)}{['APPROVED', 'RENEWAL_DUE'].includes(x.status) && <p className={`text-xs ${x.daysToMaturity <= 30 ? 'text-orange-600' : 'text-slate-400'}`}>{x.daysToMaturity} days</p>}</td>
          <td className="td"><Badge v={x.status} /></td><td className="td"><Badge v={x.verificationStatus} /></td></tr>)}</tbody></table>}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setF({ ...f, page })} />}</div></>;
}
