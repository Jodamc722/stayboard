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
