-- 026: Manager access to the tabs gated in 025 (2026-08-06)
--
-- Why this exists: migration 025's comment assumed "every other role's '*' already covers it
-- (admin/manager full)". True for admin (perms->>'*' = 'full') but NOT for manager -- manager has
-- NO '*' key at all, it enumerates every tab explicitly. So the moment Salato and Inspections
-- became gated features, roleLevel() fell through to 'off' for manager and the 4 people in that
-- role silently lost a page they could see the day before (/salato was previously in
-- UNGATED_PAGES, i.e. visible to any logged-in member).
--
-- 'full' matches what manager already has on every comparable tab (audits, claims, orders...).
-- Applied in production on 2026-08-06 via /users -> Roles -> Manager; this file records it.
-- Safe to re-run: only fires where manager has not already made an explicit choice.
update app_roles
   set perms = jsonb_set(perms, '{salato}', '"full"', true)
 where key = 'manager'
   and not (perms ? 'salato');

update app_roles
   set perms = jsonb_set(perms, '{inspections}', '"full"', true)
 where key = 'manager'
   and not (perms ? 'inspections');

-- NOTE (deliberately not changed here): 'patterns' (Building Patterns) has the identical gap and
-- is currently off for manager for the same reason. Left alone because that tab is Jon's own and
-- may be intentionally dark while he tests it. One more block here when managers should see it.

notify pgrst, 'reload schema';
