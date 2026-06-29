-- Weekly Action Plan: extend ops_plan_items so each item can carry the Health action it came
-- from (listing + issue), the day it's scheduled (the unit's next vacant day), and the
-- Breezeway task it was pushed to. Safe to run once; all columns are additive/nullable.

alter table ops_plan_items add column if not exists listing_id        text;
alter table ops_plan_items add column if not exists issue_key         text;
alter table ops_plan_items add column if not exists scheduled_date    date;
alter table ops_plan_items add column if not exists breezeway_task_id text;
alter table ops_plan_items add column if not exists market            text;

create index if not exists idx_ops_items_sched on ops_plan_items(scheduled_date);

-- Tag the parent plan so the UI knows to render the weekly (by-day) view.
alter table ops_plans add column if not exists kind         text not null default 'ops';
alter table ops_plans add column if not exists week_of      date;
