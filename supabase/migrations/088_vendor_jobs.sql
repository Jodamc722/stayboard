-- VENDOR-MANAGED WORK (Jon, 2026-09-15).
--
--   "The goal of the vendors is to manage work that the vendor is required for, so that our team
--    can just know that there's certain work that our team can't complete that we need a vendor to
--    fix. Manage properly."
--
-- So a vendor job is not a new kind of thing. It is a TASK that our own crew cannot close — and the
-- three facts that makes it different are: who is coming, when they are coming, and what they
-- charged. Everything else a task already has (a unit, a description, photos, comments, an owner,
-- a Breezeway push) is exactly what a vendor job needs too.
--
-- That is why these are columns on project_steps and not a vendor_jobs table. A separate table
-- would have meant reimplementing assignees, files, comments, multi-homing and My Tasks for the
-- second time, and then keeping the two in step forever.
--
-- Jon explicitly ruled out service agreements ("We don't need service agreements and things like
-- that"), so there is no contract object here. Recurring work — pest control monthly — is a
-- property of the JOB itself: when you finish one, the next one schedules itself.

-- ── 1. WHO IS COMING, AND WHEN ──────────────────────────────────────────────────────────────────
-- visit_on is the date they arrive. It is deliberately NOT due_on: for a two-day job those are
-- different days, and the team needs the arrival date to plan around, while the board needs the
-- completion date to chase. Keeping them apart is the whole reason the team can be told the right
-- thing on the right morning.
alter table project_steps add column if not exists vendor_key        text references vendors(key) on delete set null;
alter table project_steps add column if not exists vendor_name       text;   -- spelling at the time, survives a rename
alter table project_steps add column if not exists visit_on          date;   -- the day they come out
alter table project_steps add column if not exists visit_window      text;   -- '9–11am', 'afternoon', 'first call'
alter table project_steps add column if not exists est_minutes       integer;-- how long they will be on site

-- "Making sure the team is aware that they're arriving." Stamped when the crew has actually been
-- told, so a date quietly changed after the fact re-arms the notice instead of everyone assuming
-- the first message still stands.
alter table project_steps add column if not exists team_notified_at  timestamptz;
alter table project_steps add column if not exists team_notified_for date;   -- the visit date they were told about

-- Recurring vendor work, held on the job rather than in a schedule somewhere else:
--   {"every":"month","day":12,"next_on":"2026-10-12"}  — same shape as projects.recurs.
-- Completing a repeating job creates the next one. Nothing runs on a clock to make this happen,
-- which means a job that nobody finished cannot silently pile up twelve copies of itself.
alter table project_steps add column if not exists recurs            jsonb;
alter table project_steps add column if not exists recurred_from     uuid references project_steps(id) on delete set null;

create index if not exists project_steps_vendor_idx on project_steps (vendor_key) where vendor_key is not null;
-- The index the board's "who is arriving" strip reads every time it loads.
create index if not exists project_steps_visit_idx  on project_steps (visit_on) where visit_on is not null and status <> 'done';

-- ── 2. APPROVAL OVER $300, IN WRITING ───────────────────────────────────────────────────────────
-- Jon: "If it's over 300, it must be approved by the owner/general manager, and we can put that in
-- writing." approved_by and approved_at (087) record the decision; these record the ASKING and the
-- words. Without them an approval is a boolean, and a boolean is not something you can show anyone
-- six months later when the owner asks why they were charged.
alter table project_invoices add column if not exists approval_requested_to   text;         -- who we asked
alter table project_invoices add column if not exists approval_requested_at   timestamptz;
alter table project_invoices add column if not exists approval_note           text;         -- what they said when they said yes

-- ── 3. THE CEILING IS $300, NOT $1,000 ──────────────────────────────────────────────────────────
-- 087 shipped with a $1,000 default because no figure had been given. Jon has now given one. Boards
-- created before today carry the old default in their own settings only if somebody set it by hand,
-- so moving the app default is enough and no existing project is rewritten.
--
-- The number itself lives in code (lib/projects-shared: INVOICE_APPROVAL_CENTS) and any board can
-- override it in settings.invoiceApprovalCents. This comment is here so the two do not drift.

comment on column project_steps.visit_on is
  'The day the vendor arrives. Distinct from due_on, which is when the work is expected to be finished.';
comment on column project_steps.recurs is
  'Repeating vendor work. The next visit is created when this one is completed, never by a clock.';
