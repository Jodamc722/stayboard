-- EVE'S HANDS AND EYES (2026-09-21). Jon: "Continue to improve Eve's agentic abilities… long-term
-- goal is for her to be a real team member." Until now the agent switch existed but only Slack
-- posts, Telegram asks and memory writes could actually run. This migration is the bookkeeping for
-- the executors (lib/eve/executors.ts) and the watches (lib/eve/watches.ts).
--
-- 1. eve_agent_log gains an UNDO. Every action she carries out stores what would reverse it (cancel
--    the task, clear the assignment, delete the draft…) so "undo" on Telegram or in the panel can
--    put it back within 24 hours. `undone_at` / `undone_by` make the reversal a receipt too.
alter table eve_agent_log add column if not exists undo      jsonb;
alter table eve_agent_log add column if not exists undone_at timestamptz;
alter table eve_agent_log add column if not exists undone_by text;
create index if not exists eve_agent_log_undo_idx on eve_agent_log (at desc) where undo is not null and undone_at is null;

-- 2. eve_watches (migration 045) was a metric-threshold table nothing ever drove. It becomes the
--    registry of her standing watches: one row per deterministic trigger, keyed by code (the
--    trigger function lives in lib/eve/watches.ts; the row holds the switch, the cooldown and the
--    receipts). The 045 columns stay so nothing referencing them breaks; `metric` is relaxed.
alter table eve_watches alter column metric drop not null;
alter table eve_watches add column if not exists key           text;
alter table eve_watches add column if not exists title         text;
alter table eve_watches add column if not exists enabled       boolean not null default true;
alter table eve_watches add column if not exists cooldown_hours integer not null default 24;
alter table eve_watches add column if not exists rung_override smallint;               -- null = the action's own rung
alter table eve_watches add column if not exists fired_count   integer not null default 0;
alter table eve_watches add column if not exists last_result   jsonb;                  -- what the last run found
alter table eve_watches add column if not exists last_run_at   timestamptz;
alter table eve_watches add column if not exists config        jsonb not null default '{}'::jsonb;
create unique index if not exists eve_watches_key_idx on eve_watches (key) where key is not null;

-- 3. Cooldown per watch per SUBJECT (a unit, a thread, a task): the same ask is never repeated
--    inside the cooldown, whatever mode it stepped down to.
create table if not exists eve_watch_fires (
  watch_key  text not null,
  subject    text not null,
  fired_at   timestamptz not null default now(),
  mode       text,                 -- act | propose | draft | deferred | observe
  ref        text,                 -- eve_actions id or the executor's ref
  primary key (watch_key, subject)
);
create index if not exists eve_watch_fires_at_idx on eve_watch_fires (fired_at desc);
alter table eve_watch_fires enable row level security;

-- 4. The eight watches. Enabled by default: agent mode and the rungs still decide whether a
--    fired watch acts, proposes or only drafts — with agent mode OFF a watch only logs what it saw.
insert into eve_watches (key, title, enabled, cooldown_hours, label, metric)
values
  ('guest_unanswered_1h',    'Guest waiting over an hour',            true, 24, 'Guest waiting over an hour',            null),
  ('clean_late',             'Late clean with nobody on it',          true, 24, 'Late clean with nobody on it',          null),
  ('big_arrival_uninspected','Big arrival with no inspection',        true, 48, 'Big arrival with no inspection',        null),
  ('bad_review_in',          'Bad review just landed',                true, 168,'Bad review just landed',                null),
  ('channel_broken',         'Listing off a major channel',           true, 48, 'Listing off a major channel',           null),
  ('glitch_overdue',         'Glitch past due with no task',          true, 48, 'Glitch past due with no task',          null),
  ('stock_low',              'Guest-order stock below par',           true, 72, 'Guest-order stock below par',           null),
  ('no_show_risk',           'Arrival today, no call, no reply',      true, 24, 'Arrival today, no call, no reply',      null)
on conflict do nothing;

notify pgrst, 'reload schema';
