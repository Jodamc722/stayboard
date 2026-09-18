-- ONE LINK MODEL, INDIVIDUAL PASSCODES (Jon, 2026-09-18).
--
--   "Revamp the sharable links page: make it smarter, more customizable, have a prompt for
--    creating one, and make them more organized." "Should not be team password — individual
--    password per link."
--
-- Before this, "share links" were four different things with four different locks: rows here
-- (custom reports / field boards / parking), rows in schedule_links (the team scheduler), and a
-- dozen fixed pages (/vendor/*, /day, /delivery, /report/*) that all opened on one of FOUR family
-- passwords in share_settings (ids 1, 3, 4, 7). Every cleaning crew held the same password; you
-- could not turn one vendor off without turning them all off.
--
-- Now every shareable page is a ROW in share_links, with its own passcode (scrypt hash, never
-- plaintext), its own expiry, its own revoke, and a `scope` that says what the page shows.
--
--   kind      what page the code opens (lib/share-links.ts KINDS)
--   audience  who it is for: crew | vendor | owner | guest | partner | internal
--   scope     jsonb — vendor slug, market, buildings, listing ids, sections, date range, showMoney…
--   open      true = no passcode needed (the code alone is the capability: order forms, guides,
--             and custom links made without one). Every migrated family page is NOT open: it
--             stays shut until Jon sets its passcode on /links.
--
-- The family passwords in share_settings 1/3/4/7 are retired by the app (no code reads them after
-- this ships); the rows are left in place so a rollback still has them.
alter table public.share_links add column if not exists kind          text not null default 'custom-page';
alter table public.share_links add column if not exists title         text;
alter table public.share_links add column if not exists audience      text not null default 'internal';
alter table public.share_links add column if not exists scope         jsonb not null default '{}'::jsonb;
alter table public.share_links add column if not exists passcode_hash text;
alter table public.share_links add column if not exists passcode_hint text;
alter table public.share_links add column if not exists open          boolean not null default false;
alter table public.share_links add column if not exists expires_at    timestamptz;
alter table public.share_links add column if not exists last_used_at  timestamptz;
alter table public.share_links add column if not exists uses          integer not null default 0;
alter table public.share_links add column if not exists notes         text;
alter table public.share_links add column if not exists updated_at    timestamptz not null default now();

-- Carry the existing custom links across. Their old `passcode` column held either an scrypt hash
-- ("s1$…", written since P0-5) or a legacy plaintext. Both move to passcode_hash; the app hashes
-- any plaintext it finds there the first time the hub loads (it has the cleartext, SQL does not
-- have scrypt), and the column is dropped so nothing can write plaintext to it again.
update public.share_links set title = label where title is null;
update public.share_links set passcode_hash = passcode where passcode_hash is null and passcode is not null and passcode <> '';
update public.share_links set kind = 'parking'
  where kind = 'custom-page' and coalesce(sections->>'parking', '') = 'true';
update public.share_links set kind = 'field-board'
  where kind = 'custom-page' and (
    coalesce(sections->>'today', '') = 'true' or coalesce(sections->>'units', '') = 'true' or coalesce(sections->>'crew', '') = 'true'
    or coalesce(sections->>'cleans', '') = 'true' or coalesce(sections->>'verify', '') = 'true' or coalesce(sections->>'vacant', '') = 'true'
    or coalesce(sections->>'work', '') = 'true' or coalesce(sections->>'issues', '') = 'true' or coalesce(sections->>'requests', '') = 'true'
    or coalesce(sections->>'add', '') = 'true');
-- A custom REPORT made without a passcode always opened on its code alone: it stays open. A field
-- board without one used to fall back to the team share password; that password is gone, so such
-- a board is shut ("no passcode yet") until one is set on /links — never silently open.
update public.share_links set open = true where passcode_hash is null and kind = 'custom-page';
update public.share_links set audience = case
    when kind = 'parking' then 'vendor'
    when kind = 'field-board' then 'crew'
    when coalesce(sections->>'contacts', '') = 'true' or coalesce(sections->>'marketing', '') = 'true' or coalesce(sections->>'audience', '') = 'true' then 'partner'
    when scope_type = 'owner' then 'owner'
    else 'internal' end
  where audience = 'internal';
update public.share_links set scope = jsonb_build_object(
    'scopeType', scope_type, 'scopeIds', to_jsonb(coalesce(scope_ids, '{}'::text[])),
    'sections', coalesce(sections, '{}'::jsonb), 'showMoney', show_money, 'guestNames', guest_names, 'windowDays', window_days)
  where scope = '{}'::jsonb;
alter table public.share_links drop column if exists passcode;

-- The team scheduler links move in (kind 'scheduler'). Codes are 12 hex characters and unique in
-- their old table; a collision with a 16-hex custom code is not possible by length. Their
-- passcodes were plaintext: the app hashes them on first hub load, exactly like the rows above.
insert into public.share_links (code, kind, title, label, audience, scope, passcode_hash, open, created_by, created_at, revoked_at)
select s.code, 'scheduler', coalesce(s.label, s.market || ' team schedule'), coalesce(s.label, s.market || ' team schedule'), 'crew',
       jsonb_build_object('market', s.market, 'viewOnly', coalesce(s.view_only, false)),
       nullif(s.passcode, ''), (s.passcode is null or s.passcode = ''), s.created_by, s.created_at, s.revoked_at
from public.schedule_links s
on conflict (code) do nothing;

-- THE FORMER FAMILY PAGES, one row each, on the same code the URL already carries. None of them is
-- open, and none has a passcode yet: each stays shut until Jon sets one on /links (the hub shows
-- the passcode once, then only its hint). The old family cookies stop working the moment this
-- ships; whoever holds a link types its new passcode once and gets a 30-day cookie for THAT link.
insert into public.share_links (code, kind, title, label, audience, scope, open, notes) values
  ('botanica',            'vendor-board', 'Botanica — cleaning board',                 'Botanica — cleaning board',                 'vendor',   '{"vendor":"botanica"}',           false, 'Today and tomorrow for the vendor crew. /vendor/botanica'),
  ('pt',                  'vendor-board', 'Park Towers — cleaning board',              'Park Towers — cleaning board',              'vendor',   '{"vendor":"pt"}',                 false, 'Today and tomorrow for the vendor crew. /vendor/pt'),
  ('amrit-capri-lucerne', 'vendor-board', 'Amrit / Capri / Lucerne — cleaning board',  'Amrit / Capri / Lucerne — cleaning board',  'vendor',   '{"vendor":"amrit-capri-lucerne"}', false, 'Today and tomorrow for the vendor crew. /vendor/amrit-capri-lucerne'),
  ('salato',              'vendor-board', 'Salato — front desk board',                 'Salato — front desk board',                 'partner',  '{"vendor":"salato"}',             false, 'Arrivals, codes and house rules for the desk. /vendor/salato'),
  ('salato-desk',         'salato-desk',  'Salato — occupancy & ID viewer',            'Salato — occupancy & ID viewer',            'partner',  '{}',                              false, 'The front-desk occupancy board with the verification photo viewer. /salato/share'),
  ('day',                 'day-sheet',    'Day sheet — crew',                          'Day sheet — crew',                          'crew',     '{}',                              false, 'The mobile day sheet — arrivals, departures, cleans, who clocked in. /day'),
  ('delivery',            'delivery',     'Delivery log',                              'Delivery log',                              'crew',     '{}',                              false, 'What landed at the building today. /delivery'),
  ('orders-live',         'orders-live',  'Guest orders — live',                       'Guest orders — live',                       'crew',     '{}',                              false, 'Today''s guest orders by building, one tap to mark delivered. /orders-live'),
  ('marketing',           'marketing',    'Direct bookings report — partners',         'Direct bookings report — partners',         'partner',  '{}',                              false, 'Month-by-month direct vs OTA for marketing partners. /report/marketing'),
  ('owner-audit',         'owner-audit',  'Owner statement audit — reviewers',         'Owner statement audit — reviewers',         'internal', '{}',                              false, 'Statement review for whoever works the audit. /report/owner-audit'),
  ('botanica-report',     'botanica',     'Botanica performance report — Margaux',     'Botanica performance report — Margaux',     'owner',    '{}',                              false, 'Daily occupancy, ADR and revenue since opening. /report/botanica'),
  ('owner-orders',        'order-form',   'Owner order sheet',                         'Owner order sheet',                         'owner',    '{}',                              true,  'Owners approve spend item by item. Open link. /owner-orders'),
  ('new-order',           'order-form',   'New order request',                         'New order request',                         'crew',     '{}',                              true,  'Anyone on site can raise an order. Open link. /new-order')
on conflict (code) do nothing;

create index if not exists share_links_kind_idx on public.share_links (kind) where revoked_at is null;
create index if not exists share_links_audience_idx on public.share_links (audience) where revoked_at is null;
