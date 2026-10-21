-- 158 — THE ID IS READ AND HELD AGAINST THE BOOKING (Jon, 2026-10-21: "make sure the ID verification
-- … is looking at booking details and verifying that it matches the reservation name and that it's
-- been added. If photo added but unsure flag to check").
--
-- guest_checks (145/146) marked a stay verified the moment the guest's two photos landed. Now the
-- photos are read (the same model check the direct booking page runs) and the name on the ID is
-- held against the booking's guest. What was read, and the verdict, live here so the desk can show
-- WHY a row is flagged and who cleared it.
alter table public.guest_checks
  add column if not exists id_check       jsonb,        -- { verdict, match, reasons, nameOnId, read, checkedAt } (lib/guest-id-match)
  add column if not exists id_match       text,         -- match | mismatch | unread
  add column if not exists id_read_name   text,         -- the name as the model read it off the ID
  add column if not exists id_checked_by  text,         -- who cleared a flagged row by hand ("Looks right")
  add column if not exists id_checked_at  timestamptz;
-- id_status now also takes 'check': a photo is on file but a person has to look (kept as text, no constraint).
-- id_method now also takes: message (ID received on the booking thread) · platform (verified on Vrbo / Google) · guesty (the "verified" field ticked in Guesty).
notify pgrst, 'reload schema';
