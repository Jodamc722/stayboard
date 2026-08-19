-- SLACK OUTBOX — nothing reaches the team until a human says yes (Jon, 2026-08-19):
--
--   "This need to be approved before sending in the command center"
--   "It can send me slack message DM, i can approve via there or command center"
--   "It should also not spam meaning if multiple cleans pending, or glitches it should group
--    them ect and tag all parties"
--
-- One row = one DRAFTED message waiting on a decision. The alert code never posts to Slack
-- directly any more; it drafts into here and the dispatch cron sends what has been approved.
--
-- GROUPING IS ENFORCED IN THE DATABASE, not in the caller's head. `group_key` is something like
-- 'late_cleans:17WEST:2026-08-19', and the partial unique index below makes a second pending row
-- for the same group physically impossible. That is the anti-spam guarantee: if the cron runs
-- every 30 minutes and 4 cleans are still open, there is still exactly ONE message about 17WEST,
-- and re-drafting updates it rather than stacking another one behind it.
--
-- Unapproved rows EXPIRE (`expires_at`). A late-clean nudge approved at 11pm is noise, so a row
-- that nobody acted on inside the window is marked 'expired' and never sends.
create table if not exists slack_outbox (
  id              uuid primary key default gen_random_uuid(),
  event_key       text not null,                    -- late_cleans | glitches | overtime | sync | digest | personal_brief
  group_key       text not null,                    -- what makes this message ONE thing (see above)
  building        text,                             -- canonical label from lib/segments
  channel_id      text,                             -- resolved Slack channel; null = DM-only message
  dm_user_ids     text[]  not null default '{}',    -- people who get it as a direct message
  body            text not null,                    -- the drafted message, mentions already baked in
  summary         text,                             -- one line for the Command Center row
  audience        text[]  not null default '{}',    -- every Slack id tagged, for the review UI
  item_count      integer not null default 1,       -- how many things got grouped into this message
  status          text not null default 'pending',  -- pending | approved | sent | skipped | expired | failed
  needs_approval  boolean not null default true,
  token           text,                             -- one-time secret for the approve-from-Slack link
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  expires_at      timestamptz,
  decided_by      text,                             -- email, or 'slack:<user id>' when approved from a DM
  decided_at      timestamptz,
  sent_at         timestamptz,
  error           text
);

-- The anti-spam constraint. Only ONE pending message per group at a time.
create unique index if not exists idx_slack_outbox_group_pending
  on slack_outbox(group_key) where status = 'pending';

create index if not exists idx_slack_outbox_status  on slack_outbox(status, created_at desc);
create index if not exists idx_slack_outbox_token   on slack_outbox(token) where token is not null;
create index if not exists idx_slack_outbox_created on slack_outbox(created_at desc);

-- RLS ON, with NO policies — deliberately stricter than the rest of this schema, which mostly
-- runs with RLS disabled. The reason is the `token` column: it is the one-time secret that lets
-- the Slack DM link approve a message without a session. If the anon key could read this table,
-- anyone holding it could read a pending token and send a message as Lighthouse. No policies means
-- only the service role gets in, which is all any of the API routes here ever use.
alter table slack_outbox enable row level security;
