-- MESSAGES — ONE "WAITING ON US" RULE, WITH A REPLY-BY TIME (2026-09-28 audit, D3/D4/D5).
--
-- There were five definitions of "guest unanswered" (the inbox, this table, Eve's watch, the
-- sentiment scan and the Command Center's unread flag), so the same guest showed up with five
-- different verdicts. lib/response-times.ts now owns the one rule and stores two more facts per
-- conversation:
--
--   awaiting_since — the first guest message nobody has answered. A reply proven to be a Guesty
--                    template (is_automated = true) does not answer anyone; Guesty's internal
--                    log/note entries are neither question nor answer.
--   sla_due_at     — when a reply is due: 60 minutes after a message sent 08:00–22:00 ET or on the
--                    guest's arrival day, otherwise 08:00 ET the next morning. Null when nobody
--                    is waiting.
--
-- `awaiting` itself keeps its name and now follows the same rule (templates no longer clear it).
--
-- SAFE TO RUN TWICE, AND SAFE TO RUN LATE. The app works before this file is run: the writer drops
-- the two columns when the database refuses them, and the reader falls back to last_guest_at with
-- no reply-by time. After running it, re-derive recent threads once so every row carries the new
-- rule (the guest-comms cron's backfill lever: /api/cron/guest-comms?hours=168&convos=2000).

alter table if exists public.conversation_response add column if not exists awaiting_since timestamptz;
alter table if exists public.conversation_response add column if not exists sla_due_at timestamptz;

do $$
begin
  if to_regclass('public.conversation_response') is not null then
    comment on column public.conversation_response.awaiting_since is
      'First guest message after the last reply a person could have sent (templates, is_automated=true, do not count). Null when nobody is waiting. Written by lib/response-times.ts.';
    comment on column public.conversation_response.sla_due_at is
      'Reply-by time for awaiting_since: +60 min for 08:00-22:00 ET or arrival-day messages, else 08:00 ET next morning. Null when nobody is waiting.';
    -- The Needs-reply queue reads only the awaiting rows, ordered by when they fall due.
    create index if not exists conversation_response_sla_idx
      on public.conversation_response (sla_due_at)
      where awaiting;
  end if;
end $$;
