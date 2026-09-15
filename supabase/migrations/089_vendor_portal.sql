-- THE VENDOR'S OWN LINK (Jon, 2026-09-15: "can we please work on public board for just that").
--
-- WHY THE TOKEN IS ON THE VENDOR AND NOT ON THE PROJECT.
--
-- Migration 031 gave each PROJECT a share_token, and that shape is right for a renovation: one
-- job, one contractor, one link, done when the job is done. It is the wrong shape for vendor-
-- managed work, for two reasons:
--
--   1. A pest contractor touches thirty-four units across six buildings. Scoped by project, they
--      would need a different link for every board their work appears on, and a new one each time
--      work was filed somewhere new.
--   2. A project link shows the whole project. On a board that carries every vendor's work, that
--      means every vendor reads every other vendor's dates, notes and prices.
--
-- Scoping by VENDOR fixes both. One permanent link per company; it shows exactly the jobs whose
-- vendor_key is theirs, wherever those jobs live, and nothing else exists as far as they can see.
--
-- The old project share_token is untouched and keeps working — a renovation with one GC is still
-- best served by it.

alter table vendors add column if not exists share_token   text unique;   -- null = no link exists
alter table vendors add column if not exists share_expires timestamptz;   -- null = does not expire
alter table vendors add column if not exists share_made_at timestamptz;
alter table vendors add column if not exists share_made_by text;
-- Last time anybody opened it. The honest answer to "did we ever actually send this to them".
alter table vendors add column if not exists share_seen_at timestamptz;

create index if not exists vendors_share_idx on vendors (share_token) where share_token is not null;

-- ── WHAT THE VENDOR WRITES BACK ─────────────────────────────────────────────────────────────────
-- A vendor confirming a date is not the same fact as us setting one, and flattening the two would
-- lose the only reliable signal that they have actually seen the job. Kept apart:
--   visit_on          what WE scheduled (088)
--   vendor_confirmed  they have seen it and agree
--   vendor_proposed   they cannot do that day and suggest another — a request, not a change.
--                     Our date never moves because a vendor typed something.
alter table project_steps add column if not exists vendor_confirmed_at timestamptz;
alter table project_steps add column if not exists vendor_proposed_on  date;
alter table project_steps add column if not exists vendor_note         text;

comment on column project_steps.vendor_proposed_on is
  'A date the vendor asked for. Advisory only — visit_on is ours and changes only when we change it.';

comment on column vendors.share_token is
  'One permanent link per vendor company. Shows every job whose vendor_key is theirs and nothing else.';
