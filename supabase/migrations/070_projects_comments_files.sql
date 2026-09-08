-- PROJECTS, WAVE 2 — COMMENTS, FILES AND THE ACTIVITY FEED.
--
-- Wave 1 made the task the atom. This wave lets people talk on it and pin things to it. Two tables
-- from 031 already hold the right things at the project level — project_notes (comments + events in
-- one stream) and project_photos — so nothing new is created; both learn to point at a task, and
-- photos grow into files.
--
-- Nothing here is destructive. Every column is additive with a default, every old row stays valid,
-- and the project-level views keep reading exactly what they read before.

-- ── 1. notes can belong to a task ──────────────────────────────────────────────────────────────────
-- task_id null = a project-level comment or event (what 031 had). Set = it shows in that task's
-- drawer as well as the project feed. When a task is deleted its conversation goes with it.
alter table project_notes add column if not exists task_id   uuid references project_steps(id) on delete cascade;
-- Events carry a little structure so the feed can render "Jon moved Fix lock to Done" with the task
-- linked, instead of parsing prose. {type, task_id, task_title, from, to, ...}. Comments leave it null.
alter table project_notes add column if not exists meta      jsonb;
alter table project_notes add column if not exists edited_at timestamptz;
create index if not exists project_notes_task_idx on project_notes (task_id, created_at) where task_id is not null;

-- ── 2. photos grow into files ────────────────────────────────────────────────────────────────────────
-- A PDF quote, a spreadsheet of unit numbers, a floor plan: the same row shape as a photo with a
-- name and a type. `kind` keeps the before/during/after photo strip working — only photos have a
-- phase that means anything.
alter table project_photos add column if not exists task_id      uuid references project_steps(id) on delete cascade;
alter table project_photos add column if not exists kind         text not null default 'photo';  -- photo | file
alter table project_photos add column if not exists name         text;                           -- original filename, shown to people
alter table project_photos add column if not exists mime         text;
alter table project_photos add column if not exists bytes        integer;
-- New uploads go to a PRIVATE bucket and are served through short-lived signed URLs the server
-- mints on read, so a quote attached to a one-on-one is exactly as private as the one-on-one.
-- Old rows (public bucket, url set, storage_path null) keep working untouched.
alter table project_photos add column if not exists storage_path text;
create index if not exists project_photos_task_idx on project_photos (task_id) where task_id is not null;
