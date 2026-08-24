-- USER ACTIVITY (Jon, 2026-08-22: "see user logs per user to see what they are doing. It should
-- track the meta data and record all activity in the app").
--
-- One row per event, two kinds:
--   page — a screen opened (logged from the app shell as the person navigates)
--   api  — a gated API call (logged from requireLevel, the single gate every protected
--          endpoint already passes through — so writes are captured without touching routes)
--
-- Metadata only: WHO did WHAT and WHEN — never request bodies, never secrets. The vault keeps
-- its own separate reveal log (vault_access_log); this table is the app-wide layer.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

create table if not exists user_activity (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  email    text not null,
  kind     text not null check (kind in ('page', 'api')),
  path     text,            -- the screen (page) or referring screen (api)
  feature  text,            -- feature key the API call was gated on
  need     text,            -- view / edit / full — how much power the call asked for
  allowed  boolean not null default true,
  meta     jsonb not null default '{}'::jsonb   -- user agent, ip, and anything future
);

create index if not exists user_activity_email_at on user_activity (email, at desc);
create index if not exists user_activity_at on user_activity (at desc);

alter table user_activity enable row level security;
-- Service role only (the app's server); no anon/user policies on purpose.

-- ── While you are here: the two pieces the Vault itself still needs ──
-- 1) Tables: run 017_vault.sql if vault_items does not exist yet.
-- 2) The PRIVATE storage bucket for vault files:
insert into storage.buckets (id, name, public)
  values ('vault', 'vault', false)
  on conflict (id) do nothing;
