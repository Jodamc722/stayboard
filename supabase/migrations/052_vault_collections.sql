-- VAULTS WITHIN THE VAULT (Jon, 2026-08-25: "some access should only be for managers, etc.
-- I should be able to add them to a private vault").
--
-- Migration 017 gave every item its own deny-by-default share list. That works for one gate code
-- and collapses at 94 logins: granting the front desk the twelve things they need is twelve
-- separate share panels, and revoking a leaver is ninety-four.
--
-- A COLLECTION is a named vault. An item belongs to at most one. Access to the collection is
-- granted two ways, and they add up:
--   MEMBERS — named people, like the per-item grants but declared once.
--   ROLES   — app_roles keys, so "Managers" keeps working when a person changes job.
--
-- THE DEFAULT IS STILL DENY. collection_id NULL means the item is private to its owner and the
-- people it was individually shared with — which is exactly where the 94 imported logins sit, so
-- running this migration widens access to NOTHING. Things become visible only when somebody
-- deliberately moves them into a collection.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

create table if not exists vault_collections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null,
  description text,

  -- app_roles keys that get access, e.g. '{admin,manager}'. Empty = named members only.
  roles       text[] not null default '{}',

  -- What membership buys: 'view' can open and reveal; 'manage' can also edit and re-file items.
  -- Deliberately per-collection rather than per-member, so "who can change the front desk's
  -- logins" is one answer you can read off the screen instead of twelve.
  level       text not null default 'view' check (level in ('view', 'manage')),

  -- Cosmetic, so a vault is recognisable at a glance in the switcher.
  color       text,

  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create unique index if not exists idx_vault_collection_slug
  on vault_collections(slug) where deleted_at is null;

create table if not exists vault_collection_members (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references vault_collections(id) on delete cascade,
  email         text not null,
  added_by      text,
  created_at    timestamptz not null default now()
);

create unique index if not exists idx_vault_collection_member_unique
  on vault_collection_members(collection_id, lower(email));
create index if not exists idx_vault_collection_member_email
  on vault_collection_members(lower(email));

-- One item, at most one vault. ON DELETE SET NULL on purpose: deleting a collection must never
-- delete credentials, it drops them back to owner-only — the safe direction.
alter table vault_items
  add column if not exists collection_id uuid references vault_collections(id) on delete set null;

create index if not exists idx_vault_items_collection
  on vault_items(collection_id) where deleted_at is null;

-- Same posture as migration 017: RLS on, no permissive policy, every read and write goes through
-- the service role in our own API where the access check and the audit write live.
alter table vault_collections        enable row level security;
alter table vault_collection_members enable row level security;

-- Two vaults to start, both EMPTY of items and of people. Jon adds members and moves items in;
-- nothing is visible to anyone until he does.
insert into vault_collections (name, slug, description, roles, level, color, created_by)
select 'Managers', 'managers',
       'Company logins the management team needs. Granted by role, so it follows job changes.',
       '{admin}', 'view', 'amber', 'system'
where not exists (select 1 from vault_collections where slug = 'managers');

insert into vault_collections (name, slug, description, roles, level, color, created_by)
select 'Front desk / CCS', 'front-desk',
       'The handful of logins guest services actually need on shift.',
       '{}', 'view', 'sky', 'system'
where not exists (select 1 from vault_collections where slug = 'front-desk');

notify pgrst, 'reload schema';
