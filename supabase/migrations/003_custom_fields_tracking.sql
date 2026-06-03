-- STAYBOARD v2 — Custom Fields tracking + KPI flagging
-- Lets us pick which Guesty custom fields show up in the app
-- and which ones get top-level KPI treatment (e.g. Sensitive Guest, Welcome Calls)

alter table guesty_custom_fields add column if not exists tracked       boolean default false;
alter table guesty_custom_fields add column if not exists is_kpi        boolean default false;
alter table guesty_custom_fields add column if not exists kpi_slug      text;     -- e.g. 'sensitive_guest', 'welcome_call'
alter table guesty_custom_fields add column if not exists display_name  text;     -- override Guesty's name if needed
alter table guesty_custom_fields add column if not exists display_order int default 100;

-- RLS off so the admin UI can write directly with the anon key (matches our other tables)
alter table guesty_custom_fields disable row level security;
