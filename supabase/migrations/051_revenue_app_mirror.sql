-- 051_revenue_app_mirror.sql — Lighthouse's read-only mirror of the Revenue App (Netlify, "DRR").
--
-- THE DECISION (Jon, 2026-08-24). The Revenue App at stay-hospitalitydrr.netlify.app becomes the
-- source of truth for every DOLLAR: actual revenue, budget, QuickBooks expenses and the owner /
-- fee rules. Lighthouse becomes the source of truth for every HOUR, CLEAN, TASK and PERSON — and
-- READS dollars from the Revenue App. Money flows one way (they never write here, we never write
-- there). Lighthouse keeps its own Guesty mirror for the operational objects.
--
-- MIRROR-FIRST, like the Guesty integration. One cron (/api/cron/revenue-sync) pulls the Revenue
-- App's CSV feeds into these tables; every page reads the tables. Nothing calls the Revenue App
-- on a page load.
--
-- TWO LAYERS, ON PURPOSE.
--   rev_feed_row  — EVERY row of EVERY feed, untouched, keyed by feed + month + row hash. This is
--                   the "raw jsonb" rule from the Guesty guide: when the typed mapping below
--                   misses a column (we do not control his headers), the data is still here and a
--                   later migration can re-derive it without a re-sync.
--   rev_*         — typed tables the app actually queries, filled best-effort from the feed rows.
--
-- GUARDRAIL: nothing in here is used by any page until app_settings.revenue_source = 'revenue_app'
-- (see lib/revenue-source.ts). Until then the tables fill quietly and the reconcile page compares
-- them against our own Guesty math.
--
-- RLS ON everywhere, no policies: service-role only, exactly like the Guesty mirror tables.

-- ---------------------------------------------------------------------------------------------
-- Raw landing zone
-- ---------------------------------------------------------------------------------------------
create table if not exists rev_feed_row (
  feed        text not null,          -- snapshots | eom | official-prior | budget | owner-map | building-config | pnl | assumptions | unit-month | reservations
  month       text not null default '', -- YYYY-MM when the feed is month-scoped, '' otherwise
  row_key     text not null,          -- sha1 of the normalised row (so a re-sync is idempotent)
  row_no      int  not null default 0,
  row         jsonb not null,         -- the CSV row as {header: value}, headers normalised to snake_case
  synced_at   timestamptz not null default now(),
  primary key (feed, month, row_key)
);
create index if not exists rev_feed_row_feed_month_idx on rev_feed_row (feed, month);
alter table rev_feed_row enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Typed mirror
-- ---------------------------------------------------------------------------------------------

-- One row per unit per month. `kind` says whether the row is the live/estimate view of an open
-- month (from the daily snapshot), the closed end-of-month number, or the budget line.
create table if not exists rev_unit_month (
  guesty_listing_id text not null,
  month             text not null,                   -- YYYY-MM
  kind              text not null default 'live',    -- live | eom | budget
  unit_name         text,
  building          text,                            -- HIS label (17WEST, Botanica…) — map through buildingOf() before comparing
  owner_name        text,
  nights_available  numeric,
  nights_sold       numeric,
  check_ins         numeric,
  check_outs        numeric,
  occupancy         numeric,                         -- 0-100
  gross_accom       numeric,                         -- before OTA commission
  net_accom         numeric,                         -- after OTA commission (his "Net Accommodation")
  gross_adr         numeric,
  net_adr           numeric,
  gross_cleaning    numeric,
  net_cleaning      numeric,
  mgmt_fee          numeric,                         -- what Stay keeps on this unit
  other_revenue     numeric,
  stay_revenue      numeric,                         -- his "Stay Hospitality Revenue"
  fee_basis         text,                            -- e.g. '10%', '15%', '15.1% mixed'
  as_of             date,                            -- snapshot date the numbers were taken on
  raw               jsonb,
  synced_at         timestamptz not null default now(),
  primary key (guesty_listing_id, month, kind)
);
create index if not exists rev_unit_month_month_idx on rev_unit_month (month, kind);
alter table rev_unit_month enable row level security;

