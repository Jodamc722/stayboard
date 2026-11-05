-- 172_lost_found.sql — LOST & FOUND (Jon, 2026-11-04: "a lost and found tab that views lost and
-- found items, assign to reservation and manage this"). One row per thing a cleaner or inspector
-- finds in a unit. The row is logged against the UNIT and the day it was found; the team then
-- attaches the STAY it belongs to (the reservation that was in that unit before the find — the
-- picker on /lost-found offers those first), contacts the guest, and walks it to a close: returned
-- in person, shipped, donated or discarded after the hold window. `history` is the audit trail
-- (every status change and note, who and when); `photos` holds storage paths in the private
-- `lost-found-files` bucket, served through /api/lost-found/photo like glitch photos.
-- Service-role only: RLS on, no policies. Safe to run twice.
create table if not exists lost_found_items (
  id               uuid primary key default gen_random_uuid(),
  -- where and when
  listing_id       text,                          -- guesty_listings.id (text to match the rest of the app)
  unit             text not null,                 -- the listing's nickname at the time of logging
  market           text,
  item             text not null,                 -- "Grey hoodie", "AirPods case"
  description      text,
  category         text not null default 'other', -- clothing | electronics | documents | jewelry | toiletries | toys | keys_cards | other
  found_where      text,                          -- "under the bed, room 2"
  found_date       date not null,
  found_by         text,                          -- the cleaner / inspector (free text or a roster name)
  storage_location text,                          -- where it is held now: "Broward office, bin 3"
  photos           jsonb not null default '[]'::jsonb,
  -- the stay it belongs to (attached by the team; null until then)
  reservation_id   text,
  guest_name       text,
  guest_phone      text,
  guest_email      text,
  check_in         date,
  check_out        date,
  -- the walk to a close
  status           text not null default 'held',  -- held | contacted | claimed | shipping | returned | donated | discarded
  contacted_at     timestamptz,
  contact_note     text,
  shipping_carrier text,
  tracking         text,
  shipping_cost    numeric(10,2),
  shipping_paid    boolean not null default false,
  resolved_at      timestamptz,
  notes            text,
  history          jsonb not null default '[]'::jsonb,
  -- when the row came from the lost-and-found Slack channel (lib/lost-found-slack): the post it
  -- was read from, so a post is never logged twice, and a link back to it
  slack_ts         text,
  slack_permalink  text,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists lost_found_items_status_idx on lost_found_items (status, found_date desc);
create index if not exists lost_found_items_listing_idx on lost_found_items (listing_id, found_date desc);
create index if not exists lost_found_items_reservation_idx on lost_found_items (reservation_id);
create unique index if not exists lost_found_items_slack_uidx on lost_found_items (slack_ts) where slack_ts is not null;
alter table lost_found_items enable row level security;
