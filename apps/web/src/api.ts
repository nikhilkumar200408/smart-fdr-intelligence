export class ApiError extends Error { constructor(public status: number, message: string, public fields?: Record<string, string>) { super(message); } }
export async function api<T = any>(url: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch('/api' + url, {
    method: opts.method || (opts.body || opts.form ? 'POST' : 'GET'), credentials: 'include',
    headers: { 'x-requested-with': 'fdr-web', ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText, data?.fields);
  return data as T;
}
export const qs = (o: Record<string, unknown>) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== '' && v !== undefined && v !== null) p.set(k, String(v)); }); return p.toString(); };
