-- PERSONAL READ-ONLY API KEYS (Jon, 2026-09-25: "create a read API key only for user on app").
--
-- A key belongs to one person and reads exactly what that person can see in Lighthouse — the same
-- per-feature levels the sidebar uses — and can never write. Only the SHA-256 of the key is kept;
-- the plaintext is shown once, at creation, and never again. `prefix` (the first 12 characters)
-- is what the list shows so a person can tell their keys apart.
create table if not exists api_keys (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,                       -- the person the key acts as (app_users.email)
  label        text not null default '',
  prefix       text not null,
  key_hash     text not null unique,
  scopes       text[] not null default '{read}',     -- read only, by design; kept as a column so it is auditable
  created_at   timestamptz not null default now(),
  created_by   text,
  last_used_at timestamptz,
  use_count    integer not null default 0,
  revoked_at   timestamptz
);
create index if not exists api_keys_email_idx on api_keys (email) where revoked_at is null;
alter table api_keys enable row level security;   -- server (service role) only; no browser policy

-- Every role can make its own keys (the page is personal; the key reads only what the role can
-- see). Roles that already say something about it keep their answer.
update app_roles
   set perms = coalesce(perms, '{}'::jsonb) || '{"api-keys":"full"}'::jsonb
 where not (coalesce(perms, '{}'::jsonb) ? 'api-keys');
