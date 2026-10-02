-- EVE'S REMINDERS (2026-10-01, Jon: "remind me at 11 am" → Eve reminds you in the Slack channel).
-- One row per reminder: what to say, when (an instant; the tool converts South Florida wall time),
-- where it was asked (channel + thread, or nothing for the web chat → DM), who asked, and when it
-- was fired or cancelled. lib/eve/reminders.ts reads and writes it; /api/cron/eve-reminders fires.
create table if not exists public.eve_reminders (
  id            uuid primary key default gen_random_uuid(),
  text          text not null,
  due_at        timestamptz not null,
  channel       text,
  thread_ts     text,
  slack_user    text,
  created_by    text,
  source        text not null default 'slack',
  created_at    timestamptz not null default now(),
  fired_at      timestamptz,
  cancelled_at  timestamptz,
  cancelled_by  text,
  attempts      integer not null default 0,
  error         text
);
create index if not exists eve_reminders_due_idx on public.eve_reminders (due_at) where fired_at is null and cancelled_at is null;
create index if not exists eve_reminders_user_idx on public.eve_reminders (slack_user, due_at);
alter table public.eve_reminders enable row level security;
notify pgrst, 'reload schema';
