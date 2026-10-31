import { Bell, Building2, FilePlus2, FileText, History, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, Undo2, UserCircle2 } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { ROLE_LABEL, Role, isStaff, useAuth } from './auth';
import Admin from './pages/Admin';
import { Alerts, Audit, Institutions, Profile } from './pages/Misc';
import Dashboard from './pages/Dashboard';
import FdrDetail from './pages/FdrDetail';
import FdrForm from './pages/FdrForm';
import FdrList from './pages/FdrList';
import { Login, Register } from './pages/Login';
import Releases from './pages/Releases';
import { Spinner } from './ui';

const NAV: { to: string; label: string; icon: ReactNode; roles: Role[] }[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} />, roles: ['INSTITUTION_ADMIN', 'AICTE_OFFICER', 'BANK_VERIFIER', 'SUPER_ADMIN'] },
  { to: '/fdrs', label: 'FDR Register', icon: <FileText size={18} />, roles: ['INSTITUTION_ADMIN', 'AICTE_OFFICER', 'BANK_VERIFIER', 'SUPER_ADMIN'] },
  { to: '/fdrs/new', label: 'New FDR', icon: <FilePlus2 size={18} />, roles: ['INSTITUTION_ADMIN'] },
  { to: '/releases', label: 'Release Requests', icon: <Undo2 size={18} />, roles: ['INSTITUTION_ADMIN', 'AICTE_OFFICER', 'SUPER_ADMIN'] },
  { to: '/alerts', label: 'Alerts', icon: <Bell size={18} />, roles: ['INSTITUTION_ADMIN', 'AICTE_OFFICER', 'SUPER_ADMIN'] },
  { to: '/institutions', label: 'Institutions', icon: <Building2 size={18} />, roles: ['AICTE_OFFICER', 'SUPER_ADMIN'] },
  { to: '/audit', label: 'Audit Log', icon: <History size={18} />, roles: ['AICTE_OFFICER', 'SUPER_ADMIN'] },
  { to: '/profile', label: 'Institution Profile', icon: <UserCircle2 size={18} />, roles: ['INSTITUTION_ADMIN'] },
  { to: '/admin', label: 'Admin', icon: <Settings size={18} />, roles: ['SUPER_ADMIN'] },
];

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth(); const [open, setOpen] = useState(false); const [unread, setUnread] = useState(0); const loc = useLocation();
  useEffect(() => { setOpen(false); if (user && user.role !== 'BANK_VERIFIER') api('/notifications').then((r) => setUnread(r.unread)).catch(() => undefined); }, [loc.pathname, user]);
  return (
    <div className="min-h-screen lg:flex">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 transform bg-brand-900 text-slate-200 transition lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-5"><ShieldCheck className="text-accent-400" /><div><p className="font-bold leading-tight text-white">Smart FDR Intelligence</p><p className="text-[11px] text-slate-400">Security deposit monitoring</p></div></div>
        <nav className="space-y-1 p-3">{NAV.filter((n) => n.roles.includes(user!.role)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/' || n.to === '/fdrs'} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${isActive ? 'bg-white/10 text-white' : 'hover:bg-white/5'}`}>
            {n.icon}{n.label}{n.to === '/alerts' && unread > 0 && <span className="ml-auto rounded-full bg-accent-500 px-2 text-xs font-bold text-brand-900">{unread}</span>}</NavLink>))}</nav>
        <p className="absolute bottom-3 left-0 right-0 px-5 text-[11px] leading-snug text-slate-400">Prototype with synthetic data. Not an official AICTE or government system.</p>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu /></button>
          <span className="hidden rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 lg:inline">DEMO MODE · synthetic data</span>
          <div className="flex items-center gap-3"><div className="text-right"><p className="text-sm font-semibold text-slate-800">{user!.name}</p><p className="text-xs text-slate-500">{ROLE_LABEL[user!.role]}</p></div>
            <button className="btn-ghost" onClick={logout}><LogOut size={16} />Sign out</button></div>
        </header>
        <main className="mx-auto max-w-7xl p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
const Guard = ({ roles, children }: { roles?: Role[]; children: ReactNode }) => { const { user } = useAuth(); return roles && !roles.includes(user!.role) ? <Navigate to="/" replace /> : <>{children}</>; };

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Routes><Route path="/register" element={<Register />} /><Route path="*" element={<Login />} /></Routes>;
  const staff = isStaff(user.role);
  return (
    <Shell><Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/fdrs" element={<FdrList />} />
      <Route path="/fdrs/new" element={<Guard roles={['INSTITUTION_ADMIN']}><FdrForm /></Guard>} />
      <Route path="/fdrs/:id/edit" element={<Guard roles={['INSTITUTION_ADMIN']}><FdrForm /></Guard>} />
      <Route path="/fdrs/:id" element={<FdrDetail />} />
      <Route path="/releases" element={<Guard roles={['INSTITUTION_ADMIN', 'AICTE_OFFICER', 'SUPER_ADMIN']}><Releases /></Guard>} />
      <Route path="/alerts" element={<Guard roles={['INSTITUTION_ADMIN', 'AICTE_OFFICER', 'SUPER_ADMIN']}><Alerts /></Guard>} />
      <Route path="/institutions" element={staff ? <Institutions /> : <Navigate to="/" />} />
      <Route path="/audit" element={staff ? <Audit /> : <Navigate to="/" />} />
      <Route path="/profile" element={<Guard roles={['INSTITUTION_ADMIN']}><Profile /></Guard>} />
      <Route path="/admin" element={<Guard roles={['SUPER_ADMIN']}><Admin /></Guard>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes></Shell>
  );
}
