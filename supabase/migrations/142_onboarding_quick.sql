-- QUICK ONBOARDING — many units, one simple form (Jon, 2026-10-02: "an onboarding form, simple,
-- clean, but for multi units … bed count and sizes, room number, bathrooms, kitchen (coffee maker
-- yes), utensils (no), stove, refrigerator yes, freezer yes … add photos, does not have to be so
-- robust"). The deep inventory (onboarding_units/rooms/items, migration 063) stays for the full
-- room-by-room count; this is the high-level card per unit the team fills in an afternoon.
create table if not exists public.onboarding_quick (
  id          uuid primary key default gen_random_uuid(),
  building    text not null,
  unit_no     text not null,
  status      text not null default 'draft',               -- draft | done
  data        jsonb not null default '{}'::jsonb,          -- beds, bathrooms, maxGuests, features {key: 'yes'|'no'}, picks, notes, photos [{url, at}]
  listing_id  text,                                        -- the Guesty listing, once it is live
  created_by  text,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists onboarding_quick_building_idx on public.onboarding_quick (building, unit_no);
alter table public.onboarding_quick enable row level security;
notify pgrst, 'reload schema';
