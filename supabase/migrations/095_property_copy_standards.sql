-- THE PROPERTY'S OWN WORDS FOR ITSELF.
--
-- Jon, 2026-09-16, asked for bulk editing of the listing sections that describe a place rather than
-- a home — Guest access, Neighborhood, Getting around — and, asked whether the property should keep
-- that text as its standard, said yes.
--
-- WHY THIS TABLE EXISTS AT ALL, when the text also lives on every listing in Guesty. Because the
-- listings are the copies and this is the original. Without it there is no answer to "what is this
-- building supposed to say", so a unit onboarded next month starts blank, and drift is invisible —
-- which is exactly the state it was built to end:
--
--   Elser 32 units / 7 different "getting around" texts / 11 different "neighborhood"
--   Eden  29 units / 27 / 29 — essentially every unit describing the same block differently
--   17WEST 26 units / 15 of them blank on both
--
-- Keyed by the ROLLED-UP building name (lib/optimize-score rollupBuilding), which is the name the
-- Properties page groups by, so "Botanica" is one row however Guesty spells a particular unit's
-- building field.
--
-- Other notes is deliberately NOT here. It is portfolio boilerplate, the same sentence everywhere,
-- and pinning it to a building would invent a per-property meaning it does not have.
create table if not exists property_copy_standards (
  building      text primary key,
  access        text,
  neighborhood  text,
  transit       text,
  updated_by    text,
  updated_at    timestamptz not null default now()
);

alter table property_copy_standards enable row level security;

comment on table property_copy_standards is
  'The approved Guest access / Neighborhood / Getting around text for one property. The listings in Guesty are copies of this; drift is measured against it.';

-- WHO PUSHED LIVE LISTING TEXT, WHEN, AND OVER HOW MUCH.
--
-- These writes leave the app and change what guests read on Airbnb and Booking.com, across dozens of
-- listings in one click. requireLevel already logs that someone called a gated endpoint; it does not
-- record which properties were rewritten. One row per push, not per listing.
create table if not exists listing_copy_pushes (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  by_email      text,
  scope         text not null,          -- 'property' | 'portfolio'
  buildings     text[] not null default '{}',
  sections      text[] not null default '{}',
  listing_count int  not null default 0,
  ok_count      int  not null default 0,
  fail_count    int  not null default 0
);

create index if not exists listing_copy_pushes_at_idx on listing_copy_pushes (at desc);

alter table listing_copy_pushes enable row level security;

comment on table listing_copy_pushes is
  'One row per bulk listing-copy push: who, which properties, which sections, how many listings, how many succeeded.';
