-- 137 — the two client read/write policies nothing uses (2026-09-29).
--
-- Applied in production on 2026-09-29 on Jon's go-ahead (both policies sit on the Stay Onboarding
-- app's side of this shared Supabase project). Verified after: guesty_tokens has no client policy;
-- guesty_reviews_read is members-only. Safe to run more than once, in one go, in the SQL editor.
--
-- Evidence it breaks nothing: pg_stat_statements since 2026-08-08 (no entries evicted — dealloc 0,
-- 3,496 of 5,000 tracked). No statement run as `authenticated` or `anon` ever touched guesty_tokens or
-- guesty_reviews; every read of them is the service role (the app's server). The other guesty_*
-- tables ARE read and written by signed-in clients (the Stay Onboarding app inserts into
-- guesty_messages and guesty_reservations), so their *_internal policies stay as they are.
--
-- 1. guesty_tokens — gt_internal let any "internal" Stay Onboarding login read, change or delete the
--    Guesty API token (full access to the PMS) straight from a browser. Migration 001 meant this
--    table to have no client policy at all ("no read policy = no client access"). Dropped.
-- 2. guesty_reviews — guesty_reviews_read let ANY signed-in user of any app on this project read
--    every guest review. Narrowed to Lighthouse members, like the other guest tables in 130.
set lock_timeout = '3s';

do $$
begin
  if to_regclass('public.guesty_tokens') is not null then
    execute 'drop policy if exists gt_internal on public.guesty_tokens';
  end if;
  if to_regclass('public.guesty_reviews') is not null and to_regprocedure('public.lh_is_member()') is not null then
    execute 'drop policy if exists guesty_reviews_read on public.guesty_reviews';
    execute 'create policy guesty_reviews_read on public.guesty_reviews for select to authenticated using ((select public.lh_is_member()))';
  end if;
end $$;

notify pgrst, 'reload schema';
