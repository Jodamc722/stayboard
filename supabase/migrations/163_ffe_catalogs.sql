-- 163 — CATALOGS IN THE DATABASE (Jon, 2026-10-27): "we should be able to build custom catalogs
-- for our units… create a default catalog for onboarding… links, select suppliers".
--
-- Migration 162 kept the catalog as a JSON file in the repo and only the DECISIONS in the database.
-- That made one catalog. This moves the catalog itself into three tables so there can be many:
--   ffe_catalogs          one row per catalog — the DEFAULT (what every onboarding starts from)
--                         and one per property/unit, cloned from it. `suppliers` is the pick list:
--                         options from suppliers not in it are hidden from review and from the link.
--   ffe_catalog_items     an item on a catalog: nightstand, sofa bed, coffee pods…
--   ffe_catalog_options   a way to buy that item — supplier, product name, link, price, photo.
-- Decisions (162: ffe_approved_decisions) and share links (ffe_catalog_shares) stay as they are;
-- their `property` column is the catalog slug.
--
-- The default is seeded from the 17 West build (lib/ffe-approved-catalog-17west.json) the first
-- time it is read, and the existing '17-west' slug is created as a clone of it so the approvals
-- already made keep pointing at the same items. Nothing here runs on its own: until this migration
-- is applied, the catalog page keeps working from the JSON file as before.

create table if not exists public.ffe_catalogs (
  slug        text primary key,                 -- 'default', '17-west', 'salato-302'…
  name        text not null,
  kind        text not null default 'property', -- default | property
  based_on    text,                             -- slug it was cloned from
  suppliers   text[] not null default '{}',     -- supplier keys allowed on this catalog; empty = all
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.ffe_catalog_items (
  id          uuid primary key default gen_random_uuid(),
  catalog     text not null references public.ffe_catalogs(slug) on delete cascade,
  key         text not null,                    -- stable within the catalog: 'cmp-1', 'solo-3', 'am-9', 'x-<id>'
  section     text not null default 'vendor',   -- compare | vendor | amenity
  category    text not null default 'Other',
  name        text not null,
  sort        integer not null default 0,
  archived_at timestamptz,
  unique (catalog, key)
);
create index if not exists ffe_catalog_items_catalog on public.ffe_catalog_items (catalog);

create table if not exists public.ffe_catalog_options (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.ffe_catalog_items(id) on delete cascade,
  src         text not null,                    -- supplier key: host | amz | ch | wf | lowes | samsung | staples | other…
  vendor      text not null,                    -- display name: 'HostGPO · Article', 'Amazon', 'City Home'…
  name        text not null,
  url         text,
  price       numeric(10,2),
  each        text,                             -- per-unit price as text ('$0.89', '$10.78 / box')
  image_url   text,
  chips       text[] not null default '{}',
  fit         text not null default 'contain',  -- cover | contain
  sort        integer not null default 0,
  archived_at timestamptz
);
create index if not exists ffe_catalog_options_item on public.ffe_catalog_options (item_id);

alter table public.ffe_catalogs enable row level security;
alter table public.ffe_catalog_items enable row level security;
alter table public.ffe_catalog_options enable row level security;

-- SUGGESTIONS (Jon, 2026-10-27: "look at photos of the listing and build a catalog to resemble the
-- style… standard, mid-lux or luxury"). The generator reads the listing's photos and, per item,
-- proposes which option fits — stored here beside the decision, never AS the decision: a suggestion
-- is approved with a click, not by being made.
alter table public.ffe_approved_decisions add column if not exists suggested text[] not null default '{}';
alter table public.ffe_approved_decisions add column if not exists suggest_note text;
alter table public.ffe_catalogs add column if not exists tier text;          -- standard | midlux | luxury
alter table public.ffe_catalogs add column if not exists listing_id text;    -- the Guesty listing it was generated from
alter table public.ffe_catalogs add column if not exists style_brief text;   -- what the photos said about the look
