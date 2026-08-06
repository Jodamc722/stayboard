-- 027: Billable hours & task billing (2026-08-06)
--
-- Two tables behind the new Money → Billable Hours tab (/billing):
--
-- 1) breezeway_billing_details — the task LIST endpoint we mirror into breezeway_tasks_sync does
--    not reliably carry the billing payload (costs[], supplies[], bill_to, rate_type); those live
--    on the single-task retrieve. Rather than widening the mirror (its bulk upserts must stay
--    uniform-keyed and a list sync must never clobber detail data), detail pulls land here,
--    one row per task, joined at read time.
--
-- 2) billing_adjustments — OUR overlay on a Breezeway task for billing review/export. Breezeway's
--    API cannot edit cost/supply line items (in-app only), so exclusions, notes, overrides and
--    extra line items are stored on our side and merged into totals + exports. Rate/rate_type/
--    schedule edits DO write back to Breezeway and are not stored here.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

create table if not exists breezeway_billing_details (
  task_id     text primary key,
  bill_to     text,                          -- 'owner' | 'guest' | 'multiple' | null
  rate_type   text,                          -- 'hourly' | 'piece'
  costs       jsonb not null default '[]'::jsonb,
  supplies    jsonb not null default '[]'::jsonb,
  synced_at   timestamptz not null default now()
);

create table if not exists billing_adjustments (
  task_id         text primary key,
  excluded        boolean not null default false,   -- leave out of owner billing/export
  note            text,                             -- why (shows on the row + export)
  override_amount numeric,                          -- replaces the computed billed total when set
  billed_hours    numeric,                          -- override hours for hourly-rate tasks
  extra_items     jsonb not null default '[]'::jsonb, -- [{description, amount, bill_to}]
  updated_by      text,
  updated_at      timestamptz not null default now()
);

-- Service-role only, same as deleted_records: dollar figures + owner names flow through here.
alter table breezeway_billing_details enable row level security;
alter table billing_adjustments enable row level security;

-- Money page rule (Jon): Revenue and Owner Audit are owner/admin-only; Billable Hours follows.
-- Manager enumerates tabs explicitly (no '*'), so it would fall to 'off' anyway — this records
-- the decision instead of relying on the fall-through. Safe to re-run.
update app_roles
   set perms = jsonb_set(perms, '{billing}', '"off"', true)
 where key = 'manager'
   and not (perms ? 'billing');

notify pgrst, 'reload schema';
