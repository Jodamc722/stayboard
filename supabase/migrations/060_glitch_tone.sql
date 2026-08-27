-- HOW THE GUEST SOUNDED, AND HOW WE HEARD ABOUT IT.
--
-- Jon, 2026-08-27: "we select the tone, cause it could of been a call."
--
-- He is right, and it corrects a real design mistake. The refund advisor was reading tone out of the
-- guest message thread, which quietly assumes every complaint arrives in writing. Plenty arrive by
-- phone, at the door, or through a supervisor — and in those cases the only person who knows whether
-- the guest was furious or gracious is the one who spoke to them. That is knowledge the record will
-- never contain and a model can never recover, so it has to be captured, not guessed.
--
-- Tone is a MAJOR input: it decides whether a case sits at the low end of its band, and whether a
-- complaint reads as fishing. Inferring it from an absent thread is the worst of both worlds.

alter table public.glitches add column if not exists guest_tone text;
comment on column public.glitches.guest_tone is
  'understanding | frustrated | angry | fishing — chosen by whoever dealt with the guest. Never inferred.';

-- WHY THERE MAY BE NO THREAD TO READ. Without this, a phone complaint looks identical to a report
-- where somebody simply forgot to link the conversation, and anything reading the record wastes a
-- question asking for messages that were never going to exist.
alter table public.glitches add column if not exists reported_via text;
comment on column public.glitches.reported_via is
  'message | call | in_person | at_checkout | review | other — how the guest raised it.';
