-- CLOSE THE ANON-KEY HOLE ON EVERY TABLE THAT NEVER HAD RLS.
--
-- Security audit, 2026-08-29. This repo is PUBLIC and the Supabase anon key ships in the client
-- bundle by construction (lib/supabase-browser.ts). Supabase's default grants give the `anon` role
-- full DML on every table in `public`, so ROW LEVEL SECURITY is the only thing standing between the
-- open internet and these tables. Nine of them never turned it on.
--
-- The worst two:
--   guest_profiles  — every guest's name, email, phone and free-text notes.
--   share_links     — share codes AND their passcodes, in plaintext. Dumping this table hands an
--                     attacker the keys to every /share, /board and owner-audit link.
-- Anyone could `GET {project}.supabase.co/rest/v1/guest_profiles?select=*` with the public anon key
-- and read, or write, the lot.
--
-- WHY THIS IS SAFE TO SHIP BLIND. Every server path that touches these tables uses the SERVICE-ROLE
-- client (lib/supabase-admin), which bypasses RLS entirely. Verified 2026-08-29: no client component
-- and no user-JWT server route reads any of them. So enabling RLS with NO policy denies the anon and
-- authenticated roles (the exploit) and changes nothing for the app (service role is unaffected).
--
-- If a table later needs to be read by a logged-in user's own session, add a scoped policy THEN —
-- deny-by-default is the correct starting point, not the thing to fix later.

alter table if exists public.guest_profiles      enable row level security;
alter table if exists public.share_links         enable row level security;
alter table if exists public.staff               enable row level security;
alter table if exists public.staffing_agencies   enable row level security;
alter table if exists public.review_actions      enable row level security;
alter table if exists public.auto_inspections    enable row level security;
alter table if exists public.ffe_answers         enable row level security;
alter table if exists public.ffe_unit_status     enable row level security;
alter table if exists public.ffe_checklist_items enable row level security;

-- Two more tables were created straight in the dashboard and have no migration at all, so their RLS
-- state is unversioned and unreviewable. Both hold operational data written only by service-role
-- routes (schedule staging, the glitch board). Force them on here too; the `if exists` guard makes
-- this a no-op if either was already locked down by hand.
alter table if exists public.schedule_staged enable row level security;
alter table if exists public.glitches        enable row level security;
