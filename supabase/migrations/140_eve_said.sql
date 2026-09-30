-- WHAT EVE HAS ALREADY SAID (2026-09-30 audit). One registry for every desk that posts to Slack —
-- the loop nudges, on-watch flags, board digests, no-show alerts, the CCS handoff, her answers — so
-- the same thing is said once, whoever noticed it. lib/eve/said.ts reads and writes it; the agent
-- gate (lib/eve/agent-mode.ts stepDown) and the Slack answer path consult it before posting.
create table if not exists public.eve_said (
  key          text primary key,               -- djb2 of channel | thread | fingerprint (or subject)
  desk         text not null default 'watch',  -- lib/eve/desks.ts DeskKey
  channel      text not null,                  -- Slack channel id
  thread_ts    text not null default '',       -- '' for a top-level post
  subject      text,                           -- a unit, task id, loop id — when the post named one
  fingerprint  text,                           -- the first significant words of the post
  text         text,                           -- the post, for the Thinking tab (600 chars)
  slack_ts     text,
  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  times        integer not null default 1
);
create index if not exists eve_said_words_idx   on public.eve_said (channel, thread_ts, fingerprint, last_at desc);
create index if not exists eve_said_subject_idx on public.eve_said (channel, subject, last_at desc);
create index if not exists eve_said_last_idx    on public.eve_said (last_at desc);
alter table public.eve_said enable row level security;
notify pgrst, 'reload schema';
