-- 056_money_source_and_partner.sql — the two-way partner link.
--
-- WHAT CHANGED (Jon, 2026-08-24). Migration 051 built the one-way mirror of the Revenue App.
-- This one completes the arrangement Jon actually asked for:
--
--   INBOUND  — his app OVERWRITES ours for revenue, expenses, budgets and projections, everywhere
--              a number is shown: KPI board, briefs, Eve, report builders, share links. Not a
--              lens you switch to — the default answer, with our own Guesty math kept only as a
--              LABELLED fallback for windows or units he does not cover.
--   OUTBOUND — he gets Lighthouse view-only, two ways: a read-only LOGIN (the `partner_viewer`
--              role below) and a read-only API his app can pull, exactly mirroring the one we
--              asked him for. He gives us dollars; we give him the operational volumes his
--              cost-per-clean line has never had (completed departure cleans, real clocked hours).
--
-- Nothing here changes a number on its own. `money_domains` decides which domains he owns, and it
-- ships with every domain OFF until the reconcile month passes.

-- ---------------------------------------------------------------------------------------------
-- 1. Projections — his Bear / Base / Bull scenarios per month.
--    051 covered actuals (rev_unit_month), budget (rev_budget_month) and QuickBooks (rev_pnl_line).
--    A projection is none of those: it is a forecast that changes every day the month is open, so
--    it keeps its own `as_of` and we store every vintage rather than overwriting yesterday's.
-- ---------------------------------------------------------------------------------------------
create table if not exists rev_projection (
  month         text not null,                    -- YYYY-MM being forecast
  scenario      text not null default 'base',     -- base | bear | bull | <his own label>
  as_of         date not null,                    -- the day the forecast was made
  scope         text not null default 'portfolio',-- portfolio | building:<label> | unit:<guesty id>
  nights_sold   numeric,
  occupancy     numeric,
  adr           numeric,
  net_accom     numeric,
  net_cleaning  numeric,
  mgmt_fee      numeric,
  other_revenue numeric,
  total         numeric,
  raw           jsonb,
  synced_at     timestamptz not null default now(),
  primary key (month, scenario, as_of, scope)
);
create index if not exists rev_projection_month_idx on rev_projection (month, scenario);
alter table rev_projection enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 2. Outbound access log — every read his app makes of ours.
--    We asked him to log our key's hits; this is us holding ourselves to the same standard, and
--    it is what the status card reads to say "his app last pulled 12 min ago". Metadata only:
--    which feed, how many rows, how long — never the payload.
-- ---------------------------------------------------------------------------------------------
create table if not exists partner_access_log (
  id         bigserial primary key,
  partner    text not null default 'revenue_app',
  feed       text not null,
  params     jsonb,
  rows       int,
  ms         int,
  status     int,
  ip         text,
  at         timestamptz not null default now()
);
create index if not exists partner_access_log_at_idx on partner_access_log (at desc);
alter table partner_access_log enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 3. The read-only LOGIN for him.
--    `perms {"*":"view"}` means every tab loads read-only and every mutation route refuses through
--    requireLevel('…','edit'). Money tabs are listed explicitly at 'view' rather than relying on
--    the star, so that a future feature defaulting to something else cannot quietly widen him.
--    `users` is OFF: a viewer must not be able to see or change who else has access.
--    Assign it in /users → People → access_role = 'partner_viewer', and leave the per-user
--    `features.money` flag ON for him (he owns the money data — hiding dollars from him is theatre).
-- ---------------------------------------------------------------------------------------------
insert into app_roles (key, label, blurb, landing, perms, is_system, sort) values
('partner_viewer', 'Partner (view only)',
 'Read-only across the app for the Revenue App owner. Sees every board; changes nothing.',
 '/revenue',
 '{"*":"view","users":"off","vault":"off","eve":"off"}',
 false, 90)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 4. Settings defaults — written explicitly so the app never has to guess, and so flipping a
--    domain is an audited row change rather than an env edit.
--
--    money_domains: which domains the Revenue App owns. ALL FALSE until July reconciles — turning
--    one on is what makes his numbers overwrite ours on every surface for that domain.
--    partner_out:   what his read-only API may pull from us.
--    app_settings.value is TEXT and a bare scalar round-trips to the fallback, so both are objects.
-- ---------------------------------------------------------------------------------------------
insert into app_settings (key, value, updated_at) values
('money_domains',
 '{"revenue":false,"expenses":false,"budget":false,"projections":false,"maxStaleHours":6}',
 now())
on conflict (key) do nothing;

insert into app_settings (key, value, updated_at) values
('partner_out',
 '{"enabled":false,"feeds":{"units":true,"cleans":true,"labor":true,"tasks":true,"ops-daily":true,"status":true},"includeDollars":true,"includeNames":false}',
 now())
on conflict (key) do nothing;
