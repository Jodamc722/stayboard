-- 166 — THE OWNER CATALOG (Jon, 2026-10-28): "a full catalog we can send to owners, they can select
-- their listing and approve items or the list, see comparables, or upload their own link of items
-- they want us to order or purchase".
--
-- One link per OWNER (not per catalog): the owner opens it, picks one of their listings, and works
-- through that listing's catalog. The first choice they make copies the link's template catalog
-- (the default, unless the team chose another) into a catalog for that listing, owned by them —
-- the custom catalog the team orders from later.
--
--   ffe_owner_links                       the owner's link: the code is the capability
--   ffe_approved_decisions.owner_include  the owner's in / out on an item (recommended and suggested
--                                         essentials, "not needed" on furniture); null = the default
--   ffe_catalogs.owner_submitted_at/_note when the owner pressed "Send to Stay", and what they wrote

create table if not exists public.ffe_owner_links (
  code        text primary key,
  owner_id    text not null,
  owner_name  text,
  template    text not null default 'default',
  tier        text,
  message     text,
  created_by  text,
  created_at  timestamptz not null default now(),
  views       integer not null default 0,
  last_view   timestamptz,
  revoked_at  timestamptz
);
create index if not exists ffe_owner_links_owner on public.ffe_owner_links (owner_id);
alter table public.ffe_owner_links enable row level security;

alter table public.ffe_approved_decisions add column if not exists owner_include boolean;
alter table public.ffe_catalogs add column if not exists owner_submitted_at timestamptz;
alter table public.ffe_catalogs add column if not exists owner_note text;
create index if not exists ffe_catalogs_listing on public.ffe_catalogs (listing_id) where archived_at is null;
