-- 143 — VAULT ACCESS, PER PERSON (Jon, 2026-10-02: "revamp the vault, make it more accessible but
-- still secure. Log all activity and track access and be able to remove access. This should be a
-- per user setting vs a role.")
--
-- One row per person. Nobody opens the vault without a row that is switched on — not by role, not
-- by being an admin; only the workspace owner is implied. Each person has their OWN PIN (hashed),
-- so the shared vault code stops being the key everyone passes around, and a revoke is one switch:
-- it closes the door and kills any open unlock window on the spot (the window is signed over
-- `version`, which the revoke bumps).
create table if not exists public.vault_access (
  email          text primary key,
  enabled        boolean not null default true,
  -- What they may do with the items they can see: open and reveal, or also edit and re-file.
  level          text not null default 'view' check (level in ('view', 'manage')),
  -- Which vaults (vault_collections ids). NULL = every vault; '{}' = only items granted to them by name.
  collections    uuid[],
  pin_hash       text,
  pin_set_at     timestamptz,
  version        integer not null default 1,
  granted_by     text,
  granted_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by     text,
  note           text,
  last_unlock_at timestamptz,
  unlock_count   integer not null default 0,
  updated_at     timestamptz not null default now()
);
alter table public.vault_access enable row level security;

-- Anyone already on a vault's member list or named on an item keeps the door open (no PIN yet —
-- the admin sets one under Vault → Access). Ran 2026-10-02: no such rows existed.
insert into public.vault_access (email, enabled, level, collections, granted_by, note)
select distinct lower(e), true, 'view', null::uuid[], 'migration 143', 'seeded from existing vault membership'
from (
  select email as e from public.vault_collection_members
  union select email from public.vault_grants
) x
where e is not null and lower(e) <> 'jon@stay-hospitality.com'
on conflict (email) do nothing;
notify pgrst, 'reload schema';
