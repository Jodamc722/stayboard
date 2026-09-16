-- MEET YOUR TEAM (Jon, 2026-09-16: "meet the team section I can build in backend so i dont have
-- to do it each time, still customizable").
--
-- The onboarding presentation introduces the people who will actually be in the owner's unit.
-- Names, crew and market already live on `staff`; what was missing is the two things that make a
-- team section land rather than read as a list: a face, and a sentence about what this person
-- does for THIS owner.
--
-- The house version of each card is written once and stored with the rest of the onboarding
-- template (app_settings.onboarding_template). These columns are the roster-side source those
-- cards seed from, so a new hire shows up with a photo rather than a gap.
alter table if exists public.staff
  add column if not exists photo_url text,
  add column if not exists bio       text;
