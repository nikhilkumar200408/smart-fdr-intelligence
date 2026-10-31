import { AlertCircle, CheckCircle2, Inbox, Loader2, X } from 'lucide-react';
import { ReactNode, createContext, useCallback, useContext, useState } from 'react';

export const inr = (n: number | null | undefined) => (n === null || n === undefined ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 }));
export const inrShort = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : inr(n));
export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const label = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

const TONE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700', SUBMITTED: 'bg-blue-100 text-blue-800', UNDER_SCRUTINY: 'bg-indigo-100 text-indigo-800', CORRECTION_REQUESTED: 'bg-amber-100 text-amber-800',
  VERIFICATION_PENDING: 'bg-violet-100 text-violet-800', VERIFIED: 'bg-teal-100 text-teal-800', DISCREPANCY_FOUND: 'bg-red-100 text-red-800', APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800', RENEWAL_DUE: 'bg-orange-100 text-orange-800', RENEWED: 'bg-cyan-100 text-cyan-800', EXPIRED: 'bg-rose-100 text-rose-800',
  RELEASE_REQUESTED: 'bg-fuchsia-100 text-fuchsia-800', RELEASED: 'bg-slate-200 text-slate-800', HIGH: 'bg-red-100 text-red-800', MEDIUM: 'bg-amber-100 text-amber-800', LOW: 'bg-slate-100 text-slate-700',
  PENDING: 'bg-blue-100 text-blue-800', CLARIFICATION_REQUESTED: 'bg-amber-100 text-amber-800', NOT_VERIFIED: 'bg-slate-100 text-slate-600', DISCREPANCY: 'bg-red-100 text-red-800',
};
export const Badge = ({ v, text }: { v: string; text?: string }) => <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[v] || 'bg-slate-100 text-slate-700'}`}>{text || label(v)}</span>;

export const Spinner = ({ text = 'Loading…' }: { text?: string }) => <div className="flex items-center justify-center gap-2 py-16 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />{text}</div>;
export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <div className="flex flex-col items-center py-14 text-center"><Inbox className="mb-3 h-10 w-10 text-slate-300" /><p className="font-medium text-slate-700">{title}</p>{hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}{action && <div className="mt-4">{action}</div>}</div>);
export const PageHeader = ({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold text-brand-900">{title}</h1>{sub && <p className="text-sm text-slate-500">{sub}</p>}</div><div className="flex gap-2">{children}</div></div>);
export const Kpi = ({ title, value, icon, tone = 'text-brand-700', hint }: { title: string; value: ReactNode; icon: ReactNode; tone?: string; hint?: string }) => (
  <div className="card p-4"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p><span className={tone}>{icon}</span></div><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>{hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}</div>);
export const Field = ({ label, children, error }: { label: string; children: ReactNode; error?: string }) => (
  <div><label className="label">{label}</label>{children}{error && <p className="mt-1 flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3 w-3" />{error}</p>}</div>);
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600"><span>{total === 0 ? 'No records' : `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}`}</span>
    <div className="flex gap-2"><button className="btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><span className="self-center">Page {page}/{pages}</span><button className="btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></div></div>;
}
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true"><div className="card w-full max-w-lg p-5"><div className="mb-3 flex items-center justify-between"><h3 className="text-lg font-semibold text-brand-900">{title}</h3><button onClick={onClose} aria-label="Close"><X className="h-5 w-5 text-slate-400" /></button></div>{children}</div></div>;
}
type Toast = { id: number; kind: 'ok' | 'err'; text: string };
const ToastCtx = createContext<(kind: 'ok' | 'err', text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: 'ok' | 'err', text: string) => { const id = Date.now() + Math.random(); setItems((s) => [...s, { id, kind, text }]); setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4500); }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="fixed bottom-4 right-4 z-[60] space-y-2" aria-live="polite">{items.map((t) => <div key={t.id} className={`flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${t.kind === 'ok' ? 'bg-emerald-600' : 'bg-red-600'}`}>{t.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}{t.text}</div>)}</div></ToastCtx.Provider>;
}
