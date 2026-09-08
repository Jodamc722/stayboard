-- PROJECTS, WAVE 3 — NOTIFICATIONS AND REMINDERS.
--
-- One row per (person, thing they should know). The same row feeds two surfaces: the bell in the
-- app (read_at) and email (emailed_at / digested_at), so "did Luis get told" has one answer.
--
-- Rows are written by the API at the moment something happens (assigned, mentioned, a comment on
-- your task, added to a project) and by the daily reminder pass (due tomorrow, overdue). The
-- reminder pass runs every morning, so dedupe_key stops it saying the same thing twice in one day.
--
-- Nothing here is destructive; the table is new.

create table if not exists project_notifications (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  task_id      uuid references project_steps(id) on delete cascade,
  note_id      uuid references project_notes(id) on delete cascade,
  email        text not null,                 -- the recipient (app_users.email, lower-case)
  type         text not null,                 -- assigned | mentioned | comment | added | due_soon | overdue
  title        text not null,                 -- one line: "Roberto assigned you Floors 1–4"
  body         text,                          -- the comment, or the due date sentence
  url          text not null,                 -- /projects/<id>?task=<id>
  actor        text,                          -- who caused it (email), null for the reminder pass
  dedupe_key   text unique,                   -- "due_soon:<task>:<date>" — reminders only
  created_at   timestamptz not null default now(),
  read_at      timestamptz,                   -- seen in the app
  emailed_at   timestamptz,                   -- went out in an immediate email
  digested_at  timestamptz                    -- went out in the morning digest
);

create index if not exists project_notifications_inbox_idx  on project_notifications (email, created_at desc) where read_at is null;
create index if not exists project_notifications_send_idx   on project_notifications (created_at) where emailed_at is null and digested_at is null;
create index if not exists project_notifications_project_idx on project_notifications (project_id);

-- Service role only, like the rest of the projects tables.
alter table project_notifications enable row level security;
