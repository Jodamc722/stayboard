-- THE GARDEN HOTEL ON HOMEBASE (Jon, 2026-09-29: "Garden uses Homebase for non-W2 contract labor
-- just like us"). lib/garden/homebase mirrors the hotel's Homebase people and punches here — never
-- into the VR labor tables.
alter table garden_staff add column if not exists homebase_id text;
alter table garden_staff add column if not exists wage_rate numeric;
alter table garden_staff add column if not exists employment text;          -- contract | w2
create index if not exists garden_staff_homebase on garden_staff (homebase_id);

create table if not exists garden_timecards (
  id                    text primary key,          -- Homebase timecard id
  location_uuid         text,
  homebase_employee_id  text,
  staff_id              uuid references garden_staff (id) on delete set null,
  name                  text,
  role                  text,
  date                  date,
  clock_in              timestamptz,
  clock_out             timestamptz,
  hours                 numeric,
  wage_rate             numeric,
  labor_cost            numeric,
  open                  boolean not null default false,
  synced_at             timestamptz not null default now()
);
create index if not exists garden_timecards_date on garden_timecards (date);
alter table garden_timecards enable row level security;
