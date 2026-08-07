-- 028: per-line-item amount overrides on task billing (2026-08-07)
--
-- Jon: "edit the billable amount that was added." Breezeway's API cannot edit a task's
-- cost/supply line items, so an edited amount is OUR adjustment: stored per item key
-- ('cost:<id>' / 'supply:<id>') on the task's billing_adjustments row. lib/billing applies it
-- at read time — the override drives totals and exports, the Breezeway original stays visible.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

alter table billing_adjustments
  add column if not exists item_overrides jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
