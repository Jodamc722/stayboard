-- 021: Custom roles with per-tab permission LEVELS (off / view / edit / full).
-- Replaces the hardcoded workspace presets as the source of truth for page access.
-- Roles are created/edited by the OWNER in /users → Roles; each user points at one via
-- app_users.access_role. Legacy columns (workspace, features) are KEPT and still honored:
--  - features[key] === false remains a per-person hard-off override on top of the role
--  - workspace remains the fail-open fallback if app_roles is missing or a user has no role.
-- Run in the Supabase SQL editor (project "Ops App"), then: NOTIFY pgrst, 'reload schema';

create table if not exists app_roles (
  key         text primary key,                 -- slug, e.g. 'cs_manager'
  label       text not null,                    -- display name, e.g. 'Customer Service Manager'
  blurb       text not null default '',
  landing     text not null default '/',        -- where this role lands after login
  perms       jsonb not null default '{}'::jsonb, -- { featureKey: 'off'|'view'|'edit'|'full', "*": defaultLevel }
  is_system   boolean not null default false,   -- Admin: locked, always full access
  sort        int not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table app_roles enable row level security; -- all app access is via service role; no public policies.

alter table app_users add column if not exists access_role text;

-- ---- Seed roles (safe to re-run: on conflict do nothing; edit them in /users → Roles later) ----
insert into app_roles (key, label, blurb, landing, perms, is_system, sort) values
('admin', 'Admin', 'Everything, plus user management', '/command', '{"*":"full"}', true, 10),
('manager', 'Manager', 'Every page at full access except Revenue (no user management)', '/command', '{"*":"full","revenue":"off"}', false, 20),
('cs_manager', 'Customer Service Manager', 'Guest experience lead: guest tabs full, ops edit, money view', '/reservations',
 '{"*":"off","command":"view","home":"edit","reservations":"full","reservation-emails":"full","messages":"full","reviews":"full","welcome-calls":"full","guidebooks":"full","faq":"full","plan":"edit","schedule":"edit","glitches":"edit","audits":"edit","orders":"edit","requests":"edit","claims":"edit","buildings":"view","channels":"view","marketing":"view","reports":"view","cleaners":"view","labor":"view"}', false, 30),
('cs', 'Customer Service', 'Guests: reservations, messages, reviews, calls; claims read-only', '/reservations',
 '{"*":"off","home":"edit","reservations":"edit","reservation-emails":"edit","messages":"edit","reviews":"edit","welcome-calls":"edit","guidebooks":"edit","faq":"edit","glitches":"edit","requests":"edit","claims":"view"}', false, 40),
('maintenance', 'Maintenance', 'Work orders, guest issues, audits; properties read-only', '/plan',
 '{"*":"off","home":"view","plan":"edit","requests":"edit","glitches":"edit","audits":"edit","buildings":"view","faq":"view"}', false, 50),
('ops', 'Ops', 'Field operations: cleans, schedule, glitches, audits, purchasing', '/plan',
 '{"*":"off","home":"edit","plan":"edit","schedule":"edit","forecast":"edit","glitches":"edit","audits":"edit","orders":"edit","requests":"edit","cleaners":"edit","labor":"edit","buildings":"view","faq":"edit"}', false, 60),
('data', 'Data', 'Performance: channels, direct bookings, reports at full (Revenue itself is owner/admin-only)', '/marketing',
 '{"*":"off","home":"edit","channels":"full","marketing":"full","reports":"full","health":"full","buildings":"view","listings":"view","claims":"edit","faq":"view"}', false, 70)
on conflict (key) do nothing;

-- ---- Map existing people onto roles (only where not already set) ----
update app_users set access_role = case
  when role = 'admin' then 'admin'
  when workspace = 'ops' then 'ops'
  when workspace = 'cs' then 'cs'
  when workspace = 'data' then 'data'
  else 'manager'  -- gm / unknown / null → Manager (same full access they effectively had)
end where access_role is null;

-- After running: NOTIFY pgrst, 'reload schema';
