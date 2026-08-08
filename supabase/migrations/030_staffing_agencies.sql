-- 030: Staffing agencies + staff records (2026-08-08)
--
-- Jon's ask: "we need to send hours to the agency for payroll... generate an invoice or payroll
-- hours and pay to agency. We should also be able to add rate agency charges, flat, % etc."
--
-- Homebase is the system of record for PUNCHES — who worked, which day, how many hours, at what
-- wage. It has no concept of which agency a person is contracted through, and its role field is
-- whatever the scheduler typed. So we store exactly the two things Homebase cannot tell us
-- (agency + our own role/area), key on the Homebase name, and read hours live from Homebase at
-- export time. Nothing about hours is duplicated here — a punch corrected in Homebase changes
-- the next invoice with no action on our side.
--
-- Two tables:
--
-- 1) staffing_agencies — the agencies we contract through (Opal, CityBest, Atlantic...) and what
--    each adds on top of wages. All three fee kinds stack and each defaults to 0, so an agency
--    can be pure %, pure per-hour, pure flat, or any combination, without a fee_type enum that
--    would need migrating every time a contract is written differently.
--
-- 2) staff — one row per person, keyed on their Homebase roster name. agency null = in-house.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

create table if not exists staffing_agencies (
  key           text primary key,              -- slug: 'opal', 'citybest', 'atlantic'
  label         text not null,                 -- display: 'Opal', 'CityBest', 'Atlantic'
  fee_percent   numeric not null default 0,    -- markup on base wages, e.g. 22 = +22%
  fee_per_hour  numeric not null default 0,    -- flat $ added per hour worked
  fee_flat      numeric not null default 0,    -- flat $ per invoice (per agency, per period)
  active        boolean not null default true,
  notes         text,
  sort          int not null default 100,
  updated_at    timestamptz not null default now()
);

create table if not exists staff (
  name        text primary key,                -- canonical Homebase roster name
  agency      text references staffing_agencies(key) on delete set null,  -- null = in-house / W2
  role        text,                            -- our label: Housekeeper | Maintenance | Supervisor...
  area        text,                            -- miami | broward | north | vendor | null
  active      boolean not null default true,
  notes       text,
  updated_at  timestamptz not null default now()
);

create index if not exists staff_agency_idx on staff (agency) where agency is not null;

-- Seed the agencies Jon named. Fees start at 0 so nothing is silently invoiced at a rate nobody
-- chose — they get set on /users -> App settings -> Staffing & agencies.
insert into staffing_agencies (key, label, sort) values
  ('opal',     'Opal',     10),
  ('citybest', 'CityBest', 20),
  ('atlantic', 'Atlantic', 30)
on conflict (key) do nothing;

-- Ethan is maintenance (Jon 2026-08-08). Agency intentionally left null until confirmed.
insert into staff (name, role) values ('Ethan', 'Maintenance')
on conflict (name) do update set role = excluded.role, updated_at = now();

notify pgrst, 'reload schema';
