-- EVE AGENT LOG (2026-09-18). One row per agent-mode decision: what she wanted to do, which rung
-- it sat on, whether it was allowed, and why not when it was not. Jon: "Need a turn-on button for
-- agent mode and an off button as well. Also need to set parameters for her."
--
-- The settings themselves live in app_settings ('eve_agent'; daily counters in 'eve_agent_counters')
-- so the switch needs no migration to work. This table is the receipt: without it "why didn't she
-- post that" is a guess.
create table if not exists eve_agent_log (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  action   text not null,                 -- ActionType (lib/eve/agent-mode.ts)
  rung     smallint not null default 0,   -- 0 observe · 1 draft · 2 propose · 3 act · 4 act+report
  allowed  boolean not null default false,
  mode     text,                          -- what actually happened: observe|draft|propose|act
  reason   text,                          -- why (OFF, quiet hours, budget spent, rung, approved by …)
  usd      numeric(12,2),                 -- money at stake, when any
  summary  text,                          -- one line a person can read
  ref      text,                          -- eve_actions id / task id / Slack ts
  by       text not null default 'eve',   -- 'eve' | 'cron:<name>' | 'chat'
  actor    text                           -- the person, when a person was involved
);
create index if not exists eve_agent_log_at_idx on eve_agent_log (at desc);
create index if not exists eve_agent_log_action_at_idx on eve_agent_log (action, at desc);
alter table eve_agent_log enable row level security;
