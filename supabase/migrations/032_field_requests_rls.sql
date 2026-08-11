-- 032: turn row level security ON for field_requests (+ comments).
-- Migration 002 disabled RLS on these tables, and the app wrote them from the BROWSER Supabase
-- client — meaning the public anon key alone was enough to approve spend, bypassing the role
-- levels entirely. As of 2026-08-10 every write goes through /api/requests/update (service role,
-- requireLevel-gated), so the tables need no write policies at all: signed-in users may READ,
-- and only the service role (which bypasses RLS) may write.
--
-- ⚠️ RUN ORDER: deploy the app code FIRST, then run this. Running it against the old code breaks
-- every browser-side request write (approvals, status changes, comments, new requests).

alter table field_requests enable row level security;
alter table field_request_comments enable row level security;

drop policy if exists "signed-in read" on field_requests;
create policy "signed-in read" on field_requests
  for select to authenticated using (true);

drop policy if exists "signed-in read" on field_request_comments;
create policy "signed-in read" on field_request_comments
  for select to authenticated using (true);

-- No insert/update/delete policies on purpose: writes are service-role only via the API route.
