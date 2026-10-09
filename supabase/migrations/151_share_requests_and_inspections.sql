-- TWO THINGS THE OWNER BOARD NEEDED (Jon, 2026-10-09):
--   "want to be able to push breezeway task from there"
--   "should be able to see all inspection completed from Roberto, Ernesto and Yoslenis.
--    Must be approved by me, they should not see it"
--
-- Both are the same shape: something originates at, or is destined for, the share link, and Jon
-- stands between it and the field. He also said the APPROVAL STEP is what stays hidden — so the
-- state below is read by Lighthouse and never described to the link. An owner who asks for a
-- technician is told "requested" and nothing else: not pending, not declined, not who decides.

-- A REQUEST FOR A TECHNICIAN, raised from the link. Nothing reaches Breezeway on this alone; it
-- is a flag on the task that puts it in front of Jon. Cleared when he pushes or declines.
alter table project_steps add column if not exists bz_request      text;         -- 'pending' | null
alter table project_steps add column if not exists bz_request_by   text;
alter table project_steps add column if not exists bz_request_at   timestamptz;
alter table project_steps add column if not exists bz_request_note text;

-- WHICH COMPLETED INSPECTIONS AN OWNER MAY SEE. Opt-in per inspection, per project: a row here is
-- Jon having looked at one and decided it can go out. No row, no visibility — so a board shared
-- today exposes nothing from Breezeway that he has not personally released.
-- RLS is on for this table (enabled at run time); every read and write goes through the service
-- role in app/api/projects/inspections and app/api/public/project, which bypasses it.
create table if not exists project_inspection_shares (
  project_id  uuid not null references projects(id) on delete cascade,
  bz_task_id  text not null,
  approved_by text,
  approved_at timestamptz not null default now(),
  primary key (project_id, bz_task_id)
);
