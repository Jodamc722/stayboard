-- 130 — THE DATABASE EDGE (security audit 2026-09-28, findings B-1 and B-2).
--
-- The Supabase anon key ships in every page bundle, so Row Level Security is the only thing between
-- PostgREST and the tables. Two gaps were left:
--
--   B-1  Nineteen tables were created with RLS off: the eight Garden Hotel tables from 115/116 (guest
--        name, email, phone, totals, ID/card verification status), the nine from 117 (staff, shifts,
--        the call queue, reviews, owner reports, phone calls), pm_schedule (113 turned it OFF
--        explicitly) and labor_settings (sql/labor_settings_schema.sql, pay thresholds). Every read
--        and write of these goes through the service-role client, which bypasses RLS, so turning it
--        on with NO policy shuts the anon/authenticated door and changes nothing for the app.
--
--   B-2  Sixteen read policies said `to authenticated using (true)`: ANY Supabase login could read
--        every reservation, guest message and owner statement straight from PostgREST — including a
--        disabled employee whose session is still alive, or a self-signup account. They now admit
--        only an ACTIVE member of the Lighthouse allowlist (app_users), plus the owner, the same bar
--        middleware.ts and lib/access.ts apply to every page and API route.
--
--        These policies are load-bearing for the app: the messages, reservations, requests and
--        building pages and components/CustomFieldsAdmin.tsx read these tables with the SIGNED-IN
--        user's own client. For an active member nothing changes.
--
-- Idempotent: safe to run twice. Every statement is guarded so a table that does not exist yet is
-- skipped instead of failing the script.

-- ── B-1: RLS on, no policy (service role only) ──────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    -- 115_garden_hotel.sql
    'garden_rooms', 'garden_reservations', 'garden_tasks', 'garden_calls', 'garden_verifications', 'garden_sync_status',
    -- 116_garden_adam.sql
    'garden_agent_memory', 'garden_agent_chats',
    -- 117_garden_ops.sql
    'garden_staff', 'garden_shifts', 'garden_call_queue', 'garden_events', 'garden_triggers', 'garden_trigger_log',
    'garden_reviews', 'garden_owner_reports', 'garden_phone_calls',
    -- 113_pm_schedule.sql (which disabled it on purpose; the PM ledger is read by the service role only)
    'pm_schedule',
    -- sql/labor_settings_schema.sql
    'labor_settings',
    -- Created in the dashboard, no migration on record, read and written only by the service role:
    -- the admin password / rules password / vault code live in share_settings, the role templates in
    -- app_roles. A no-op when RLS is already on.
    'share_settings', 'app_roles'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;

  -- Any other Garden Hotel table that exists when this runs (a later garden_* migration run first).
  -- The whole Garden backend (lib/garden, app/api/garden) is service-role only.
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'garden\_%' and not c.relrowsecurity loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ── B-2: who counts as a member ─────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so it can read app_users whatever that table's own policies are; it answers only
-- about the CALLER's own JWT, so there is nothing to leak. The owner is admitted by email, exactly
-- like lib/access.ts SUPERADMIN, so no edit to any row can lock him out of his own pages.
create or replace function public.lh_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'jon@stay-hospitality.com'
    or exists (
      select 1
        from public.app_users u
       where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and u.status = 'active'
    )
$$;

revoke all on function public.lh_is_member() from public;
revoke all on function public.lh_is_member() from anon;
grant execute on function public.lh_is_member() to authenticated;
grant execute on function public.lh_is_member() to service_role;

-- ── B-2: the sixteen read policies, same names, member-only ─────────────────────────────────────
-- `(select public.lh_is_member())` is evaluated once per query, not once per row.
do $$
declare
  p record;
begin
  for p in
    select * from (values
      -- 001_guesty_cache.sql
      ('guesty_custom_fields',    'authenticated read'),
      ('guesty_reservations',     'authenticated read'),
      ('guesty_listings',         'authenticated read'),
      ('guesty_conversations',    'authenticated read'),
      ('guesty_messages',         'authenticated read'),
      ('guesty_sync_status',      'authenticated read'),
      -- 008_eve_knowledge.sql
      ('eve_knowledge',           'authenticated read eve_knowledge'),
      -- 009_breezeway_tasks.sql
      ('breezeway_properties',    'auth read bzprop'),
      ('breezeway_tasks',         'auth read bztask'),
      -- 014_owner_statements.sql
      ('guesty_owners',           'authenticated read'),
      ('guesty_owner_statements', 'authenticated read'),
      ('guesty_owner_ledger',     'authenticated read'),
      ('guesty_ledger_months',    'authenticated read'),
      -- 015_reservation_notices.sql
      ('reservation_notices',     'authenticated read'),
      -- 032_field_requests_rls.sql
      ('field_requests',          'signed-in read'),
      ('field_request_comments',  'signed-in read')
    ) as v(tbl, pol)
  loop
    if to_regclass('public.' || p.tbl) is not null then
      execute format('drop policy if exists %I on public.%I', p.pol, p.tbl);
      execute format('create policy %I on public.%I for select to authenticated using ((select public.lh_is_member()))', p.pol, p.tbl);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
