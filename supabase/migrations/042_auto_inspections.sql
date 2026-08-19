-- AUTO-CREATED ARRIVAL INSPECTIONS (Jon, 2026-08-18):
--
--   "Create and assign inspections automatically based on big arrivals, VIP, and owner stays.
--    Auto created in Breezeway and assigned to Roberto, and the specific supervisor in market,
--    and shared in the brief as todo / priorities section."
--
-- One row per reservation that has EVER had an inspection auto-created, which is the entire
-- dedupe story: the cron can run hourly and a guest still gets exactly one inspection. The row
-- keeps what we told Breezeway (task id, who it went to, why it fired) so the brief and the
-- Command Center can show the inspection with its live status by joining breezeway_tasks_sync.
create table if not exists auto_inspections (
  reservation_id text primary key,
  listing_id     text,
  unit_name      text,
  guest_name     text,
  check_in       date,
  reason         text,           -- 'big arrival' | 'VIP' | 'owner stay' (first match wins)
  market         text,
  task_id        text,           -- Breezeway task id (null = creation failed; retried next run)
  assignees      text[],         -- names we resolved and assigned, for the brief
  created_at     timestamptz not null default now()
);
create index if not exists idx_auto_inspections_check_in on auto_inspections(check_in);

alter table auto_inspections disable row level security;
