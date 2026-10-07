-- 148 — EVERY GUEST ISSUE BECOMES A GLITCH (Jon, 2026-10-07, after Jenna Marcello at Eden 1104:
-- "a glitch should have been created because it's a guest issue. All guest issues should have
-- glitches automatically created … flag the customer service team immediately … a notification
-- sent via Slack as well").
--
-- The app already READ her 9-minute call correctly — talkroute_calls.intel held
-- {"issues": ["Door lock malfunction—will not lock", "Attempted unauthorized entry", "Guest
-- security concern"]} — and then did nothing with it. lib/guest-issue.ts closes that loop. This
-- column is the idempotency key: one glitch per source (call id / conversation id), so a watch
-- that runs every half hour never files the same incident twice.
alter table public.glitches add column if not exists detected_from text;
create unique index if not exists glitches_detected_from_uidx on public.glitches (detected_from) where detected_from is not null;
-- What the watch decided about a source, including the ones it chose NOT to file, so the Detected
-- tab can show its working and a person can file or dismiss by hand.
create table if not exists public.guest_issue_detections (
  source_key   text primary key,            -- 'call:<id>' | 'thread:<conversation id>'
  kind         text not null,               -- call | message
  detected_at  timestamptz not null default now(),
  occurred_at  timestamptz,
  reservation_id text,
  conversation_id text,
  listing_id   text,
  unit         text,
  guest_name   text,
  channel      text,
  severity     text not null default 'issue',  -- security | issue | watch | none
  category     text,
  headline     text,
  issues       jsonb not null default '[]'::jsonb,
  evidence     text,                        -- the guest's own words
  link         text,                        -- where to read the whole thing
  verdict      text not null default 'filed',  -- filed | skipped | dismissed | manual
  glitch_id    uuid,
  alerted      boolean not null default false,
  note         text
);
create index if not exists guest_issue_detections_at_idx on public.guest_issue_detections (detected_at desc);
create index if not exists guest_issue_detections_verdict_idx on public.guest_issue_detections (verdict, detected_at desc);
notify pgrst, 'reload schema';
