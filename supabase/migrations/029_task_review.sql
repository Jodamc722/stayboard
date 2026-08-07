-- 029: per-task billing review (2026-08-07)
--
-- Jon: review individual tasks as the month goes, so closing an owner out is a skim of the
-- leftovers instead of a full month-end audit. A review mark lives on the task's
-- billing_adjustments row (who + when); the board shows it, filters by it, and the owner-level
-- "Mark reviewed" close-out stays the final sign-off on top.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

alter table billing_adjustments
  add column if not exists reviewed_by text,
  add column if not exists reviewed_at timestamptz;

notify pgrst, 'reload schema';
