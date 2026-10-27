# Smart FDR Intelligence & Risk Monitoring System (Parts 1+2)
Prototype with synthetic data. Not an official AICTE system.

## Setup (Mac, Node 20+, Docker)
    docker compose up -d
    npm install
    npm run db:push   # re-run after updating to Part 2 (adds document and release tables)
    npm run seed
    npm run dev:api      # terminal 1 -> http://localhost:4000
    npm run dev:web      # terminal 2 -> http://localhost:5173

## Demo accounts (password: Demo@12345)
admin@demo.local (SUPER_ADMIN), officer@demo.local (AICTE_OFFICER), auditor@demo.local (AUDITOR),
bank@demo.local (BANK_VERIFIER), inst1@demo.local / inst2@demo.local (INSTITUTION_ADMIN)

## Implemented
Cookie auth (bcrypt, HttpOnly JWT), server-side RBAC and institution scoping, FDR submit/list/detail,
validated lifecycle transitions with mandatory reason + append-only events, replacement linking,
collision detection (normalized ref, doc hash) with resolve workflow, explainable weighted risk score,
dashboard from DB, reminder job (30/15/7/1 days, de-duplicated), in-app alerts, audit log.

## Part 2 additions
Document upload (type/signature/size checks, SHA-256, versions, private storage, authorized download),
OCR via local Tesseract (per-field confidence, mismatch + low-confidence review, corrections with mandatory reason, retry),
release workflow (eligibility checks, officer recommend, different super-admin approves, timeline),
Ask-AICTE (fixed parser), What-If simulator (read-only), CSV import (preview/commit, row errors, unverified),
reports + audited CSV export, relationship graph (recorded vs suspected edges), unit tests (`npm -w apps/api run test`).

OCR setup (macOS): `brew install tesseract poppler`. Without them uploads still work and the document is marked
OCR UNAVAILABLE for manual review; no fake extraction is ever shown.

## Still not implemented
Renewal-gap rules UI, configurable settings page (weights/SLAs are code defaults), user/institution management pages,
scheduled escalation, email delivery, SLA/bottleneck dashboard, evaluation page, Supertest API tests, CSRF tokens (SameSite=Lax only).
All risk weights and SLAs are demonstration policy, not AICTE-validated.
