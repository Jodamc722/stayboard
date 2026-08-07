-- Labor settings, editable from the Lighthouse settings page.
-- One row per market plus a 'default' row that everything falls back to.
create table if not exists labor_settings (
  market            text primary key,          -- 'default' | 'miami' | 'broward'
  pct_good          numeric not null default 30,   -- labor % of revenue: <= good -> on target
  pct_bad           numeric not null default 40,   -- > bad -> over target (between = watch)
  grace_min         integer not null default 7,    -- clock-in grace before "late"
  over_sched_min    integer not null default 30,   -- minutes past schedule before flagged
  ot_weekly_hours   numeric not null default 40,   -- workweek OT threshold
  attribution_min   numeric not null default 0.85, -- per-cleaner board reliability gate
  updated_at        timestamptz not null default now(),
  updated_by        text
);

insert into labor_settings (market) values ('default'), ('miami'), ('broward')
on conflict (market) do nothing;
