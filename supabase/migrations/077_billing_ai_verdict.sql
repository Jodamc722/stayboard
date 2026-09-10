-- 077: the model's verdict on a routine task (unit check / strip) that carries a real description.
-- Jon, 2026-09-10: "unit check without task should not cost anything, use AI to determine if it
-- should have a cost… so auto close unit check… also unit strip is not a billable task."
--
-- ai_verdict  'no_charge' → the task closes itself at $0 (lib/billing), 'bill' → stays open, flagged
--             'ai_bill', with ai_reason and ai_amount (a suggested price) shown on the review desk.
-- One verdict per task, written once by lib/billing-ai; a human price/exclusion always wins over it.
alter table billing_adjustments
  add column if not exists ai_verdict text,
  add column if not exists ai_reason text,
  add column if not exists ai_amount numeric,
  add column if not exists ai_at timestamptz;
alter table billing_adjustments drop constraint if exists billing_adjustments_ai_verdict_chk;
alter table billing_adjustments add constraint billing_adjustments_ai_verdict_chk
  check (ai_verdict is null or ai_verdict in ('no_charge','bill'));
notify pgrst, 'reload schema';
