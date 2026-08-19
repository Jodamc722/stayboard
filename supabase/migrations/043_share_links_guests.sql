-- SHARE LINKS HUB + GUEST PROFILES (Jon, 2026-08-18):
--
--   "The sharable reservation links, rev links I have created to share — there should be a place
--    where I can create those links based on properties, units, owners and customize them to show
--    different information... reservations, adr, cleaning, verification, reservation notes, etc.
--    It can be any live data we can share, even the marketing one."
--   "Also a tab where we have guest info, all guest info, create a guest profile as well."
--
-- share_links: one row per custom link. The CODE is random and stored (not derived) because these
-- links are configurable and revocable — deleting the row kills the link, editing the row changes
-- what every holder of it sees, live. sections is a jsonb bag of booleans so new shareable data
-- never needs a schema change.
create table if not exists share_links (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  label       text,
  scope_type  text not null default 'portfolio',   -- portfolio | building | owner | listing
  scope_ids   text[] not null default '{}',        -- building names / owner ids / listing ids
  sections    jsonb not null default '{}',         -- { reservations, revenue, marketing, cleaning, verification, notes }
  show_money  boolean not null default false,      -- dollar figures on/off, one switch for the whole link
  guest_names boolean not null default false,      -- full guest names vs first name + initial
  window_days integer not null default 30,
  passcode    text,                                -- optional; viewer types it before data loads
  created_by  text,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

-- guest_profiles: OUR layer on top of Guesty's guest records. Keyed by normalised email (fallback:
-- guesty guest id) so the same person across five reservations is one profile. VIP here feeds the
-- auto-inspection engine: profile VIP = pre-arrival inspection on their next stay.
create table if not exists guest_profiles (
  guest_key  text primary key,
  name       text,
  email      text,
  phone      text,
  vip        boolean not null default false,
  tags       text[] not null default '{}',
  notes      text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table share_links disable row level security;
alter table guest_profiles disable row level security;

-- ARRIVAL-DAY AUTO-DRAFTS (Jon, 2026-08-18: "auto draft messages for the reservation front desk
-- notices in the inbox the day of arrival"). draft_created_at is the exactly-once anchor: the
-- morning cron drafts each of today's unsent notices into Gmail once, however often it reruns.
alter table reservation_notices add column if not exists draft_created_at timestamptz;
alter table reservation_notices add column if not exists draft_id text;
