-- CLAIM DUE DATES — separating "when we intend to file" from "when the door slams".
--
-- 018 had one date: deadline_on, the platform's hard cutoff. That is the wrong thing to manage
-- against, because everything looks fine right up until it suddenly isn't. So there are now two:
--
--   deadline_on  the HARD cutoff from the channel's own policy (Airbnb/Vrbo/Booking all give 14
--                days from checkout). Miss it and the claim is worth nothing.
--   due_on       the date WE intend to file. Set from the channel's target and editable by hand.
--                This is what the board counts down to; the hard deadline sits behind it in red.
--
-- The targets are not arbitrary. On Vrbo and Expedia we hold a refundable deposit that the platform
-- releases back to the guest up to 14 days after checkout — so filing on day 13 can mean filing at
-- money that is already gone. On direct bookings there is no platform at all: we hold the card, and
-- the only clock is how fresh the charge looks to the bank.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

alter table claims add column if not exists due_on      date;
-- 'policy' = derived from the channel's target; 'manual' = somebody set it and we stop moving it.
alter table claims add column if not exists due_source  text not null default 'policy';
-- What we are actually claiming against on this channel: the deposit we hold, if any.
alter table claims add column if not exists deposit_held numeric;

-- Backfill: existing claims get a due date from their hard deadline so nothing sits blank.
update claims set due_on = deadline_on where due_on is null and deadline_on is not null;

create index if not exists idx_claims_due on claims(due_on) where deleted_at is null;

notify pgrst, 'reload schema';
