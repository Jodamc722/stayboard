-- ---------------------------------------------------------------------------------------------
-- eve_audits — the standing tab of what is WRONG right now.
--
-- Jon, 2026-08-24: "She needs to run audits and scans of all activities and keep things on tab."
--
-- The id is a STABLE KEY derived from the check and its subject ("feed_stale:messages"), never a
-- uuid and never a timestamp. That is the whole design: the same problem found on Monday and again
-- on Wednesday is ONE row that has been open two days, not two alerts. A findings table keyed by
-- uuid would grow a duplicate every run and be ignored inside a week.
--
-- Rows are never deleted by the runner. Anything open that a later run does not find is flipped to
-- resolved with a timestamp, so the tab tidies itself and the history of how long each problem
-- lasted survives.
-- ---------------------------------------------------------------------------------------------
create table if not exists eve_audits (
  id            text primary key,
  area          text not null,                    -- pipeline | guests | reviews | ops | listings | money | eve
  severity      text not null default 'warn',     -- critical | warn | info
  title         text not null,
  detail        text not null default '',
  fix           text,
  count         integer not null default 1,
  evidence      jsonb,
  status        text not null default 'open',     -- open | resolved | snoozed | acknowledged
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  resolved_at   timestamptz,
  snooze_until  timestamptz,
  acked_by      text,
  note          text
);

create index if not exists eve_audits_status_idx   on eve_audits (status, severity, last_seen_at desc);
create index if not exists eve_audits_area_idx     on eve_audits (area, status);

alter table eve_audits enable row level security;
