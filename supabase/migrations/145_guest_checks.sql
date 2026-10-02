-- GUEST CHECKS (2026-10-02, Jon: "track guest verification and deposits being captured"). What WE did
-- about the two checks our channel policy asks for before an arrival (lib/welcome-call-guide
-- channelPolicy: verify ID on Direct + Vrbo; collect a security deposit on Direct + Expedia + Vrbo).
-- The booking is Guesty's; this row is ours. A Salato stay verified through its own link
-- (app_settings sv:<rid>) counts as verified without a row here.
create table if not exists public.guest_checks (
  reservation_id  text primary key,
  id_status       text not null default 'pending',    -- pending | verified | waived
  deposit_status  text not null default 'pending',    -- pending | captured | waived
  deposit_amount  numeric,
  note            text,
  updated_at      timestamptz not null default now(),
  updated_by      text
);
alter table public.guest_checks enable row level security;
notify pgrst, 'reload schema';
