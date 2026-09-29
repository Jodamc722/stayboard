-- 135 — RLS leftovers found while checking 130 in production (2026-09-29).
--
-- Applied in production on 2026-09-29 (1 and 2 by hand right after 130, then this whole file);
-- it is here so a fresh database matches. Safe to run more than once, in one go, in the Supabase
-- SQL editor.
--
-- 1. Six guesty tables carried a second, older read policy named "auth_read" that let ANY signed-in
--    user read them, next to the "authenticated read" policy 130 narrowed. Policies are OR'ed, so
--    the old one kept the tables open. Narrowed the same way: members only (public.lh_is_member()).
-- 2. guesty_conversation_sentiment had RLS off. The app reads and writes it with the service role
--    only, so RLS on with no policy = no client access.
-- 3. The Garden Hotel tables 118 added after 130 ran (garden_roles, garden_handbook,
--    garden_agent_questions, shared_knowledge, garden_threads, garden_messages, garden_calendar,
--    garden_channels, garden_payments) were created with RLS off — readable AND writable with the
--    public anon key, garden_roles (who may open what) included. Every reader and writer of them is
--    the service role (lib/access.ts, lib/garden/*, app/api/garden/*), so RLS on with no policy.
--    The sweep covers any garden_% table, so a later garden migration that forgets is caught by
--    re-running this file. A new garden table should enable RLS in its own migration.
--
-- Not touched: the Stay Onboarding app's own policies on the same tables (the *_internal ones, via
-- is_internal_user()) and guesty_reviews_read. They serve that app's users; change them there.
set lock_timeout = '3s';

do $$
declare
  t text;
begin
  if to_regprocedure('public.lh_is_member()') is null then
    raise notice '135 skipped the auth_read policies: run 130 first (public.lh_is_member() is missing)';
  else
    foreach t in array array[
      'guesty_conversations', 'guesty_custom_fields', 'guesty_listings',
      'guesty_messages', 'guesty_reservations', 'guesty_sync_status'
    ] loop
      if to_regclass('public.' || t) is not null
         and exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'auth_read') then
        execute format('drop policy if exists %I on public.%I', 'auth_read', t);
        execute format('create policy %I on public.%I for select to authenticated using ((select public.lh_is_member()))', 'auth_read', t);
      end if;
    end loop;
  end if;
  if to_regclass('public.guesty_conversation_sentiment') is not null then
    execute 'alter table public.guesty_conversation_sentiment enable row level security';
  end if;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
              and (c.relname like 'garden\_%' or c.relname = 'shared_knowledge') loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
