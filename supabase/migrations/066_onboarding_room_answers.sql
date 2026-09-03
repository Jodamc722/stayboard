-- ONBOARDING: room questions (Jon, 2026-09-03: "it should ask pre-questions before assuming items").
-- A room opens with a few quick questions (TV? sleeper? seats? curtain or glass?) and its item list is
-- built from the answers instead of from the whole standard. The answers live on the room.
alter table public.onboarding_rooms add column if not exists answers jsonb;
notify pgrst, 'reload schema';
