-- STAYBOARD v2 — Guesty cache schema
-- Source of truth for all reservations, listings, conversations, messages, and custom field defs.
-- App reads from these tables. Sync job writes from Guesty Open API.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

-- ─────────────────────────────────────────────────────────────────
-- OAuth token cache (so we don't hit Guesty's token endpoint on every request)
-- ─────────────────────────────────────────────────────────────────
create table if not exists guesty_tokens (
  id           text primary key default 'singleton',
  access_token text not null,
  expires_at   timestamptz not null,
  updated_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────
-- Custom field definitions (Welcome Call, Verified, Sensitive Guest, etc.)
-- pulled from Guesty so we use the customer's actual field IDs
-- ─────────────────────────────────────────────────────────────────
create table if not exists guesty_custom_fields (
  id        text primary key,
  name      text not null,
  type      text not null,
  target    text not null,
  options   text[],
  synced_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────
-- Reservations
-- ─────────────────────────────────────────────────────────────────
create table if not exists guesty_reservations (
  id                 text primary key,
  listing_id         text,
  listing_name       text,
  guest_id           text,
  guest_name         text,
  guest_email        text,
  guest_phone        text,
  check_in           date,
  check_out          date,
  nights             integer,
  status             text,
  source             text,
  confirmation_code  text,
  money_total        numeric,
  money_paid         numeric,
  money_balance      numeric,
  money_currency     text,
  notes              text,
  custom_fields      jsonb,
  conversation_id    text,
  created_at         timestamptz,
  synced_at          timestamptz not null default now(),
  raw                jsonb           -- full Guesty payload for re-parsing
);
create index if not exists idx_guesty_reservations_check_in on guesty_reservations(check_in desc);
create index if not exists idx_guesty_reservations_status   on guesty_reservations(status);
create index if not exists idx_guesty_reservations_listing  on guesty_reservations(listing_id);
create index if not exists idx_guesty_reservations_source   on guesty_reservations(source);

-- ─────────────────────────────────────────────────────────────────
-- Listings
-- ─────────────────────────────────────────────────────────────────
create table if not exists guesty_listings (
  id            text primary key,
  title         text,
  nickname      text,
  -- Building grouping: derived from name (e.g. "17WEST - 406 - 3B LOFT" -> "17WEST")
  -- or pulled from a Guesty custom field if Jon sets one up.
  building      text,
  unit          text,           -- "406", "502", etc.
  room_type     text,           -- "3B LOFT", "Studio", "King Studio - B", etc.
  tags          text[],         -- listing tags from Guesty + manual tags for filtering
  address_full  text,
  address_city  text,
  address_state text,
  bedrooms      integer,
  bathrooms     numeric,
  beds          integer,
  max_occupancy integer,
  status        text,
  pictures      text[],
  amenities     text[],
  synced_at     timestamptz not null default now(),
  raw           jsonb
);
create index if not exists idx_guesty_listings_building on guesty_listings(building);
create index if not exists idx_guesty_listings_tags     on guesty_listings using gin(tags);
create index if not exists idx_guesty_listings_status   on guesty_listings(status);

-- ─────────────────────────────────────────────────────────────────
-- Conversations
-- ─────────────────────────────────────────────────────────────────
create table if not exists guesty_conversations (
  id                   text primary key,
  reservation_id       text,
  listing_id           text,
  guest_name           text,
  channel              text,
  last_message_at      timestamptz,
  last_message_preview text,
  unread_count         integer default 0,
  synced_at            timestamptz not null default now(),
  raw                  jsonb
);
create index if not exists idx_guesty_conversations_last_msg on guesty_conversations(last_message_at desc);
create index if not exists idx_guesty_conversations_res on guesty_conversations(reservation_id);

-- ─────────────────────────────────────────────────────────────────
-- Messages (individual posts inside conversations)
-- ─────────────────────────────────────────────────────────────────
create table if not exists guesty_messages (
  id              text primary key,
  conversation_id text not null,
  sender          text,
  sender_name     text,
  body            text,
  sent_at         timestamptz,
  attachments     jsonb,
  synced_at       timestamptz not null default now(),
  raw             jsonb
);
create index if not exists idx_guesty_messages_convo on guesty_messages(conversation_id, sent_at);

-- ─────────────────────────────────────────────────────────────────
-- Sync status (so the UI can show "last synced X ago" and surface errors)
-- ─────────────────────────────────────────────────────────────────
create table if not exists guesty_sync_status (
  entity         text primary key,  -- 'reservations' | 'listings' | 'conversations' | 'messages' | 'custom_fields'
  last_sync_at   timestamptz,
  last_error     text,
  items_synced  integer default 0,
  updated_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────
-- Row Level Security: authenticated users can READ all rows.
-- WRITE access is service-role-only (sync job uses the service role key).
-- The tokens table is NEVER readable from the client.
-- ─────────────────────────────────────────────────────────────────
alter table guesty_tokens         enable row level security;
alter table guesty_custom_fields  enable row level security;
alter table guesty_reservations   enable row level security;
alter table guesty_listings       enable row level security;
alter table guesty_conversations  enable row level security;
alter table guesty_messages       enable row level security;
alter table guesty_sync_status    enable row level security;

-- Authenticated read policies (drop+create so the script is idempotent)
drop policy if exists "authenticated read" on guesty_custom_fields;
drop policy if exists "authenticated read" on guesty_reservations;
drop policy if exists "authenticated read" on guesty_listings;
drop policy if exists "authenticated read" on guesty_conversations;
drop policy if exists "authenticated read" on guesty_messages;
drop policy if exists "authenticated read" on guesty_sync_status;

create policy "authenticated read" on guesty_custom_fields  for select to authenticated using (true);
create policy "authenticated read" on guesty_reservations   for select to authenticated using (true);
create policy "authenticated read" on guesty_listings       for select to authenticated using (true);
create policy "authenticated read" on guesty_conversations  for select to authenticated using (true);
create policy "authenticated read" on guesty_messages       for select to authenticated using (true);
create policy "authenticated read" on guesty_sync_status    for select to authenticated using (true);
-- guesty_tokens: no read policy = no client access. Only service role (which bypasses RLS) can read/write.
