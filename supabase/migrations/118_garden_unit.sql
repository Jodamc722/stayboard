-- THE GARDEN HOTEL AS ITS OWN BUSINESS UNIT (Jon, 2026-09-29: "look at it as a completely separate
-- business unit… completely different user settings… unified login and have both viewable, but
-- some users are just Garden… its own handbook… different staff, housekeeping, managers, different
-- ways they view the data… Cloudbeds for messaging, calendar sync, multi-calendar, payments").
--
-- One login (auth.users + app_users), two businesses. What a person may do in each is decided
-- separately: app_users.access_role → app_roles for the VR side, app_users.garden_role →
-- garden_roles for the hotel. app_users.businesses says which of the two they can enter at all.

-- 1) Membership -------------------------------------------------------------------------------------
alter table app_users add column if not exists businesses  text[] not null default '{vr}';
alter table app_users add column if not exists garden_role text;
-- Anyone hand-picked for the hotel under the old per-person key keeps it, as the hotel's GM.
update app_users set garden_role = 'gm', businesses = (select array_agg(distinct b) from unnest(businesses || '{garden}'::text[]) b)
 where garden_role is null and coalesce(features->>'garden', 'off') in ('view', 'edit', 'full');

-- 2) The hotel's own roles — per-page levels over the hotel's pages only (lib/business GARDEN_PAGES).
create table if not exists garden_roles (
  key        text primary key,
  label      text not null,
  blurb      text,
  perms      jsonb not null default '{}'::jsonb,    -- { page_key: off|view|edit|full }
  landing    text not null default '/garden',
  sort       int  not null default 100,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into garden_roles (key, label, blurb, landing, sort, perms) values
 ('gm', 'General manager', 'Everything at the hotel, including its users and roles.', '/garden', 10,
  '{"today":"full","rooms":"full","schedule":"full","staff":"full","calls":"full","messages":"full","reviews":"full","calendar":"full","payments":"full","reports":"full","owner-reports":"full","handbook":"full","adam":"full","settings":"full","setup":"full","users":"full"}'),
 ('manager', 'Manager', 'Runs the day: rooms, desk, schedule, guests. Sees the money, no user admin.', '/garden', 20,
  '{"today":"full","rooms":"full","schedule":"full","staff":"edit","calls":"full","messages":"full","reviews":"full","calendar":"edit","payments":"view","reports":"view","owner-reports":"view","handbook":"edit","adam":"view","settings":"view","setup":"off","users":"view"}'),
 ('front_desk', 'Front desk', 'Arrivals, calls, verifications, guest messages and the calendar.', '/garden/calls', 30,
  '{"today":"view","rooms":"view","schedule":"view","staff":"off","calls":"edit","messages":"edit","reviews":"view","calendar":"view","payments":"view","reports":"off","owner-reports":"off","handbook":"view","adam":"view","settings":"off","setup":"off","users":"off"}'),
 ('housekeeping', 'Housekeeping', 'Rooms and cleans, their own schedule, the handbook.', '/garden/rooms', 40,
  '{"today":"view","rooms":"edit","schedule":"view","staff":"off","calls":"off","messages":"off","reviews":"off","calendar":"off","payments":"off","reports":"off","owner-reports":"off","handbook":"view","adam":"view","settings":"off","setup":"off","users":"off"}'),
 ('maintenance', 'Maintenance', 'Rooms and work orders, the schedule, the handbook.', '/garden/rooms', 50,
  '{"today":"view","rooms":"edit","schedule":"view","staff":"off","calls":"off","messages":"off","reviews":"off","calendar":"off","payments":"off","reports":"off","owner-reports":"off","handbook":"view","adam":"view","settings":"off","setup":"off","users":"off"}'),
 ('owner', 'Owner (read-only)', 'The numbers and the owner reports; nothing operational.', '/garden/reports', 60,
  '{"today":"view","rooms":"off","schedule":"off","staff":"off","calls":"off","messages":"off","reviews":"view","calendar":"view","payments":"view","reports":"view","owner-reports":"view","handbook":"off","adam":"off","settings":"off","setup":"off","users":"off"}')
on conflict (key) do nothing;

-- Staff can be a login (hybrid or hotel-only) or just a name on the roster.
alter table garden_staff add column if not exists department text;   -- front_desk | housekeeping | maintenance | management
alter table garden_staff add column if not exists manager_id uuid references garden_staff (id) on delete set null;

-- 3) The hotel's handbook — its own SOPs, in sections. Adam reads it; Eve never does.
create table if not exists garden_handbook (
  id         uuid primary key default gen_random_uuid(),
  section    text not null,
  title      text not null,
  body       text not null default '',
  audience   text[] not null default '{}',   -- garden role keys it is for; empty = everyone
  sort       int  not null default 100,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into garden_handbook (section, title, sort)
select s, t, o from (values
 ('The property', 'Rooms, room types and amenities', 10),
 ('The property', 'Policies: check-in/out times, deposits, pets, parking, smoking', 20),
 ('Front desk', 'Arrivals: welcome call, ID and card verification, check-in', 30),
 ('Front desk', 'Departures and late check-out', 40),
 ('Front desk', 'Guest messaging standards (Cloudbeds)', 50),
 ('Housekeeping', 'Departure clean standard', 60),
 ('Housekeeping', 'Stayover service and inspections', 70),
 ('Maintenance', 'Work orders and vendors', 80),
 ('Money', 'Payments, deposits and refunds (Cloudbeds Payments)', 90),
 ('Money', 'Rates, restrictions and the multi-calendar', 100),
 ('Guests', 'Reviews and service recovery', 110),
 ('Team', 'Roles, shifts and who to call', 120),
 ('Emergencies', 'Emergencies and after-hours', 130)
) v(s, t, o)
where not exists (select 1 from garden_handbook);

-- 4) Adam's learning loop — same shape as Eve's, separate tables.
create table if not exists garden_agent_questions (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  context     text,
  subject     text,
  status      text not null default 'open',   -- open | answered | dismissed
  answer      text,
  answered_by text,
  answered_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists garden_agent_questions_open on garden_agent_questions (status, created_at desc);

-- The one bridge between the brains: knowledge a person marks as true for more than one business
-- ("unless it relates"). Adam reads rows whose businesses include 'garden'; nothing else crosses.
create table if not exists shared_knowledge (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  businesses text[] not null default '{vr,garden}',
  created_by text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- 5) Cloudbeds hub — mirrors of the four things Cloudbeds runs for the hotel.
create table if not exists garden_threads (           -- integrated guest messaging
  id              text primary key,                  -- Cloudbeds thread / conversation id
  reservation_id  text,
  guest_name      text,
  channel         text,                              -- email | sms | whatsapp | ota
  last_message_at timestamptz,
  last_snippet    text,
  unread          int not null default 0,
  status          text not null default 'open',      -- open | waiting | closed
  assigned_to     text,
  synced_at       timestamptz not null default now()
);
create table if not exists garden_messages (
  id          text primary key,
  thread_id   text references garden_threads (id) on delete cascade,
  direction   text not null,                         -- in | out
  author      text,
  body        text,
  sent_at     timestamptz,
  synced_at   timestamptz not null default now()
);
create index if not exists garden_messages_thread on garden_messages (thread_id, sent_at);

create table if not exists garden_calendar (           -- centralized multi-calendar: room type × date
  room_type_id   text not null,
  room_type      text,
  date           date not null,
  available      int,
  total          int,
  rate           numeric,
  rate_plan      text,
  min_stay       int,
  closed         boolean not null default false,
  synced_at      timestamptz not null default now(),
  primary key (room_type_id, date)
);
create table if not exists garden_channels (           -- calendar synchronization: what Cloudbeds pushes where
  id          text primary key,
  name        text not null,
  kind        text,                                  -- ota | ical | gds | direct
  status      text,
  last_sync   timestamptz,
  synced_at   timestamptz not null default now()
);
create table if not exists garden_payments (           -- Cloudbeds Payments
  id              text primary key,
  reservation_id  text,
  guest_name      text,
  kind            text,                              -- charge | refund | deposit | authorization | void
  method          text,
  amount          numeric,
  currency        text default 'USD',
  status          text,
  paid_at         timestamptz,
  note            text,
  synced_at       timestamptz not null default now()
);
create index if not exists garden_payments_at on garden_payments (paid_at desc);
