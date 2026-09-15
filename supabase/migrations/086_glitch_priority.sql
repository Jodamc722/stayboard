-- GLITCHES — priority as a property of the ISSUE, not of the push (Jon, 2026-09-15).
--
-- Priority already existed, but only for the half-second it took to send a task to Breezeway:
-- the push form picked it, the API put it in the payload, and nothing on our side remembered it.
-- So the board could not answer "which of these jumps the queue?" — the one question you want
-- answered without opening a card — and a glitch had no priority at all until somebody happened
-- to file a Breezeway task for it.
--
-- DEFAULT 'urgent' ON PURPOSE. Every glitch push has gone out as urgent since the feature shipped,
-- so this is the value that matches what is actually true today rather than a new policy applied
-- retroactively. The consequence is worth saying out loud: at first EVERY card will carry the
-- urgent badge, which makes it useless as a signal until the routine ones get marked down. That is
-- a triage habit, not a bug — and it is visible now, which it was not before.
--
-- Same rule as 059/060/085: `glitches` has no CREATE TABLE, so this only ever ADDs, and is safe
-- to run twice.

alter table public.glitches add column if not exists priority text not null default 'urgent';
comment on column public.glitches.priority is
  'urgent | high | normal | low — how this issue is treated, independent of whether a Breezeway task exists yet. The push form reads it and writes back whatever was actually filed.';

create index if not exists glitches_priority_idx on public.glitches (priority) where priority <> 'normal';
