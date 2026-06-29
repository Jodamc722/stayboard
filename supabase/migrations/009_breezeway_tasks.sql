-- Breezeway integration: property map (Guesty listing id <-> Breezeway home_id) +
-- pushed-task tracking (issues pushed from the Action Plan into Breezeway, then tracked to
-- completion = "action taken"). Populated by /api/sync/breezeway?sync=properties and
-- /api/health/push-task. Run once in Supabase.

create table if not exists breezeway_properties (
  home_id               bigint primary key,
  reference_property_id text,
  name                  text,
  status                text,
  updated_at            timestamptz not null default now()
);
create index if not exists idx_bzprop_ref on breezeway_properties(reference_property_id);

create table if not exists breezeway_tasks (
  id                 bigserial primary key,
  listing_id         text not null,
  home_id            bigint,
  issue_key          text,
  issue_title        text not null,
  action             text,
  department         text,
  priority           text,
  breezeway_task_id  text,
  scheduled_date     date,
  status             text not null default 'created',
  report_url         text,
  action_taken_at    timestamptz,
  pushed_by          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_bztask_listing on breezeway_tasks(listing_id);
create index if not exists idx_bztask_status on breezeway_tasks(status);

alter table breezeway_properties enable row level security;
alter table breezeway_tasks enable row level security;
drop policy if exists "auth read bzprop" on breezeway_properties;
create policy "auth read bzprop" on breezeway_properties for select to authenticated using (true);
drop policy if exists "auth read bztask" on breezeway_tasks;
create policy "auth read bztask" on breezeway_tasks for select to authenticated using (true);