-- Portfolio / building-level budget per month. His budget is uploaded as a file and lives at
-- month grain (Net Accommodation, Management Fee, Net Cleaning, Other → Total); a building or unit
-- split may or may not exist — `scope` carries whichever grain he sends.
create table if not exists rev_budget_month (
  month        text not null,                        -- YYYY-MM
  scope        text not null default 'portfolio',    -- portfolio | building:<label> | unit:<guesty id>
  version      text not null default 'current',      -- e.g. '2026-budget-locked', 'forecast-2026-07-31'
  nights_sold  numeric,
  occupancy    numeric,
  adr          numeric,
  net_accom    numeric,
  mgmt_fee     numeric,
  net_cleaning numeric,
  other_revenue numeric,
  total        numeric,
  raw          jsonb,
  synced_at    timestamptz not null default now(),
  primary key (month, scope, version)
);
alter table rev_budget_month enable row level security;

-- Daily pickup — one row per snapshot day per month (portfolio level; per-unit rows land in
-- rev_unit_month kind='live' with as_of). This is what "vs prior day" and pace are computed from.
create table if not exists rev_snapshot_day (
  month            text not null,
  snapshot_date    date not null,
  scope            text not null default 'portfolio',
  nights_sold      numeric,
  nights_available numeric,
  occupancy        numeric,
  gross_accom      numeric,
  net_accom        numeric,
  net_cleaning     numeric,
  mgmt_fee         numeric,
  reservations     numeric,
  open_nights      numeric,
  forecast_net_accom numeric,
  raw              jsonb,
  synced_at        timestamptz not null default now(),
  primary key (month, snapshot_date, scope)
);
alter table rev_snapshot_day enable row level security;

-- Building rules from his building-config: fee basis, owner-clean flag, market, etc.
create table if not exists rev_building_config (
  building     text primary key,                     -- his label
  fee_pct      numeric,
  fee_basis    text,
  owner_clean  boolean,
  city         text,
  notes        text,
  raw          jsonb,
  synced_at    timestamptz not null default now()
);
alter table rev_building_config enable row level security;

-- Unit → owner, from his owner-map (which he syncs from the Guesty owner directory).
create table if not exists rev_owner_map (
  guesty_listing_id text primary key,
  unit_name         text,
  building          text,
  owner_id          text,
  owner_name        text,
  commission_pct    numeric,
  raw               jsonb,
  synced_at         timestamptz not null default now()
);
alter table rev_owner_map enable row level security;

-- QuickBooks P&L, one row per account per month. `kind` = actual (QB verbatim) | live (open month,
-- Guesty-to-date + projection) | forecast (his editable rates). This is the feed that finally puts
-- payroll and cost-per-clean next to our Homebase numbers.
create table if not exists rev_pnl_line (
  year         int  not null,
  month        text not null,                        -- YYYY-MM
  account      text not null,                        -- '5107', '4101', 'total:5100' …
  account_name text,
  unit         text,                                 -- VR | CLEANING | FEES | OTHER | OWNER PASS-THROUGH (his business units)
  kind         text not null default 'actual',       -- actual | live | forecast
  amount       numeric,
  rate         text,                                 -- his driver rate label ('$/stay', '% of 5104', 'roster'…)
  raw          jsonb,
  synced_at    timestamptz not null default now(),
  primary key (month, account, kind)
);
create index if not exists rev_pnl_line_year_idx on rev_pnl_line (year, unit);
alter table rev_pnl_line enable row level security;

-- Sync bookkeeping — one row per feed. `status` = ok | missing (his app does not offer that type
-- yet — the cron records it rather than failing) | error.
create table if not exists rev_sync_status (
  feed         text primary key,
  status       text not null default 'never',
  last_sync_at timestamptz,
  last_ok_at   timestamptz,
  last_error   text,
  items        int default 0,
  http_status  int,
  updated_at   timestamptz not null default now()
);
alter table rev_sync_status enable row level security;
