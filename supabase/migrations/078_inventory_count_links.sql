-- INVENTORY COUNT LINKS (Jon, 2026-09-10).
--
-- "We need a better inventory management system. Should be easier to count. Should be an inventory
--  link that can be managed. They add a count of each item and overwrites what we have in stock,
--  it should show who did the count."
--
-- Counting today means signing in to the ops app and editing a dense board — so it does not happen,
-- and the guest form quietly serves items that ran out weeks ago. This is the same shape as the
-- team scheduler link: the code IS the capability, no login, an optional passcode, and the person
-- counting types their name. One link covers every shelf; they pick the storeroom they are standing
-- in (Jon's choice, 2026-09-10).
--
-- A COUNT IS A RECORD, NOT JUST A WRITE. `inventory_counts` keeps who counted, which shelf, when,
-- and every line with its BEFORE and AFTER — so "who did the count" has an answer, and a number
-- that looks wrong next week can be traced to the person and the moment instead of argued about.
-- Skipped items are absent from `lines` and left untouched: a partial count must never zero a shelf.
create table if not exists public.inventory_count_links (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  label        text,
  passcode     text,                                  -- optional second factor
  created_by   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create table if not exists public.inventory_counts (
  id           uuid primary key default gen_random_uuid(),
  link_code    text,                                  -- null when counted from inside the app
  scope        text not null,                         -- 'global' | 'hub:<id>'
  scope_label  text,
  counted_by   text not null,                         -- the name typed on the phone
  note         text,
  lines        jsonb not null default '[]'::jsonb,    -- [{itemId, name, before, after, delta}]
  items        integer not null default 0,            -- how many lines were counted
  changed      integer not null default 0,            -- how many actually moved
  created_at   timestamptz not null default now()
);
create index if not exists inventory_counts_scope_idx on public.inventory_counts (scope, created_at desc);
create index if not exists inventory_counts_link_idx  on public.inventory_counts (link_code, created_at desc);

alter table public.inventory_count_links enable row level security;
alter table public.inventory_counts      enable row level security;
notify pgrst, 'reload schema';
