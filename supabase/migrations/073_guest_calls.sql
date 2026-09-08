-- GUEST CALLS — who called which guest, when, and how it went (Jon, 2026-09-08).
--
-- WHY THIS TABLE EXISTS AT ALL, given the welcome call already writes to Guesty.
--
-- The welcome call is recorded on the reservation's "Welcome Call" custom field in Guesty, and that
-- stays: it is the field Eve reads and the one a person sees when they open the booking. But the
-- app was also stashing WHO made the call and WHEN as private keys (_by, _at, _note) on its local
-- mirror of that field's array — and the reservations cron overwrites `custom_fields` wholesale
-- with Guesty's version every five minutes (lib/guesty.ts). Guesty has never heard of `_at`.
--
-- So the sequence was: caller marks the call at 09:00 -> the write bumps the reservation's
-- lastUpdatedAt -> the 09:05 incremental sync, which pulls by -lastUpdatedAt, is guaranteed to
-- re-fetch exactly that reservation -> _by and _at are gone. The card still said "Called" (the
-- field value survives, in Guesty), but "called by Roberto · Sep 8" degraded to a bare "Called"
-- and any count of calls made today read zero. A KPI that always reads zero is worse than no KPI.
--
-- Call history therefore lives here, where nothing overwrites it, and Guesty keeps the field and
-- the human-readable note. One table for both kinds of call, because the desk treats them as one
-- job and the reporting question ("how many calls did we make today") spans both.
create table if not exists public.guest_calls (
  reservation_id text not null,
  kind           text not null,                    -- welcome | post_checkout
  outcome        text not null default 'done',     -- welcome: done · post_checkout: happy | issue | no_answer
  note           text,
  called_by      text,
  called_at      timestamptz not null default now(),
  listing_id     text,
  guest_name     text,
  ref_date       date,                             -- check-in for a welcome call, check-out for a post-checkout one
  primary key (reservation_id, kind)
);
create index if not exists guest_calls_at_idx on public.guest_calls (called_at desc);
create index if not exists guest_calls_ref_idx on public.guest_calls (kind, ref_date desc);

alter table public.guest_calls enable row level security;
notify pgrst, 'reload schema';
