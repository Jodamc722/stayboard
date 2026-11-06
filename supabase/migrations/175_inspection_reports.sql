-- 175_inspection_reports.sql — THE TEAM SCOREBOARD (Jon, 2026-11-06: "Let's build a scoreboard for our
-- team, a way to organize the feedback, read the inspection and be able to share the inspection
-- reports with the girls").
--
-- inspection_reports — one report per housekeeper per FIVE HK Post Clean inspections ("Every 5
--   inspections is when it should be flagged to send"). lib/inspection-reports builds it after each
--   sync of inspection_results (migration 174), flags it 'ready' in the bell, and a supervisor shares
--   the personal link /ir/<code> by WhatsApp or text ("Personal link shared by supervisor or
--   managers"). The 12-character code is the capability — the housekeeper has no Lighthouse login.
--   block_key (person + the five task ids) makes the same five never become two reports.
--
-- inspection_feedback — every miss, coaching note and perfect clean as a row a supervisor works:
--   open → talked → resolved. dedupe_key (task + kind + section + text) makes a re-read idempotent.
--
-- Service-role only: RLS on, no policies. Safe to run twice.
create table if not exists inspection_reports (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,                 -- the capability in /ir/<code>
  block_key     text,                                 -- person_key|task ids (sorted) — one report per block of 5
  person_key    text not null,                        -- training_people.key: crew:<slug> or an email
  person_name   text,
  lang          text not null default 'es',           -- en | es, from training_people at creation
  task_ids      text[] not null default '{}',         -- the inspections in this report, oldest → newest
  period_from   timestamptz,
  period_to     timestamptz,
  summary       jsonb not null default '{}'::jsonb,   -- computed at creation (lib/inspection-reports ReportSummary)
  status        text not null default 'ready',        -- ready | sent
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  sent_by       text,
  sent_via      text,                                 -- whatsapp | sms | copy | manual
  viewed_at     timestamptz,                          -- first time she opened it
  view_count    int not null default 0,
  manager_note  text
);
alter table inspection_reports add column if not exists block_key text;
alter table inspection_reports add column if not exists manager_note text;
create unique index if not exists inspection_reports_block_uidx on inspection_reports (block_key);
create index if not exists inspection_reports_person_idx on inspection_reports (person_key, created_at desc);
create index if not exists inspection_reports_status_idx on inspection_reports (status, created_at desc);
alter table inspection_reports enable row level security;

create table if not exists inspection_feedback (
  id          uuid primary key default gen_random_uuid(),
  dedupe_key  text,                                   -- task_id|kind|section|text_en (lower-cased, trimmed)
  task_id     text not null,                          -- inspection_results.task_id
  person_key  text,
  kind        text not null,                          -- miss | coaching | praise
  section     text,
  text_en     text,
  text_es     text,
  status      text not null default 'open',           -- open | talked | resolved
  handled_by  text,
  handled_at  timestamptz,
  note        text,
  created_at  timestamptz not null default now()
);
alter table inspection_feedback add column if not exists dedupe_key text;
create unique index if not exists inspection_feedback_dedupe_uidx on inspection_feedback (dedupe_key);
create index if not exists inspection_feedback_person_idx on inspection_feedback (person_key, created_at desc);
create index if not exists inspection_feedback_task_idx on inspection_feedback (task_id);
create index if not exists inspection_feedback_status_idx on inspection_feedback (status, created_at desc);
alter table inspection_feedback enable row level security;
