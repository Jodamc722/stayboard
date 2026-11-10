-- 178: THE BUSINESS BRAIN, v1 (Jon, 2026-11-10: "a deep review of our entire app, business, and
-- data points … to help us make more informed decisions, property upkeep decisions").
--
-- Until now every board worked its numbers out from the raw mirrors each time it loaded, and each
-- one carried its own answer to "which unit is this", "which building", "what kind of repair was
-- that". This migration adds a nightly-built layer both the dashboards and Eve can read, so a number
-- has ONE definition:
--
--   THE SPINE     dim_building · dim_unit · person_xref · vendor_xref · entity_alias
--   THE FACTS     fact_unit_day (one row per listing per night) · fact_maintenance_event (one row per
--                 glitch / maintenance task / work order, with a system and a repeat flag)
--   THE ROLL-UPS  unit_health_daily · owner_month · vendor_month
--
-- Built by /api/cron/business-brain (lib/brain/*). Every table carries `built_at` and a `partial`
-- flag: partial = true means an input read came back short or an input does not exist yet, and the
-- row says so instead of printing a low number as if it were whole.
--
-- Also: four NULLABLE columns on `glitches` (system, root_cause, resolution, part) for the two
-- optional taps at close. `glitches` has never had a CREATE TABLE (see 085) — additive only.
--
-- Service-role only: RLS on, no policies, like 174/175. Idempotent — safe to run twice.
-- Run in the Supabase SQL editor (project: Ops App). Nothing in the app depends on it having run:
-- the cron answers {ok:true, skipped:'tables missing — run migration 178'} until it has.

-- ── THE SPINE ───────────────────────────────────────────────────────────────────────────────────
create table if not exists public.dim_building (
  id             text primary key,                 -- slug of the canonical label: '17west', 'park-towers'
  label          text not null,                    -- lib/segments canonical label
  market         text,                             -- Miami | Broward | North
  lux            boolean not null default false,
  vendor_cleaned boolean not null default false,
  aliases        text[] not null default '{}',     -- every raw spelling seen on a listing that resolved here
  known          boolean not null default true,    -- false = not in lib/segments BUILDINGS (a first-word guess)
  units          integer not null default 0,
  built_at       timestamptz not null default now(),
  partial        boolean not null default false
);
alter table public.dim_building enable row level security;

create table if not exists public.dim_unit (
  listing_id        text primary key,              -- guesty_listings.id
  physical_unit_id  text not null,                 -- the apartment: own id, or '<building>#<room>' for a whole-and-parts set
  parent_listing_id text,                          -- the "Full" / combined listing that contains this one, when there is one
  is_parent         boolean not null default false,-- this listing IS the whole unit and its parts are also listed
  building_id       text,                          -- dim_building.id
  market            text,
  nickname          text,
  unit_label        text,                          -- the unit number chip: '1704/1', '402'
  bedrooms          integer,
  bathrooms         numeric,
  sqft              integer,                       -- null until Guesty carries it (raw.areaSquareFeet)
  ac_type           text,                          -- central | mini-split | window | none | unknown (app_settings unit_equipment overrides only)
  vendor_cleaned    boolean not null default false,
  bz_home_id        bigint,                        -- breezeway_properties.home_id
  owner_id          text,                          -- guesty_owners.id (current; no history yet)
  active_from       date,                          -- listing created date, else first reservation check-in
  active_to         date,                          -- last check-out, only once the listing is inactive
  status            text,                          -- active | inactive
  built_at          timestamptz not null default now(),
  partial           boolean not null default false
);
create index if not exists dim_unit_physical_idx on public.dim_unit (physical_unit_id);
create index if not exists dim_unit_building_idx on public.dim_unit (building_id);
create index if not exists dim_unit_owner_idx    on public.dim_unit (owner_id) where owner_id is not null;
create index if not exists dim_unit_home_idx     on public.dim_unit (bz_home_id) where bz_home_id is not null;
alter table public.dim_unit enable row level security;

-- One row per human, with every id the other systems know them by. Seeded by NAME MATCHING, so a
-- seeded row is a suggestion: confirmed = false until a person checks it. The builder never
-- rewrites a confirmed row.
create table if not exists public.person_xref (
  person_id    text primary key,                   -- lib/person-name personKey of the name
  name         text not null,
  email        text,
  homebase_id  text,
  breezeway_id text,
  slack_id     text,
  dept         text,
  confirmed    boolean not null default false,
  sources      text[] not null default '{}',       -- staff | breezeway | homebase | app_users
  built_at     timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists person_xref_bz_idx on public.person_xref (breezeway_id) where breezeway_id is not null;
create index if not exists person_xref_hb_idx on public.person_xref (homebase_id) where homebase_id is not null;
alter table public.person_xref enable row level security;

create table if not exists public.vendor_xref (
  vendor_key            text not null,             -- vendors.key
  alias                 text not null,             -- a spelling this vendor appears under (lower-cased)
  breezeway_assignee_id text,                      -- the Breezeway person id their crew is assigned as, when known
  confirmed             boolean not null default false,
  built_at              timestamptz not null default now(),
  primary key (vendor_key, alias)
);
create index if not exists vendor_xref_bz_idx on public.vendor_xref (breezeway_assignee_id) where breezeway_assignee_id is not null;
alter table public.vendor_xref enable row level security;

create table if not exists public.entity_alias (
  kind     text not null,                          -- building | unit
  alias    text not null,                          -- lower-cased, single-spaced
  id       text not null,                          -- dim_building.id or dim_unit.listing_id
  built_at timestamptz not null default now(),
  primary key (kind, alias)
);
create index if not exists entity_alias_id_idx on public.entity_alias (kind, id);
alter table public.entity_alias enable row level security;

-- ── THE FACTS ───────────────────────────────────────────────────────────────────────────────────
-- One row per listing per NIGHT (the night that starts on `day`). Money is each stay's own money
-- spread evenly over its nights: net = fareAccommodationAdjusted − channel fee (lib/basis), cleaning
-- is put on the check-out day (when the clean is earned). Live stays only (lib/basis
-- LIVE_STAY_STATUSES). 'blocked' is never written in v1: the Guesty calendar is not stored.
create table if not exists public.fact_unit_day (
  day               date not null,
  listing_id        text not null,
  physical_unit_id  text,
  building_id       text,
  market            text,
  owner_id          text,
  state             text not null,                 -- occupied | owner_stay | vacant (days a listing was not active are not written)
  reservation_id    text,
  channel           text,
  gross_accom       numeric,                       -- accommodation before the channel fee, this night
  channel_fee       numeric,
  net_accom         numeric,                       -- gross_accom − channel_fee
  cleaning_rev      numeric,                       -- the departing stay's cleaning fee, on its check-out day
  is_arrival        boolean not null default false,
  is_departure      boolean not null default false,
  clean_minutes     integer,
  clean_done_by     text,
  clean_late        boolean,                       -- finished at/after 4pm Eastern or on a later day; null = not finished / unknown
  glitches_opened   integer not null default 0,
  refunds           numeric not null default 0,    -- glitches.refund_approved filed that day
  maint_tasks_done  integer not null default 0,
  maint_cost_billed numeric not null default 0,    -- Breezeway cost + supply lines on those tasks: what was BILLED, not what it cost us
  built_at          timestamptz not null default now(),
  partial           boolean not null default false,
  primary key (day, listing_id)
);
create index if not exists fact_unit_day_listing_idx  on public.fact_unit_day (listing_id, day desc);
create index if not exists fact_unit_day_physical_idx on public.fact_unit_day (physical_unit_id, day desc);
create index if not exists fact_unit_day_building_idx on public.fact_unit_day (building_id, day desc);
create index if not exists fact_unit_day_owner_idx    on public.fact_unit_day (owner_id, day desc) where owner_id is not null;
alter table public.fact_unit_day enable row level security;

-- One row per thing that went wrong or was fixed: a glitch, a Breezeway maintenance task, a work
-- order. A glitch and the Breezeway task pushed from it are ONE event (the task folds into the
-- glitch row). `system` is one classifier everywhere (lib/task-categories systemOf).
create table if not exists public.fact_maintenance_event (
  event_id         text primary key,               -- 'glitch:<id>' | 'bz:<task id>' | 'wo:<id>'
  source           text not null,                  -- glitch | bz_task | work_order
  source_id        text not null,
  listing_id       text,
  physical_unit_id text,
  building_id      text,
  market           text,
  system           text not null default 'other',  -- hvac | plumbing | appliance | lock_access | electrical | pest | wifi_tv | furniture | cleaning | other
  system_source    text,                           -- picked (a person chose it at close) | category | name
  title            text,
  root_cause       text,                           -- from glitches.root_cause, when filled
  resolution       text,                           -- repaired | replaced | no_fault | guest_error
  part             text,
  opened_at        timestamptz,
  closed_at        timestamptz,
  hours_to_close   numeric,
  is_open          boolean not null default false,
  guest_impacting  boolean not null default false,
  reservation_id   text,
  person_name      text,                           -- who finished it (Breezeway), as written
  vendor_key       text,
  bz_task_id       text,
  labor_minutes    integer,
  billed_owner     numeric,                        -- Breezeway cost + supply lines / work-order amount: BILLED, not cost
  labor_cost       numeric,                        -- true cost columns: left null until they are captured
  parts_cost       numeric,
  vendor_cost      numeric,
  refund           numeric,
  repeat_n_90d     integer not null default 0,     -- earlier events, same physical unit + system, in the 90 days before this one
  is_repeat        boolean not null default false,
  prior_event_id   text,
  built_at         timestamptz not null default now(),
  partial          boolean not null default false
);
create index if not exists fme_unit_system_idx on public.fact_maintenance_event (physical_unit_id, system, opened_at desc);
create index if not exists fme_listing_idx     on public.fact_maintenance_event (listing_id, opened_at desc);
create index if not exists fme_building_idx    on public.fact_maintenance_event (building_id, opened_at desc);
create index if not exists fme_opened_idx      on public.fact_maintenance_event (opened_at desc);
create index if not exists fme_repeat_idx      on public.fact_maintenance_event (opened_at desc) where is_repeat;
create index if not exists fme_vendor_idx      on public.fact_maintenance_event (vendor_key, opened_at desc) where vendor_key is not null;
alter table public.fact_maintenance_event enable row level security;

-- ── THE ROLL-UPS ────────────────────────────────────────────────────────────────────────────────
-- One row per PHYSICAL unit per day it was built. score 0–100; the formula is in lib/brain/health.ts
-- and is written into every row (`formula`), with what moved the score in `drivers`.
create table if not exists public.unit_health_daily (
  day                     date not null,
  physical_unit_id        text not null,
  listing_id              text,                    -- the listing the row is shown under
  nickname                text,
  building_id             text,
  market                  text,
  review_avg_live         numeric,                 -- 5-point, reviews left on the listing that is live now, last 365 days
  review_n                integer not null default 0,
  low_reviews_90d         integer not null default 0,
  occupied_nights_90d     integer not null default 0,
  glitches_90d            integer not null default 0,
  glitches_per_100_nights numeric,
  repeat_systems          text[] not null default '{}',
  pm_overdue_count        integer not null default 0,
  pm_max_days_late        integer not null default 0,
  last_inspection_pass    numeric,                 -- 0–1, the newest PM / arrival inspection on the unit
  last_inspection_at      timestamptz,
  net_revenue_90d         numeric,
  upkeep_billed_90d       numeric,
  upkeep_cost_pct_rev     numeric,                 -- (billed upkeep + refunds) ÷ net revenue, 90 days
  score                   integer,
  band                    text,                    -- healthy | watch | risk | critical | unrated
  drivers                 jsonb not null default '[]'::jsonb,
  formula                 text,
  built_at                timestamptz not null default now(),
  partial                 boolean not null default false,
  primary key (day, physical_unit_id)
);
create index if not exists unit_health_day_score_idx on public.unit_health_daily (day desc, score);
create index if not exists unit_health_unit_idx      on public.unit_health_daily (physical_unit_id, day desc);
alter table public.unit_health_daily enable row level security;

create table if not exists public.owner_month (
  month           text not null,                   -- yyyy-MM
  owner_id        text not null,
  owner_name      text,
  units           integer not null default 0,
  available_nights integer not null default 0,
  occupied_nights integer not null default 0,
  owner_nights    integer not null default 0,
  occupancy       numeric,                         -- guest nights ÷ available nights, %
  net_accom       numeric,
  gross_accom     numeric,
  cleaning_rev    numeric,
  revpar          numeric,
  mgmt_fee        numeric,                         -- Revenue App mirror (rev_unit_month.mgmt_fee) when present, else null
  billed_owner    numeric,                         -- upkeep billed to this owner's units
  refunds         numeric,
  glitches        integer not null default 0,
  repeat_events   integer not null default 0,
  maint_events    integer not null default 0,
  review_avg      numeric,
  review_n        integer not null default 0,
  built_at        timestamptz not null default now(),
  partial         boolean not null default true,   -- true until labour cost, claims and statement lines are wired in
  primary key (month, owner_id)
);
alter table public.owner_month enable row level security;

create table if not exists public.vendor_month (
  month                   text not null,           -- yyyy-MM (of the event's opened date)
  vendor_key              text not null,
  vendor_label            text,
  jobs                    integer not null default 0,
  jobs_closed             integer not null default 0,
  median_hours_to_close   numeric,
  repeat_visits           integer not null default 0,
  billed_owner            numeric,
  invoices_total          numeric,                 -- project_invoices for this vendor issued that month
  invoices_n              integer not null default 0,
  built_at                timestamptz not null default now(),
  partial                 boolean not null default true,
  primary key (month, vendor_key)
);
alter table public.vendor_month enable row level security;

-- ── GLITCHES: WHAT IT WAS AND HOW IT WAS FIXED (two optional taps at close) ─────────────────────
alter table public.glitches add column if not exists system     text;
alter table public.glitches add column if not exists root_cause text;
alter table public.glitches add column if not exists resolution text;
alter table public.glitches add column if not exists part       text;
comment on column public.glitches.system is
  'hvac | plumbing | appliance | lock_access | electrical | pest | wifi_tv | furniture | cleaning | other — picked at close (lib/task-categories SYSTEMS). Null = not asked / skipped.';
comment on column public.glitches.resolution is
  'repaired | replaced | no_fault | guest_error — picked at close. Null = skipped.';
comment on column public.glitches.root_cause is 'Free text, optional. Not asked in the close step yet.';
comment on column public.glitches.part is 'What was replaced or repaired, in a few words. Optional.';
create index if not exists glitches_system_idx on public.glitches (system) where system is not null;

notify pgrst, 'reload schema';
