-- 168_walk_reports.sql — WALK REPORTS (Jon, 2026-11-02: the Eden exterior walk — "create it as a
-- Breezeway task, once it's done it sends a report to the owners"). One row per finished task of a
-- property program that asks for a report (Upkeep → Property programs → Owner report). The whole
-- report (every checklist line, photos, notes, fix tasks, what is still open) is the `report` jsonb;
-- the columns beside it are what the lists and the weekly roll-up read. /walks/<code> is the
-- public page; the 16-hex code is the capability. Until this has been run, lib/walk-reports keeps
-- the same rows in app_settings (walk_report:<code> + walk_reports_index), so the feature works
-- before the SQL does. Service-role only: RLS on, no policies. Safe to run twice.
create table if not exists walk_reports (
  code           text primary key,
  program_id     text not null,
  program_name   text not null,
  place          text,
  task_id        text not null,
  home_id        integer,
  scheduled_date date,
  finished_at    timestamptz,
  finished_by    text,
  passed         integer not null default 0,
  issues         integer not null default 0,
  open_items     integer not null default 0,
  emailed_at     timestamptz,
  report         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists walk_reports_task_uidx on walk_reports (task_id);
create index if not exists walk_reports_program_idx on walk_reports (program_id, scheduled_date desc);
alter table walk_reports enable row level security;
