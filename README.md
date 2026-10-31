# Smart FDR Intelligence
AICTE-style Security Deposit / FDR management prototype: institution submissions, officer scrutiny, manual verification, lifecycle tracking, maturity alerts, renewals, release requests, dashboards, CSV export and an audit trail.

> **Prototype with synthetic data. Not an official AICTE or government system.** No bank, AI, email/SMS or government integration exists. Demo credentials are for local use only.

## Stack
Express + TypeScript API (`apps/api`, plain SQL via `pg`, PostgreSQL) · React + Vite + Tailwind + Recharts (`apps/web`).
Note: the originally committed manifest listed Prisma; this build uses `pg` + SQL (`apps/api/src/schema.ts`) so the code could be tested end-to-end offline. Dates are stored as ISO text.

## Setup (Node 20+, Docker)
    docker compose up -d
    npm install
    cp apps/api/.env.example apps/api/.env   # set JWT_SECRET for anything beyond local demo
    npm run db:push      # creates tables
    npm run seed         # synthetic demo data (wipes demo tables; refuses in production)
    npm run dev:api      # terminal 1 -> http://localhost:4000
    npm run dev:web      # terminal 2 -> http://localhost:5173

Checks: `npm run typecheck` · `npm test` · `npm run build`

## Demo accounts (password `Demo@12345`, created by `npm run seed`)
| Role | Email |
|---|---|
| Super Admin | admin@demo.local |
| AICTE Scrutiny Officer | officer@demo.local |
| Bank / Verification Officer (limited) | bank@demo.local |
| Institution Admin (Demo Institute of Technology) | inst1@demo.local |
| Institution Admin (Sample College of Engineering) | inst2@demo.local |

New institutions can self-register. Officer, Bank and Super Admin accounts can only be issued by a Super Admin (Admin page); the server rejects other roles at registration.

## Features
- **Auth/RBAC**: bcrypt, HttpOnly JWT cookie, rate-limited login, server-side role checks, institution scoping (other institutions' records return 404), bank verifier sees only verification-stage FDRs, custom-header CSRF check on writes.
- **Institution portal**: profile, FDR application (all required fields), drag-and-drop uploads with type/size validation and per-file status, draft/submit, correction → resubmit, search/filter/sort/pagination, status history.
- **Lifecycle**: Draft → Submitted → Under Scrutiny → (Correction Requested) → Verification Pending → Verified / Discrepancy Found → Approved / Rejected → Renewal Due / Renewed / Expired → Release Requested → Released. Only valid transitions per role; every change records who/when/remarks.
- **Officer portal**: KPI dashboard + charts (status, bank, institution, maturity, amount bands), observations/flags/correction requests, approve/reject with remarks, automated rule checks (missing docs, expiry, date/amount mismatch, reused FDR number), submitted data shown separately from verified data.
- **Verification**: manual authorised verification with source, reference, verifier, date, remarks. A "Verified" outcome is refused if values differ from the submission. `apps/api/src/verification.ts` is the adapter interface for a future bank API (currently "not configured").
- **Alerts**: configurable reminder days (default 30/15/7/1), automatic Renewal Due / Expired moves, overdue-scrutiny and missing-document alerts, de-duplicated in-app history. Email/SMS is **not implemented** and is labelled "unavailable (demo)".
- **Renewal**: replacement FDR linked to the original; approving it marks the original Renewed.
- **Release**: request with reason, clarification loop, approve/reject with mandatory remarks. Records decisions only; no funds are moved.
- **Reports/audit**: filtered CSV export (formula-injection safe, audited), searchable audit log, per-FDR timeline.
- **Files**: PDF/PNG/JPEG only, 5 MB, content-sniffed, SHA-256, stored under random names outside any public path, downloadable only through an authorised endpoint.

## Test scenarios
`apps/api/test/flow.test.ts` automates all nine scenarios from the brief (register/submit, correction loop, verification mismatch/discrepancy, upcoming maturity + alert scan, renewal link, release flow, cross-institution access denial, search/filter/CSV/history). `seed.test.ts` checks the demo data.

## Environment variables (`apps/api/.env.example`)
`PORT`, `DATABASE_URL`, `JWT_SECRET` (required when `NODE_ENV=production`), `COOKIE_SECURE`, `WEB_ORIGIN`, `STORAGE_DIR`, `MAX_UPLOAD_MB`. No secrets are committed.

## Screenshots
Run both servers, sign in as each demo role and capture: Dashboard (officer), FDR Register with filters, FDR detail → Overview (submitted vs verified), Verification tab, Release Requests, Alerts, Audit log.

## Known limitations
- Single-process alert scan (runs at start and every 6 h, or via "Run scan now"); no email/SMS, no real bank API, no malware scanning of uploads, files on local disk (use object storage in production), no PDF export, no password reset or MFA, dashboard aggregates are computed in memory (fine for thousands of rows, not millions). Dates use UTC.
- Frontend has no automated tests; it was type-checked and production-built but not browser-tested in this environment.
- Risk rules and reminder periods are demonstration policy, not AICTE-validated.
