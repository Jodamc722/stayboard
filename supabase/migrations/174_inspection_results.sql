-- 174_inspection_results.sql — INSPECTION SCORES → TRAINING (Jon, 2026-11-05: "It should read those
-- scores and use it in database for training").
--
-- One row per COMPLETED Breezeway inspection built on our three bilingual templates:
--   927920 HK Post Clean Inspection 1.0         kind 'hk_post_clean' — scores the HOUSEKEEPER's clean as found
--   927921 Preventative Maintenance Inspection 1.0 kind 'pm'      — the unit's condition, done by a technician
--   909475 Arrival Inspection 1.0               kind 'arrival'       — ready for this group right now?
-- lib/inspection-results reads GET /task/{id}/requirements once per finished task (cron
-- /api/cron/inspection-results, hourly), scores it, and the Training page's Inspections tab turns
-- the misses into each person's weak areas and the training to assign.
--
-- subject_* is WHO the score is about (not who walked the unit): the housekeeper named in the
-- audit's first line (or, failing that, the last departure clean's cleaner), the PM technician,
-- nobody for an arrival. subject_key matches training_people.key ('crew:<slug>' or an email).
-- Every Yes/No on these templates is phrased so NO = a miss.
--
-- Service-role only: RLS on, no policies. Safe to run twice.
create table if not exists inspection_results (
  task_id         text primary key,               -- breezeway_tasks_sync.id
  template_id     int,
  kind            text not null,                  -- hk_post_clean | pm | arrival
  listing_id      text,                           -- reference_property_id (guesty_listings.id)
  home_id         bigint,
  unit            text,
  market          text,
  scheduled_date  date,
  finished_at     timestamptz,
  inspector       text,                           -- who completed the task (finished_by, else first assignee)
  subject_name    text,                           -- the housekeeper audited (hk), the technician (pm), null (arrival)
  subject_key     text,                           -- training person key: crew:<slug> or an email
  subject_source  text,                           -- answer | last_clean | assignee
  yes_count       int not null default 0,
  no_count        int not null default 0,
  pass_rate       numeric,                        -- yes / (yes + no); null when no Yes/No was answered
  score           int,                            -- the 1–5 rating line
  clean_finished  boolean,                        -- hk only: "Was the clean finished before you started?"
  misses          jsonb not null default '[]'::jsonb,   -- [{section, item_en, item_es, photos}]
  readings        jsonb not null default '{}'::jsonb,   -- pm {lock_battery_pct, vent_temp_f, wifi_mbps}; arrival {guests}
  fixed           text,
  coaching        text,
  notes           text,
  answered        int not null default 0,
  total           int not null default 0,
  photos          int not null default 0,
  items           jsonb not null default '[]'::jsonb,   -- every line: {section, text, type, response, photos}
  synced_at       timestamptz not null default now()
);

alter table inspection_results add column if not exists template_id int;
alter table inspection_results add column if not exists subject_source text;
alter table inspection_results add column if not exists readings jsonb not null default '{}'::jsonb;

create index if not exists inspection_results_kind_idx    on inspection_results (kind, finished_at desc);
create index if not exists inspection_results_subject_idx on inspection_results (subject_key, finished_at desc);
create index if not exists inspection_results_listing_idx on inspection_results (listing_id, finished_at desc);

alter table inspection_results enable row level security;
