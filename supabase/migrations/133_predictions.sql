-- 133 · THE PREDICTION LEDGER (2026-09-28)
--
-- Every forward number the app shows — "Thursday Broward: 11 checkouts, needs 3 people" — is a
-- claim about the future, and until now none of them was ever checked. This table keeps each one
-- the day it was made, and the nightly grader (lib/forecast, riding the EOD recap cron) writes what
-- actually happened next to it once the day has passed. That is what turns a forecast into one
-- that has earned trust: "checkouts at 3 days out have been within ±1 on 40 of 45 days".
--
--   kind       what is predicted: 'cleans', 'people_needed', …
--   subject    what it is about: a market ('Miami', 'Broward'), later a unit or a building
--   made_on    the ET day the forecast was made
--   for_date   the ET day it is about;  lead_days = for_date − made_on
--   predicted  the forecast; low / high its range where it has one (low = on the books only)
--   actual     what happened, written by the grader; error = actual − predicted
--   meta       the inputs behind the number (booked, pickup factor, minutes per clean, rostered…)
--
-- One row per (kind, subject, made_on, for_date): recording the same forecast twice in a day
-- replaces it. Service role only — RLS on, no policies; the app reads it through its own routes.
create table if not exists predictions (
  id          bigserial primary key,
  kind        text not null,
  subject     text not null,
  made_on     date not null,
  for_date    date not null,
  lead_days   integer not null default 0,
  predicted   numeric not null,
  low         numeric,
  high        numeric,
  actual      numeric,
  error       numeric,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  graded_at   timestamptz,
  unique (kind, subject, made_on, for_date)
);

-- The grader's question: what is still waiting for its day to pass?
create index if not exists predictions_ungraded_idx on predictions (for_date, kind) where graded_at is null;
-- The track record's question: how has this kind done, by lead time?
create index if not exists predictions_kind_idx on predictions (kind, subject, for_date desc);

alter table predictions enable row level security;
