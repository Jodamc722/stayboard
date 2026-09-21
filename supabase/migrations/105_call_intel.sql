-- CALL INTEL (2026-09-21). Jon: "track calls that we made with that guest and the data from those
-- calls… it should live in the reservation level. We should push call notes to the reservation
-- notes so that we can easily access whether the guest was called."
--
-- Stay records every call and plays the recorded-call notice, so the recording is ours to read.
-- The pipeline: Talkroute call record → signed recording URL → transcript → a two-line note written
-- by Claude → one dated line appended to the reservation's notes in Guesty. The transcript and the
-- structured read (what they asked, what we promised, how it went) stay in Lighthouse, on the
-- booking, where there is room for them.
--
-- WHY THE TRANSCRIPT IS STORED AND THE URL IS NOT TRUSTED: Talkroute's `recording` is a TEMPORARY
-- signed URL. It expires. So the audio is transcribed as soon as the call is seen, the text is kept
-- forever, and an expired URL is recoverable only by re-reading that call from /call-history (which
-- mints a fresh one) — never by holding the old link.

alter table public.talkroute_calls add column if not exists recording_url     text;
alter table public.talkroute_calls add column if not exists recording_seen_at timestamptz;
-- pending | done | failed | expired | skipped | none   (none = the call was never recorded)
alter table public.talkroute_calls add column if not exists transcript_status text;
alter table public.talkroute_calls add column if not exists transcript        text;
alter table public.talkroute_calls add column if not exists transcript_at     timestamptz;
alter table public.talkroute_calls add column if not exists transcript_error  text;
alter table public.talkroute_calls add column if not exists transcript_tries  integer not null default 0;
alter table public.talkroute_calls add column if not exists audio_seconds     integer;
-- What the call was ABOUT, written by Claude from the transcript.
alter table public.talkroute_calls add column if not exists summary           text;      -- 1-2 lines, the call note
alter table public.talkroute_calls add column if not exists intel             jsonb;     -- { asked[], promised[], issues[], sentiment, followUp }
alter table public.talkroute_calls add column if not exists summary_at        timestamptz;
alter table public.talkroute_calls add column if not exists cost_usd          numeric;   -- transcription + summary for this call
-- The one line that went to Guesty's reservation notes, and when. Never pushed twice.
alter table public.talkroute_calls add column if not exists note_line         text;
alter table public.talkroute_calls add column if not exists note_pushed_at    timestamptz;
alter table public.talkroute_calls add column if not exists note_error        text;

-- The queue the worker walks: recorded, matched to a booking, not yet transcribed.
create index if not exists talkroute_calls_tstatus_idx on public.talkroute_calls (transcript_status, call_at desc);
create index if not exists talkroute_calls_notepush_idx on public.talkroute_calls (note_pushed_at, call_at desc)
  where note_pushed_at is null;

-- A voicemail the guest left gets its own one-line push, tracked here so it happens once.
alter table public.talkroute_voicemails add column if not exists note_pushed_at timestamptz;

-- ATTEMPT RUNS (Jon's rule, 2026-09-21): a run of no-answers is ONE line in Guesty when the call
-- closes ("Tried 3× before arrival, never reached") — not one line per attempt, which would bury
-- the notes. This records that the run line has gone out for that reservation+kind.
alter table public.guest_calls add column if not exists attempts_note_at   timestamptz;
alter table public.guest_calls add column if not exists attempts_note_line text;

notify pgrst, 'reload schema';
