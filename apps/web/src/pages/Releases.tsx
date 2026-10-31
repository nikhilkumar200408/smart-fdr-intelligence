import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, Field, Modal, PageHeader, Spinner, fmtDateTime, inr, useToast } from '../ui';

export default function Releases() {
  const { user } = useAuth(); const toast = useToast(); const staff = user!.role !== 'INSTITUTION_ADMIN';
  const [items, setItems] = useState<any[] | null>(null); const [m, setM] = useState<{ r: any; action: string } | null>(null); const [text, setText] = useState('');
  const load = useCallback(() => api('/releases').then((r) => setItems(r.items)).catch((e) => toast('err', e.message)), []);
  useEffect(() => { load(); }, [load]);
  async function go() {
    try { if (m!.action === 'RESPOND') await api(`/releases/${m!.r.id}/respond`, { body: { message: text } }); else await api(`/releases/${m!.r.id}/decision`, { body: { action: m!.action, remarks: text } }); toast('ok', 'Recorded'); setM(null); setText(''); load(); } catch (e) { toast('err', (e as Error).message); }
  }
  if (!items) return <Spinner />;
  return <><PageHeader title="Release requests" sub="Discharge of security deposits — decisions are recorded only; this system never moves funds" />
    <div className="card overflow-x-auto">{items.length === 0 ? <Empty title="No release requests" /> : <table className="w-full min-w-[800px]"><thead className="bg-slate-50"><tr><th className="th">FDR</th>{staff && <th className="th">Institution</th>}<th className="th">Amount</th><th className="th">Reason</th><th className="th">Status</th><th className="th">Requested</th><th className="th" /></tr></thead><tbody className="divide-y divide-slate-100">
      {items.map((r) => <tr key={r.id}><td className="td"><Link className="font-medium text-brand-700 hover:underline" to={`/fdrs/${r.fdrId}`}>{r.fdrNumber}</Link></td>{staff && <td className="td">{r.institutionName}</td>}<td className="td">{inr(r.amount)}</td><td className="td max-w-xs truncate" title={r.reason}>{r.reason}</td><td className="td"><Badge v={r.status} /></td><td className="td">{fmtDateTime(r.requestedAt)}</td>
        <td className="td text-right whitespace-nowrap">{staff && r.status === 'PENDING' && <><button className="btn-ghost mr-1" onClick={() => setM({ r, action: 'CLARIFY' })}>Clarify</button><button className="btn-primary mr-1" onClick={() => setM({ r, action: 'APPROVE' })}>Approve</button><button className="btn-danger" onClick={() => setM({ r, action: 'REJECT' })}>Reject</button></>}
          {!staff && r.status === 'CLARIFICATION_REQUESTED' && <button className="btn-accent" onClick={() => setM({ r, action: 'RESPOND' })}>Respond</button>}</td></tr>)}</tbody></table>}</div>
    {m && <Modal title={m.action === 'RESPOND' ? 'Respond to clarification' : `${m.action[0] + m.action.slice(1).toLowerCase()} release of ${m.r.fdrNumber}`} onClose={() => setM(null)}>
      {m.r.officerNote && m.action === 'RESPOND' && <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-900">AICTE asked: {m.r.officerNote}</p>}
      <Field label={m.action === 'RESPOND' ? 'Your response' : 'Remarks (required)'}><textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setM(null)}>Cancel</button><button className="btn-primary" onClick={go}>Confirm</button></div></Modal>}</>;
}
