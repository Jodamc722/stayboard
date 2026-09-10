-- 084: what Eve is keeping tabs on in Slack.
--
-- Jon, 2026-09-10: "need eve to keep tabs on slack, make sure important items are being tracked,
-- managed and reported and followed up on." One row per thing somebody said they would do, problem
-- somebody raised, question nobody answered, or decision made in chat. Closed by a reply in the
-- thread, a finished Breezeway task, a closed glitch, or a person — and the row says which.
create table if not exists eve_slack_items (
  id            uuid primary key default gen_random_uuid(),
  channel       text not null,                 -- Slack channel id
  channel_name  text,
  msg_ts        text not null,                 -- the message that created the item
  thread_ts     text,                          -- the thread it lives in (msg_ts when it is the root)
  kind          text not null,                 -- commitment | problem | question | decision
  summary       text not null,
  owner_name    text,                          -- who said they would, or who was asked
  owner_slack   text,                          -- their Slack id when we could resolve it
  unit          text,
  building      text,
  listing_id    text,                          -- guesty listing when the unit resolved
  due_at        timestamptz,
  urgent        boolean not null default false,
  status        text not null default 'open',  -- open | closed
  closed_reason text,
  closed_at     timestamptz,
  tracked_in    text,                          -- 'breezeway:<task id>' | 'glitch:<id>' when managed elsewhere
  nudged_at     timestamptz,
  nudge_count   int not null default 0,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  evidence      jsonb not null default '{}'::jsonb,
  unique (channel, msg_ts)
);
create index if not exists idx_eve_slack_items_open on eve_slack_items(status, due_at);
create index if not exists idx_eve_slack_items_thread on eve_slack_items(channel, thread_ts);
alter table eve_slack_items enable row level security;
