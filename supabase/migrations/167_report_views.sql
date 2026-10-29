-- 167_report_views.sql — who opened a shared deck or owner report, and where they spent their time.
-- (Jon, 2026-10-29: "track number of views or opens, click rate and how or where people are
-- spending their time … with the owner sharable link, not users that are logged in").
-- One row per viewing session on /r/<code> by someone who is NOT signed in. The browser keeps the
-- session's running totals and re-sends them, so the row is overwritten, never appended to.
-- Service-role only: RLS on, no policies. Safe to run twice.
create table if not exists report_views (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null,
  code        text not null,
  session_id  text not null,
  visitor_id  text,
  started_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  device      text,
  ua          text,
  referrer    text,
  country     text,
  region      text,
  city        text,
  total_ms    integer not null default 0,
  max_slide   integer not null default 0,
  slide_count integer not null default 0,
  presented   boolean not null default false,
  slides      jsonb not null default '{}'::jsonb,
  clicks      jsonb not null default '[]'::jsonb
);
create unique index if not exists report_views_session_uidx on report_views (session_id);
create index if not exists report_views_report_idx on report_views (report_id, started_at desc);
alter table report_views enable row level security;
