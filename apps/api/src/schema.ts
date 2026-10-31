// Plain-SQL schema (PostgreSQL). Dates are stored as ISO text (YYYY-MM-DD / ISO timestamps).
export const SCHEMA = `
create table if not exists institutions(
  id text primary key, name text not null, aicte_id text not null unique, city text, state text,
  contact_email text, contact_phone text, created_at text not null);
create table if not exists users(
  id text primary key, email text not null unique, name text not null, password_hash text not null,
  role text not null, institution_id text references institutions(id), active boolean not null default true,
  created_at text not null);
create table if not exists fdrs(
  id text primary key, institution_id text not null references institutions(id),
  aicte_ref text not null, fdr_number text not null, bank text not null, branch text not null,
  amount numeric(16,2) not null, issue_date text not null, maturity_date text not null, validity_date text not null,
  beneficiary text not null, purpose text not null, remarks text,
  status text not null, replaces_id text references fdrs(id),
  verification_status text not null default 'NOT_VERIFIED',
  verified_amount numeric(16,2), verified_maturity_date text,
  created_by text not null, created_at text not null, updated_at text not null, submitted_at text,
  bank_key text not null);
create unique index if not exists fdrs_bank_key on fdrs(bank_key);
create index if not exists fdrs_inst on fdrs(institution_id);
create table if not exists fdr_events(
  id text primary key, fdr_id text not null references fdrs(id), from_status text, to_status text not null,
  actor_id text not null, actor_name text not null, actor_role text not null, remarks text, at text not null);
create table if not exists documents(
  id text primary key, fdr_id text not null references fdrs(id), kind text not null, original_name text not null,
  mime text not null, size integer not null, sha256 text not null, storage_name text not null,
  uploaded_by text not null, uploaded_at text not null, removed boolean not null default false);
create table if not exists observations(
  id text primary key, fdr_id text not null references fdrs(id), kind text not null, severity text not null,
  text text not null, author_id text not null, author_name text not null, resolved boolean not null default false,
  created_at text not null);
create table if not exists verifications(
  id text primary key, fdr_id text not null references fdrs(id), outcome text not null, source text not null,
  reference text not null, remarks text, verified_amount numeric(16,2), verified_maturity_date text,
  verified_on text not null, verifier_id text not null, verifier_name text not null, method text not null,
  created_at text not null);
create table if not exists release_requests(
  id text primary key, fdr_id text not null references fdrs(id), institution_id text not null references institutions(id),
  reason text not null, status text not null, prev_status text not null, requested_by text not null,
  requested_at text not null, officer_note text, institution_response text,
  decided_by text, decided_at text, decision_remarks text);
create table if not exists notifications(
  id text primary key, institution_id text, staff boolean not null default false, fdr_id text,
  type text not null, title text not null, message text not null, dedupe_key text unique,
  external_delivery text not null default 'UNAVAILABLE_DEMO', created_at text not null);
create table if not exists notification_reads(
  notification_id text not null references notifications(id), user_id text not null, primary key(notification_id, user_id));
create table if not exists audit_log(
  id text primary key, at text not null, actor_id text not null, actor_name text not null, actor_role text not null,
  action text not null, entity text not null, entity_id text, institution_id text, details text);
create table if not exists settings(key text primary key, value text not null);
`;
