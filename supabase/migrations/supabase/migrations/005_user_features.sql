-- Per-user page access ("features"). Each toggleable page (see lib/features.ts) is ON by default and is
-- OFF only when this map has features['<key>'] = false. The owner always has every page. Owner-only edit.
alter table app_users add column if not exists features jsonb not null default '{}'::jsonb;
