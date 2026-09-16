-- HOW *I* LOOK AT A BOARD, as opposed to how the board is built.
--
-- Jon, 2026-09-16: "be able to customize the different views" — and, asked who else should see a
-- view change: "My view is mine."
--
-- Until now every display choice lived in projects.settings, which is one shared row. So Karla
-- switching the Operations board to Board view switched it for Jon too, and anyone who hid done
-- tasks hid them for the whole team. That is the wrong default for a shared board: the SECTIONS and
-- the WORK are shared on purpose, but "I read this as a list and I do not want to see finished
-- work" is nobody else's business.
--
-- The split is deliberate and lives in lib/projects-shared:
--   SHARED  (projects.settings)  icon, accent, sectionOrder, moveDone, doneSection  — the board's
--                                own structure and identity. Changing it changes the board.
--   PERSONAL (this table)        view, hideDone, hidden rail panels — how one person reads it.
--
-- Keyed by email rather than a user id because that is what project_members and every other
-- ownership check in this app already uses, and a person with no app_users row (a superadmin who
-- was never added as a member) still gets to keep their own view.
create table if not exists project_view_prefs (
  project_id  uuid not null references projects(id) on delete cascade,
  email       text not null,
  prefs       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (project_id, email)
);

create index if not exists project_view_prefs_email_idx on project_view_prefs (email);

alter table project_view_prefs enable row level security;

comment on table project_view_prefs is
  'Per-person display choices for one board: view mode, hide-done, hidden rail panels. The board''s shared structure stays in projects.settings.';
