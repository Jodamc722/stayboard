-- 146 — ID VERIFICATION + DEPOSITS, CAPTURED FOR REAL (Jon, 2026-10-03: "get the id verification and
-- deposit data to work on my app, make sure we know when it captured, need to view photo and selfie
-- for VRBO, Direct and Google. We need deposits for those too and deposits for Expedia as well,
-- Blueground and Marriott … allow us to customize the rules").
--
-- guest_checks (145) held two hand-flipped statuses. Now a row carries HOW and WHEN each check was
-- captured: the guest's own ID photo + selfie from the verification link (private bucket
-- guest-verify, signed 10-minute views, every view logged), or a desk entry; the deposit's amount,
-- method, reference, proof image, when it was captured and when it is due back.
alter table public.guest_checks
  add column if not exists id_method           text,          -- link | salato | manual | ota
  add column if not exists id_captured_at      timestamptz,
  add column if not exists id_name             text,          -- name as it reads on the ID
  add column if not exists id_path             text,          -- storage path in guest-verify
  add column if not exists selfie_path         text,
  add column if not exists id_link_sent_at     timestamptz,
  add column if not exists id_link_sent_by     text,
  add column if not exists id_link_sent_via    text,          -- guesty | copied
  add column if not exists deposit_method      text,          -- guesty_hold | card_link | ota | cash | other
  add column if not exists deposit_ref         text,          -- hold / auth / receipt reference
  add column if not exists deposit_captured_at timestamptz,
  add column if not exists deposit_captured_by text,
  add column if not exists deposit_proof_path  text,
  add column if not exists deposit_release_due date,
  add column if not exists deposit_released_at timestamptz,
  add column if not exists deposit_released_by text;
-- deposit_status now also takes: released | claimed (kept as text, no constraint, so an older row never breaks).
create index if not exists guest_checks_release_idx on public.guest_checks (deposit_release_due) where deposit_status = 'captured';
notify pgrst, 'reload schema';
