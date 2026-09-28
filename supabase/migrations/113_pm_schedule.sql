-- THE PM LEDGER (Jon, 2026-09-28: "once a task is completed, it creates the next task and manages
-- that for the next 6 months" — central A/C filter cleans, A/C deep cleans every 6 months, remote
-- batteries once a year, door-lock batteries, and whatever else goes on the list).
--
-- One row per unit × cadence: when it was last done (from the completed Breezeway task), when the
-- next one is due (last done + the cadence interval), and the successor task once it exists.
-- lib/pm-recurrence.ts keeps it: the completion sweep writes next_due, the creation pass makes the
-- task inside lead time, the ride-forward pass moves a missed one, and a completed successor starts
-- the cycle again. The cadence catalogue itself stays in app_settings preventative_cadences.
create table if not exists pm_schedule (
  listing_id     text not null,
  cadence_key    text not null,
  unit_name      text,
  building       text,
  last_done      date,                  -- the completion that started this cycle
  last_task_id   text,
  next_due       date not null,         -- last_done + everyDays (or today, when seeded)
  task_id        text,                  -- the successor task in Breezeway, once created
  task_date      date,                  -- where that task currently sits
  status         text not null default 'scheduled',   -- scheduled | created | done | cancelled
  moved          integer not null default 0,          -- how many times the successor rode forward
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (listing_id, cadence_key)
);
create index if not exists idx_pm_schedule_due on pm_schedule(status, next_due);
alter table pm_schedule disable row level security;
