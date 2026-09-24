-- 108 · WHAT BECAME OF WHAT EVE DID (2026-09-24)
--
-- The decision log (100) records that Eve acted. Nothing recorded what happened next: a task she
-- created could sit unassigned for a week and she would still describe it as "created". These
-- three columns close that loop. `outcome` is written by lib/eve/outcomes.ts every hour from the
-- systems the action touched — Breezeway for tasks, the guest thread for sent replies — and
-- rewritten until it reaches a terminal state, so the log always says what is true now.
alter table eve_agent_log add column if not exists outcome      text;         -- open|running|done|overdue|gone|replied|silent|unverified
alter table eve_agent_log add column if not exists outcome_at   timestamptz;  -- when the outcome was last checked
alter table eve_agent_log add column if not exists outcome_note text;         -- one line: "done 3:10pm by Vilma", "no reply after 26h"
create index if not exists eve_agent_log_outcome_idx on eve_agent_log (outcome, at desc);
