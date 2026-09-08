-- CALL CENTER (Jon, 2026-09-08 evening): "make this a robust call center to manage this well".
--
-- guest_calls (073) recorded that a call happened and who made it. A call center also needs to
-- know which calls did NOT happen, how hard someone tried, and which tier of call it was — because
-- "we completed 40 calls" means nothing next to "we closed 12 mandatory calls incomplete".
--
--   tier           recovery | lux | big | standard (welcome)  ·  post_checkout
--   attempts       every No-answer bumps it; an incomplete row keeps the count so the scoreboard can
--                  tell "nobody tried" from "tried three times, never reached them"
--   caller_email   the login that pressed the button — `called_by` is the name they typed, which
--                  is what the team reads, but a name can be mistyped and an email cannot
--   scheduled_for  the day the call was due (check-in for welcome, check-out for post-checkout)
--   closed_at      set only by the nightly close-out, on `incomplete` rows
--
-- outcome now also carries: reached | voicemail | no_answer | in_progress | incomplete
--   (welcome), and in_progress | incomplete join happy | issue | no_answer for post-checkout.
--   `in_progress` is a claim — "I'm on this one" — so two people never call the same guest.
alter table public.guest_calls add column if not exists tier          text;
alter table public.guest_calls add column if not exists attempts      integer not null default 1;
alter table public.guest_calls add column if not exists caller_email  text;
alter table public.guest_calls add column if not exists scheduled_for date;
alter table public.guest_calls add column if not exists closed_at     timestamptz;

create index if not exists guest_calls_sched_idx on public.guest_calls (scheduled_for desc, kind);
create index if not exists guest_calls_caller_idx on public.guest_calls (caller_email, called_at desc);

notify pgrst, 'reload schema';
