-- PROJECTS, WAVE 5 — COLLABORATORS, A REAL VENDOR RECORD, AND INVOICES.
--
-- Jon, 2026-09-15: "when you create a board and you try and add a task, it has a type function.
-- It should be more of a form builder, kind of like the Glitch form… create subtasks, due dates,
-- assign it to team members, multiple collaborators, descriptions, photos, add invoices, pull from
-- once you save a vendor, save that vendor, have their phone number."
--
-- Most of that already exists in the schema — subtasks (project_steps.parent_id), due dates,
-- several assignees, descriptions, files. What was missing was only reachable AFTER the task
-- existed, because adding one was a single text box. That is a UI problem, not a schema one.
--
-- Three things genuinely did not exist, and they are what this migration adds:
--   1. A COLLABORATOR — on the task, but not the person who has to do it.
--   2. A vendor you can actually ring. `vendors` (migration 062) held a company and the buildings
--      it covers; it had no phone number, no trade and no insurance date.
--   3. An invoice. Money leaving the project had one number — projects.spent_cents, typed in by
--      hand — with no vendor, no invoice number and no paper attached to it.
--
-- Nothing here is destructive. Every column is additive with a default and every existing row
-- stays valid and keeps its meaning.

-- ── 1. COLLABORATORS ────────────────────────────────────────────────────────────────────────────
-- A collaborator is on the task without owning it: the person who has to know, review, or supply
-- something, but who is not who you chase when it is late. Reusing project_task_assignees rather
-- than adding a second table keeps one answer to "who is on this task" — the role says which kind.
-- Existing rows become 'assignee', which is exactly what they already meant.
alter table project_task_assignees
  add column if not exists role text not null default 'assignee';   -- assignee | collaborator

create index if not exists project_task_assignees_role_idx
  on project_task_assignees (person_key, role);

-- ── 2. THE VENDOR RECORD GROWS A PHONE NUMBER ───────────────────────────────────────────────────
-- 062 built `vendors` for CLASSIFICATION: which company covers which building, so the ops boards
-- could stop guessing from building names. It was never something you could call. These columns
-- make the same row the contact card too, so there is one vendor list in the app and not two.
-- `contact` (free text) stays and is untouched — contact_name/phone/email are the structured
-- version, and the API writes both so nothing that reads the old column breaks.
alter table vendors add column if not exists contact_name text;
alter table vendors add column if not exists phone        text;
alter table vendors add column if not exists email        text;
alter table vendors add column if not exists trade        text;     -- plumbing | electrical | hvac | general | cleaning | …
alter table vendors add column if not exists rate_cents   bigint;   -- typical rate, pre-fills an invoice
alter table vendors add column if not exists rate_unit    text;     -- hour | job | visit | month
alter table vendors add column if not exists address      text;
alter table vendors add column if not exists w9_on_file   boolean not null default false;
alter table vendors add column if not exists coi_expires  date;     -- certificate of insurance
alter table vendors add column if not exists created_by   text;

create index if not exists vendors_trade_idx on vendors (trade) where active;
-- The one that matters operationally: who is about to lapse.
create index if not exists vendors_coi_idx   on vendors (coi_expires) where coi_expires is not null and active;

-- ── 3. INVOICES ─────────────────────────────────────────────────────────────────────────────────
-- One row per invoice. It hangs off the PROJECT always and off a TASK when the work was one task,
-- because "what did the water heater cost" and "what has this renovation cost" are both real
-- questions and only the second one has a task.
--
-- On deletes: a project going away takes its invoices (cascade), but a TASK going away must not —
-- the money was still spent, so task_id goes null and the invoice stays on the project. Same for
-- the attached file and the vendor: losing the paperwork must never lose the number.
create table if not exists project_invoices (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  task_id        uuid references project_steps(id) on delete set null,

  -- Who billed us. vendor_key points at the saved vendor; vendor_name is the spelling at the time,
  -- kept so a renamed or deleted vendor never rewrites history on an invoice already paid.
  vendor_key     text references vendors(key) on delete set null,
  vendor_name    text,

  number         text,                              -- their invoice number, as printed
  amount_cents   bigint not null default 0,
  status         text not null default 'received',  -- quoted | received | approved | paid | void
  issued_on      date,
  due_on         date,
  paid_on        date,
  note           text,

  -- The paper. A project_photos row (kind='file'), so invoices reuse the private bucket and the
  -- signed-URL read path rather than inventing a second one.
  photo_id       uuid references project_photos(id) on delete set null,

  -- Approval. Set when the amount is over the project's threshold; cleared when someone with the
  -- authority says yes. Mirrors how glitch refunds already work, so the two read the same.
  needs_approval boolean not null default false,
  approved_by    text,
  approved_at    timestamptz,

  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists project_invoices_project_idx on project_invoices (project_id, created_at desc);
create index if not exists project_invoices_task_idx    on project_invoices (task_id) where task_id is not null;
create index if not exists project_invoices_vendor_idx  on project_invoices (vendor_key) where vendor_key is not null;
create index if not exists project_invoices_open_idx    on project_invoices (due_on) where status in ('received','approved');

create or replace function project_invoices_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists project_invoices_touch_trg on project_invoices;
create trigger project_invoices_touch_trg before update on project_invoices
  for each row execute function project_invoices_touch();

-- ── 4. WHAT THE PROJECT HAS BEEN INVOICED ───────────────────────────────────────────────────────
-- projects.spent_cents predates invoices and is typed in by hand. It is NOT recomputed here —
-- overwriting a figure somebody entered would be the worst kind of helpful. invoiced_cents is its
-- own number, maintained from approved and paid invoices, and the page shows both against budget:
-- invoiced, other spend, total. A quoted or voided invoice is not money out and does not count.
alter table projects add column if not exists invoiced_cents bigint not null default 0;

-- Service role only, like every other projects table. The browser never reads this directly; the
-- API checks membership with the service key first. Without RLS the anon key could read every
-- vendor price and every invoice in the company.
alter table project_invoices enable row level security;
