-- 131 — ops housekeeping (2026-09-28 cron & sync audit).
--
-- Safe to run more than once, in one go, in the Supabase SQL editor. The app works before and
-- after it: every reader falls back to its old behaviour while an object below does not exist.

-- ---- 1. The latest run of every automation ------------------------------------------------------
-- lastRuns() used to read the newest 600 automation_runs rows and keep the first per name. At
-- ~500-600 receipts a day that is about one day: weekly jobs (eve-review, weekly-planner) and
-- quiet dailies read as "never ran" on the Automations and Learning views and in Eve's answers.
-- One row per name, straight off the (name, ran_at desc) index from migration 058.
--
-- security_invoker (Postgres 15+) makes the view obey automation_runs' own RLS (service role only);
-- on an older Postgres the revoke below does the same job.
do $$
begin
  if to_regclass('public.automation_runs') is not null then
    begin
      execute $v$
        create or replace view public.automation_last_runs
        with (security_invoker = true) as
        select distinct on (name) name, ok, ran_at, item_count, error, ms
        from public.automation_runs
        order by name, ran_at desc
      $v$;
    exception when others then
      execute $v$
        create or replace view public.automation_last_runs as
        select distinct on (name) name, ok, ran_at, item_count, error, ms
        from public.automation_runs
        order by name, ran_at desc
      $v$;
    end;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on public.automation_last_runs from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'revoke all on public.automation_last_runs from authenticated';
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute 'grant select on public.automation_last_runs to service_role';
    end if;
  end if;
end $$;

-- ---- 2. The log prune — SHIPPED OFF -------------------------------------------------------------
-- These LOG tables had no dated delete anywhere and grow forever (~500-600 automation_runs rows a
-- day alone). prune_logs() deletes rows past their retention in batches of at most 10,000 per
-- table per call and returns what it deleted — or, with dry_run (the default), what it WOULD
-- delete — as jsonb, e.g. {"automation_runs": 1234, "email_log": 0}. `only_table` limits a call to
-- one table (the nightly trash sweep calls it table by table, so no single statement runs long).
--
-- Retention: automation_runs 60 days (the newest row per job is always kept, so a weekly job never
-- vanishes); app_notifications read and over 30 days, or any over 90; user_activity 180 days
-- (never the admin audit trail — rows with meta.admin = true — which is kept for good);
-- email_log 180; eve_watch_fires 45 (cooldowns are clamped to 30); eve_audits resolved over 90;
-- guesty_conversation_sentiment whose last message is over 180 days old (the scan looks back 60);
-- telegram_messages 90; rev_feed_row month-scoped rows for months over 13 months back and any row
-- not refreshed in 13 months (raw landing only — the typed rev_* tables are what gets read);
-- ai_usage 180 (its screen reads at most 90).
--
-- NEVER Eve's chats, actions or memory, and never a business table (bookings, tasks, messages,
-- the owner ledger). A table or column that does not exist is reported as skipped, not an error.
--
-- It runs only from the nightly trash sweep (app/api/cron/trash-sweep), and only when
-- app_settings `housekeeping` holds "prune": true ("prune": "dry" records the counts it would
-- delete). Default: off.
create or replace function public.prune_logs(dry_run boolean default true, only_table text default null)
returns jsonb
language plpgsql
set search_path = public
as $fn$
declare
  lim constant integer := 10000;
  result jsonb := '{}'::jsonb;
  n bigint;
  missing text;
  t record;
begin
  for t in
    select * from (values
      ('automation_runs',
       'x.ran_at < now() - interval ''60 days'' and exists (select 1 from public.automation_runs b where b.name = x.name and b.ran_at > x.ran_at)',
       array['name', 'ran_at']),
      ('app_notifications',
       '(x.read is true and x.created_at < now() - interval ''30 days'') or x.created_at < now() - interval ''90 days''',
       array['read', 'created_at']),
      -- The admin audit trail (lib/activity.ts logAdmin, meta.admin = true) is never pruned.
      ('user_activity',
       'x.at < now() - interval ''180 days'' and (x.meta ->> ''admin'') is distinct from ''true''',
       array['at', 'meta']),
      ('email_log', 'x.sent_at < now() - interval ''180 days''', array['sent_at']),
      ('eve_watch_fires', 'x.fired_at < now() - interval ''45 days''', array['fired_at']),
      ('eve_audits',
       'x.status = ''resolved'' and coalesce(x.resolved_at, x.last_seen_at) < now() - interval ''90 days''',
       array['status', 'resolved_at', 'last_seen_at']),
      ('guesty_conversation_sentiment', 'x.last_message_at < now() - interval ''180 days''', array['last_message_at']),
      ('telegram_messages', 'x.created_at < now() - interval ''90 days''', array['created_at']),
      ('rev_feed_row',
       '(x.month ~ ''^[0-9]{4}-[0-9]{2}$'' and x.month < to_char(now() - interval ''13 months'', ''YYYY-MM'')) or x.synced_at < now() - interval ''13 months''',
       array['month', 'synced_at']),
      ('ai_usage', 'x.at < now() - interval ''180 days''', array['at'])
    ) as v(tbl, cond, cols)
  loop
    if only_table is not null and only_table <> t.tbl then
      continue;
    end if;
    if to_regclass('public.' || t.tbl) is null then
      result := result || jsonb_build_object(t.tbl, 'skipped: no such table');
      continue;
    end if;
    select string_agg(c.col, ', ') into missing
      from unnest(t.cols) as c(col)
     where not exists (select 1 from information_schema.columns ic
                        where ic.table_schema = 'public' and ic.table_name = t.tbl and ic.column_name = c.col);
    if missing is not null then
      result := result || jsonb_build_object(t.tbl, 'skipped: missing column ' || missing);
      continue;
    end if;
    if dry_run then
      execute format('select count(*) from (select 1 from public.%I x where %s limit %s) s', t.tbl, t.cond, lim) into n;
    else
      execute format('delete from public.%I where ctid in (select x.ctid from public.%I x where %s limit %s)', t.tbl, t.tbl, t.cond, lim);
      get diagnostics n = row_count;
    end if;
    result := result || jsonb_build_object(t.tbl, n);
  end loop;
  return result;
end
$fn$;

-- Service role only: the app calls it with the service key; nobody signed in can.
revoke all on function public.prune_logs(boolean, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.prune_logs(boolean, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.prune_logs(boolean, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.prune_logs(boolean, text) to service_role';
  end if;
end $$;

-- Let PostgREST see the new view and function straight away.
notify pgrst, 'reload schema';
