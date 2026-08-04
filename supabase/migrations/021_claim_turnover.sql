-- WHEN THE EVIDENCE DISAPPEARS.
--
-- A claim's real deadline is not only what the channel will accept. It is when the proof stops
-- existing. Once the unit is cleaned and the next guest walks in, the damage is gone: you cannot
-- photograph it, you cannot re-inspect it, and "the previous guest did it" becomes a sentence
-- rather than a fact.
--
-- So every claim now records the next arrival on that unit. This does NOT touch `deadline_on` —
-- Airbnb's published rule is 14 days from checkout full stop, and inventing a shorter platform
-- cutoff would be stating someone else's policy wrongly. It pulls OUR due date forward instead,
-- which is the honest version: the platform may still accept it next week, but we want the file
-- built while the room is still the way the guest left it.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

-- The next check-in on this listing after the claimed stay's checkout, if there is one.
alter table claims add column if not exists next_check_in date;
-- Why the due date is what it is: 'policy' | 'turnover' | 'manual'.
-- 'turnover' means the next arrival pulled it in front of the channel target.
alter table claims add column if not exists due_reason text;

update claims set due_reason = coalesce(due_reason, due_source, 'policy') where due_reason is null;

-- Nudges read "what is due, not yet filed, not yet nudged today", so index that shape.
alter table claims add column if not exists nudged_on date;
create index if not exists idx_claims_nudge on claims(due_on) where deleted_at is null and stage in ('draft','review','ready');

notify pgrst, 'reload schema';
