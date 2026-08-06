-- 025: gate new tabs (2026-08-06)
-- Safe to re-run: every update only fires when the role has NOT already made an explicit choice
-- for that tab, so nothing Jon set by hand in /users → Roles is ever overwritten.

-- 1) Owner Audit is owner/admin-only — same rule Jon applied to Revenue.
--    Managers were inheriting it at Full through their '*' catch-all.
update app_roles
   set perms = jsonb_set(perms, '{owner-audit}', '"off"', true)
 where key = 'manager'
   and not (perms ? 'owner-audit');

-- 2) Inspections joins the permission grid (was reachable by any logged-in member, no setting).
--    Default mirrors Audits: edit for the field roles; every other role's '*' already covers it
--    (admin/manager full, cs/data off).
update app_roles
   set perms = jsonb_set(perms, '{inspections}', '"edit"', true)
 where key in ('cs_manager', 'maintenance', 'ops')
   and not (perms ? 'inspections');

-- 3) Salato Front Desk joins the grid too (Jon, second pass 2026-08-06): guest PII behind a role
--    setting. Front-desk/guest roles get edit (the board's whole job is appending team notes);
--    everyone else falls to their '*' (admin/manager full, maintenance/data off).
--    The public share links (/salato/share, /salato/verify) are untouched — separate password gate.
update app_roles
   set perms = jsonb_set(perms, '{salato}', '"edit"', true)
 where key in ('cs', 'cs_manager', 'ops')
   and not (perms ? 'salato');

notify pgrst, 'reload schema';
