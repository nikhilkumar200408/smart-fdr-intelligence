import { ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';
export type Role = 'INSTITUTION_ADMIN' | 'AICTE_OFFICER' | 'BANK_VERIFIER' | 'SUPER_ADMIN';
export interface User { id: string; name: string; email: string; role: Role; institutionId: string | null }
export const ROLE_LABEL: Record<Role, string> = { INSTITUTION_ADMIN: 'Institution Admin', AICTE_OFFICER: 'Scrutiny / Regulation Officer', BANK_VERIFIER: 'Bank / Verification Officer', SUPER_ADMIN: 'Super Admin' };
export const isStaff = (r?: Role) => r === 'AICTE_OFFICER' || r === 'SUPER_ADMIN';
const Ctx = createContext<{ user: User | null; loading: boolean; setUser: (u: User | null) => void; logout: () => Promise<void> }>(null as any);
export const useAuth = () => useContext(Ctx);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { api('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  return <Ctx.Provider value={{ user, loading, setUser, logout: async () => { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined); setUser(null); } }}>{children}</Ctx.Provider>;
}
