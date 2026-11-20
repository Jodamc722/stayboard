-- HOUSEKEEPING PERFORMANCE (Jon, 2026-11-20: "see performance, track KPI and make sure clear
-- visibility on how we are scheduling"). The hotel marks rooms in Cloudbeds, which keeps no history,
-- so Lighthouse starts keeping one:
--   garden_hk_log    one line the first time a room is cleaned / inspected on a day — what kind of
--                    clean it was, who had the room, and when (seen at the sync, so within ~30 minutes)
--   garden_hk_daily  the day as it ended: work by kind, done / skipped, housekeepers needed vs on the
--                    schedule vs who actually cleaned
-- Additive only. Service-role access, like the other garden_* tables.
create table if not exists garden_hk_log (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  room_id     text not null,
  room_name   text,
  kind        text not null,                 -- turn | checkout | stayover | arrival | dirty
  event       text not null,                 -- cleaned | inspected
  housekeeper text,
  at          timestamptz not null default now(),
  minutes     integer not null default 0,    -- the work credited (45 checkout / turn, 20 stayover …)
  source      text not null default 'cloudbeds',  -- cloudbeds (seen at sync) | lighthouse (button here)
  by_email    text
);
create unique index if not exists garden_hk_log_once on garden_hk_log (date, room_id, event);
create index if not exists garden_hk_log_date on garden_hk_log (date);
alter table garden_hk_log enable row level security;

create table if not exists garden_hk_daily (
  date        date primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table garden_hk_daily enable row level security;
