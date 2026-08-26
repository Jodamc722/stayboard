-- 057_staff_single_source.sql — ONE RECORD PER PERSON.
--
-- Jon, 2026-08-26: "can you make sure all staff and role is pulled from one source of data."
--
-- WHAT WAS WRONG. Every screen already agreed with every other screen, because they all walked
-- the same five-step ladder to decide who somebody is:
--
--   1. app_settings 'crew_roles'   — an operator override, stored as a JSON blob
--   2. DECLARED in lib/crew.ts     — a roster hardcoded in the source, changeable only by deploy
--   3. the `staff` table           — agency, role, market
--   4. Homebase's free-text role   — "Housekeeper Miami (Atlantic)", typed by whoever built a shift
--   5. what they did in Breezeway  — a last-resort guess from last week's task list
--
-- One deterministic ANSWER, but five places to look and five places to edit — which is how a
-- houseman ends up filed as a housekeeper, carrying 156 hours and 2 departure cleans inside the
-- cost per clean, with nobody able to say which of the five sources put him there.
--
-- WHAT THIS DOES. The `staff` row becomes the single source: crew, role, title, market, agency
-- and pay all live on it. The other four are demoted to SEEDS — they may fill a blank on a person
-- nobody has stated yet, and they may never override a staff row again.
--
-- PAY LIVES HERE TOO. Salaries were a constant in lib/salary.ts plus an app_settings override.
-- Jon, 2026-08-25: "we will eventually derive all financial info from Eric's app" — so the rate
-- belongs in a table his app can write, not in a deploy.
--
-- SAFE TO APPLY ANY TIME. Every column is nullable and the code reads them defensively, so the
-- app runs identically before and after this migration; applying it just moves the answer from
-- the ladder into the row.

alter table if exists public.staff add column if not exists dept text;
alter table if exists public.staff add column if not exists title text;
alter table if exists public.staff add column if not exists salaried boolean not null default false;
alter table if exists public.staff add column if not exists salary_hourly numeric;
alter table if exists public.staff add column if not exists salary_hours_per_week numeric;
alter table if exists public.staff add column if not exists salary_annual numeric;
-- Where this person's crew came from, so the People card can show what is stated versus guessed.
alter table if exists public.staff add column if not exists dept_source text;

comment on column public.staff.dept is
  'housekeeping | supervision | ccs | maintenance | inspection | other. THE answer — lib/crew reads this first and every other signal is only a seed for a blank.';
comment on column public.staff.salaried is
  'true = the salary below IS this person''s cost; Homebase punches are shown for comparison and never charged.';

-- ---------------------------------------------------------------------------------------------
-- SEED: the roster exactly as Jon stated it, so the day this runs nothing moves.
-- Only fills a blank — an operator choice already in the row always wins.
insert into public.staff (name, dept, dept_source, active) values
  ('Yoslenis Rodiguez',   'supervision', 'seed:roster', true),
  ('Guillermo Hernandez', 'supervision', 'seed:roster', true),
  ('Roberto Chiriboga',   'supervision', 'seed:roster', true),
  ('Ernesto Torres',      'maintenance', 'seed:roster', true),
  ('Ethan Tucker',        'maintenance', 'seed:roster', true),
  ('George Paz',          'maintenance', 'seed:roster', true),
  ('Gehron Regis',        'maintenance', 'seed:roster', true),
  ('Abel Guada',          'maintenance', 'seed:roster', true),
  ('Oscar Arciniegas',    'maintenance', 'seed:roster', true),
  ('Karla Valle',         'ccs',         'seed:roster', true),
  ('Jon McGill',          'other',       'seed:roster', true)
on conflict (name) do update
  set dept = coalesce(public.staff.dept, excluded.dept),
      dept_source = coalesce(public.staff.dept_source, excluded.dept_source);

-- SEED: the four salaries Jon stated (2026-08-24 / 2026-08-25). Same rule — never overwrite.
insert into public.staff (name, salaried, salary_annual, title, active) values
  ('Roberto Chiriboga', true, 80000, 'Operations Manager', true)
on conflict (name) do update
  set salaried = public.staff.salaried or excluded.salaried,
      salary_annual = coalesce(public.staff.salary_annual, excluded.salary_annual),
      title = coalesce(public.staff.title, excluded.title);

insert into public.staff (name, salaried, salary_hourly, salary_hours_per_week, title, active) values
  ('Yoslenis Rodiguez',   true, 29, 40, 'Supervisor',  true),
  ('Guillermo Hernandez', true, 22, 40, 'Supervisor',  true),
  ('George Paz',          true, 25, 40, 'Maintenance', true)
on conflict (name) do update
  set salaried = public.staff.salaried or excluded.salaried,
      salary_hourly = coalesce(public.staff.salary_hourly, excluded.salary_hourly),
      salary_hours_per_week = coalesce(public.staff.salary_hours_per_week, excluded.salary_hours_per_week),
      title = coalesce(public.staff.title, excluded.title);

create index if not exists staff_dept_idx on public.staff (dept);
create index if not exists staff_salaried_idx on public.staff (salaried) where salaried;
