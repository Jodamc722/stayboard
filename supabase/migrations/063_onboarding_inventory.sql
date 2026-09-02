-- ONBOARDING INVENTORY (Jon, 2026-09-02).
--
-- "Create a link we can fill out for onboarding, where we can track inventory for new buildings.
--  It should be agnostic — fill our details, add rooms, add items, add furniture, take photos of a
--  room… make it agnostic and we can assign it to a property later if the property is not live…
--  Master bath, Master bedroom, etc. should have pre-assigned rooms. In the beginning of the form
--  a quick section asks about details — bathroom count, bedroom count, balcony, washer dryer,
--  occupancy, sleeper sofa — and from there it generates a room list, and from there we do the
--  inventory and photo of the room."
--
-- WHY NEW TABLES AND NOT ffe_answers. Every FF&E key is a Guesty listing_id and every FF&E code
-- resolves against guesty_listings — a building that is not live has no ids, so no link, no hub,
-- no photos. And ffe_answers records EXCEPTIONS ("replace the sofa"), never "this room holds two
-- nightstands in good condition". An inventory needs its own rows, keyed by a code we mint here,
-- with a nullable listing_id that gets filled in the day the unit goes live (the 'NEW:' /
-- mergeProspect precedent in app/api/audit/route.ts, done properly).
--
-- Service-role only, RLS on with no policies (the 2026-08-29 lockdown rule).

create table if not exists public.onboarding_units (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,                       -- the share link; the capability
  name         text not null,                              -- "Elser 3707" / "New building — unit 4B"
  building     text,
  unit_no      text,
  address      text,
  owner_name   text,
  owner_contact text,
  details      jsonb not null default '{}'::jsonb,         -- bedrooms, bathrooms, occupancy, balcony, washerDryer, sleeperSofa, parking, kitchen, floor, sqft, notes…
  status       text not null default 'draft',              -- draft | in_progress | complete | linked
  listing_id   text,                                       -- Guesty listing once the unit is live (assigned later)
  linked_at    timestamptz,
  linked_by    text,
  notes        text,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists onboarding_units_listing_idx on public.onboarding_units (listing_id);
create index if not exists onboarding_units_status_idx  on public.onboarding_units (status);

create table if not exists public.onboarding_rooms (
  id         uuid primary key default gen_random_uuid(),
  unit_id    uuid not null references public.onboarding_units(id) on delete cascade,
  key        text not null,                                -- stable key: master_bedroom, bedroom_2, bathroom_2, living, kitchen…
  name       text not null,                                -- editable display name ("Master bedroom")
  kind       text not null,                                -- bedroom | bathroom | living | kitchen | dining | balcony | laundry | entry | other
  sort       int  not null default 0,
  photos     jsonb not null default '[]'::jsonb,           -- [{url, at, caption}]
  notes      text,
  checked_at timestamptz,                                  -- "I stood in this room and the list is right"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, key)
);

create table if not exists public.onboarding_items (
  id         uuid primary key default gen_random_uuid(),
  unit_id    uuid not null references public.onboarding_units(id) on delete cascade,
  room_id    uuid not null references public.onboarding_rooms(id) on delete cascade,
  name       text not null,
  category   text not null default 'furniture',            -- furniture | appliance | electronics | kitchen | linen | decor | safety | other
  qty        int  not null default 1,                      -- how many are actually there
  condition  text,                                         -- null = not confirmed yet | new | good | fair | worn | missing
  brand      text,                                         -- brand / model / size ("Samsung 55in", "King")
  notes      text,
  photo_url  text,
  suggested  boolean not null default false,               -- true = pre-filled from the room template, not yet confirmed
  sort       int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists onboarding_items_room_idx on public.onboarding_items (room_id);
create index if not exists onboarding_items_unit_idx on public.onboarding_items (unit_id);

alter table public.onboarding_units enable row level security;
alter table public.onboarding_rooms enable row level security;
alter table public.onboarding_items enable row level security;

notify pgrst, 'reload schema';
