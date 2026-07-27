-- Workspaces (role presets), user profiles, notification prefs + activity, and an app_settings
-- key/value store (used first for the review-reply AI voice profile).
-- Safe to run more than once (IF NOT EXISTS everywhere). All app code is fail-open before this runs.

-- 1) app_users: workspace preset + profile + prefs + lightweight activity
alter table app_users add column if not exists workspace text;            -- 'admin'|'gm'|'ops'|'cs'|'data' (null = gm)
alter table app_users add column if not exists profile jsonb not null default '{}'::jsonb;  -- { name, title, phone }
alter table app_users add column if not exists prefs   jsonb not null default '{}'::jsonb;  -- { mute_all, mute_mention, mute_comment }
alter table app_users add column if not exists last_seen_at timestamptz;  -- stamped by middleware (~1/min max)

-- 2) app_settings: small key/value store. ALREADY EXISTS in prod (banner_overrides, guesty_owners,
--    owner_edit_password) with value TEXT — app code JSON-stringifies objects into it.
--    New key: 'review_voice' = JSON string of { guidelines, examples: [{review, reply}] }
create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table app_settings add column if not exists updated_by text;
alter table app_settings enable row level security;  -- service-role reads/writes only (all callers use supabaseAdmin)
