-- BILLABLE REVIEW, IN TWO STAGES (Jon, 2026-09-10).
--
-- "The goal is to review and approve billables… once it's approved by Ronnie or our ops team, it
--  should go into GM review, where I can then review the final review to make sure it's correct."
--
-- Until now a task had one boolean-ish mark (reviewed_by, migration 029) and each owner-month had
-- a JSON blob in app_settings saying "closed". Neither could say WHO approved at WHICH stage, the
-- blob raced between serverless instances (an owner would flap in and out of "reviewed" on the
-- next load), and there was no way to hand something from ops to the GM.
--
-- So: one state per task, walked forward by the people allowed to walk it.
--
--   open          nobody has looked, or somebody sent it back
--   ops_approved  ops (Ronnie / the ops team) has checked it — it is now in the GM's queue
--   gm_approved   the GM has signed it off — it is what goes on the owner's statement
--
-- Who did what, and when, is kept per stage so the audit trail survives a send-back. Existing
-- reviewed_by marks carry forward as ops approvals: they were real reviews, just single-stage.
-- reviewed_by / reviewed_at stay for anything still reading them.
alter table billing_adjustments
  add column if not exists review_state text not null default 'open',
  add column if not exists ops_by  text,
  add column if not exists ops_at  timestamptz,
  add column if not exists gm_by   text,
  add column if not exists gm_at   timestamptz;

alter table billing_adjustments drop constraint if exists billing_adjustments_review_state_chk;
alter table billing_adjustments
  add constraint billing_adjustments_review_state_chk
  check (review_state in ('open', 'ops_approved', 'gm_approved'));

update billing_adjustments
   set review_state = 'ops_approved',
       ops_by = reviewed_by,
       ops_at = coalesce(reviewed_at, now())
 where reviewed_by is not null
   and review_state = 'open';

create index if not exists billing_adjustments_review_state_idx on billing_adjustments (review_state);

notify pgrst, 'reload schema';
