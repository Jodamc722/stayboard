-- GARDEN — what the Cloudbeds audit (2026-11-04) found readable for the front desk and operations.
-- Housekeeping assignment detail per room, out-of-service blocks, and a source column on threads so
-- the unified inbox can sort by where a conversation came from.
alter table garden_rooms add column if not exists housekeeper      text;
alter table garden_rooms add column if not exists housekeeper_id   text;
alter table garden_rooms add column if not exists hk_comments      text;
alter table garden_rooms add column if not exists dnd              boolean not null default false;
alter table garden_rooms add column if not exists refused_service  boolean not null default false;
alter table garden_rooms add column if not exists frontdesk_status text;
alter table garden_rooms add column if not exists blocked          boolean not null default false;

create table if not exists garden_room_blocks (     -- Cloudbeds room blocks: out of service / maintenance
  id          text primary key,
  room_ids    text[] not null default '{}',
  room_names  text[] not null default '{}',
  kind        text,                                  -- out_of_service | blocked | courtesy_hold
  reason      text,
  start_date  date,
  end_date    date,
  synced_at   timestamptz not null default now()
);
alter table garden_room_blocks enable row level security;

alter table garden_threads add column if not exists source text;   -- email | sms | whatsapp | phone | review | note | ota | web
create index if not exists garden_threads_last on garden_threads (last_message_at desc);
