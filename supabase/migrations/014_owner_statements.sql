-- Owner-statement mirror: owners, their generated Guesty statements, and the recognised
-- Owners-ledger journal rows those statements are built from.
--
-- Why mirror at all: a single month sweep of /accounting-api/journal-entries/all takes
-- 78-140s and parallel sweeps get 429'd, so it can never run inside a report render.
-- The sync writes these tables one month at a time; the report generator reads them instantly.
--
-- Accounting model proven by the account-wide audit (see /api/guesty/statement-audit-all):
--   a Guesty owner statement is the RECOGNISED slice of the Owners journal ledger.
--   Charge codes on that ledger, signed from the PM's side (flip to read as owner revenue):
--     AF  = net rental nightly income  (owner earnings before expenses)
--     CMS = Stay's PM commission
--     OC  = owner charges / channel-fee reimbursements
--     PO  = payout — a SETTLEMENT movement, NOT earnings; tracked separately
--   dueToOwner on the statement is a settlement balance, not earnings. The figure an owner
--   actually collected is recognised net, cross-checked against the PO total.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

-- ─────────────────────────────────────────────────────────────────
-- Owners (from /owners). listing_ids is what ties an owner to a report scope.
-- ─────────────────────────────────────────────────────────────────
create table if not exists guesty_owners (
  id          text primary key,
  full_name   text,
  email       text,
  phone       text,
  listing_ids text[] not null default '{}',
  synced_at   timestamptz not null default now(),
  raw         jsonb
);
create index if not exists idx_guesty_owners_listings on guesty_owners using gin(listing_ids);
create index if not exists idx_guesty_owners_name     on guesty_owners(full_name);

-- ─────────────────────────────────────────────────────────────────
-- Generated owner statements (from /owner-statement-api/owner-statements).
-- Header rows only — every detail sub-resource 404s, so the journal ledger below is the
-- ONLY structured line-item source. period_month is the yyyy-MM the statement covers and is
-- what the read layer joins the ledger on (matching on a from/to window drops statements
-- whose period straddles a boundary — that bug lost 18 of 33 December-2025 statements).
-- ─────────────────────────────────────────────────────────────────
create table if not exists guesty_owner_statements (
  id             text primary key,
  owner_id       text,
  owner_name     text,
  period_start   date,
  period_end     date,
  period_month   text,            -- 'yyyy-MM' derived from period_start
  statement_type text,
  ending_balance numeric,
  due_to_owner   numeric,         -- settlement balance, NOT earnings
  currency       text,
  synced_at      timestamptz not null default now(),
  raw            jsonb
);
create index if not exists idx_gos_owner       on guesty_owner_statements(owner_id);
create index if not exists idx_gos_month       on guesty_owner_statements(period_month);
create index if not exists idx_gos_owner_month on guesty_owner_statements(owner_id, period_month);

-- ─────────────────────────────────────────────────────────────────
-- Owners-ledger journal entries (from /accounting-api/journal-entries/all?ledger[]=O).
-- One row per journal line. Unrecognised rows are kept (recognized = false) so the mirror
-- stays a faithful copy; every read path filters to recognized is not false.
-- ─────────────────────────────────────────────────────────────────
create table if not exists guesty_owner_ledger (
  id          text primary key,
  owner_id    text,
  listing_id  text,
  entry_date  date,
  entry_month text,               -- 'yyyy-MM' from entry_date, the sweep/aggregation key
  charge_code text,               -- AF | CMS | OC | PO | ...
  amount      numeric not null default 0,   -- as returned by Guesty (PM-side sign)
  recognized  boolean not null default true,
  ledger      text,
  currency    text,
  synced_at   timestamptz not null default now(),
  raw         jsonb
);
create index if not exists idx_gol_owner_month   on guesty_owner_ledger(owner_id, entry_month);
create index if not exists idx_gol_listing_month on guesty_owner_ledger(listing_id, entry_month);
create index if not exists idx_gol_month         on guesty_owner_ledger(entry_month);
create index if not exists idx_gol_code          on guesty_owner_ledger(charge_code);
create index if not exists idx_gol_date          on guesty_owner_ledger(entry_date);

-- ─────────────────────────────────────────────────────────────────
-- Per-month sync cursor. The ledger sweep is resumable and runs ONE month at a time
-- (Guesty 429s on parallel sweeps), so progress is tracked per month rather than by a
-- single last_sync_at. status: 'pending' | 'running' | 'done' | 'error'.
-- ─────────────────────────────────────────────────────────────────
create table if not exists guesty_ledger_months (
  month        text primary key,  -- 'yyyy-MM'
  status       text not null default 'pending',
  rows_synced  integer not null default 0,
  last_error   text,
  started_at   timestamptz,
  completed_at timestamptz,
  updated_at   timestamptz not null default now()
);
create index if not exists idx_glm_status on guesty_ledger_months(status);

-- ─────────────────────────────────────────────────────────────────
-- RLS: authenticated users read; writes are service-role only (the sync job), which
-- bypasses RLS. Same posture as the rest of the guesty_* mirror.
-- ─────────────────────────────────────────────────────────────────
alter table guesty_owners            enable row level security;
alter table guesty_owner_statements  enable row level security;
alter table guesty_owner_ledger      enable row level security;
alter table guesty_ledger_months     enable row level security;

drop policy if exists "authenticated read" on guesty_owners;
drop policy if exists "authenticated read" on guesty_owner_statements;
drop policy if exists "authenticated read" on guesty_owner_ledger;
drop policy if exists "authenticated read" on guesty_ledger_months;

create policy "authenticated read" on guesty_owners           for select to authenticated using (true);
create policy "authenticated read" on guesty_owner_statements for select to authenticated using (true);
create policy "authenticated read" on guesty_owner_ledger     for select to authenticated using (true);
create policy "authenticated read" on guesty_ledger_months    for select to authenticated using (true);
