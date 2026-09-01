-- EMPLOYMENT TYPE + A REAL VENDOR REGISTRY (Jon, 2026-09-01: "the staff and the settings…
-- need a revamp. We should add W-2, an option to add different vendors").
--
-- 1. Every person on the roster carries HOW they are employed, next to the crew they are on:
--      w2          our own payroll (hourly or salaried — `salaried` already says which)
--      contractor  1099, invoices us directly
--      agency      through a staffing agency (which one is the existing `agency` column,
--                  and the agency's markup already loads their cost in lib/labor-econ)
--      vendor      employed by an outside vendor company (see the vendors table below) —
--                  never on our payroll at all
--    No burden math changes yet (Jon: "for now no, we will get that data from Eric's app in
--    future") — this is the fact, recorded once, where every board can read it.
--
-- 2. Vendors stop being a regex over building names. Each vendor company is a row: who they
--    are, which buildings they cover, how they bill. lib/ops-presets merges the buildings
--    into vendorBuildings, so classification keeps working everywhere with zero call-site
--    changes — but the list is now edited on /users like everything else, not in code.

alter table if exists public.staff
  add column if not exists employment_type text;   -- w2 | contractor | agency | vendor | null=unknown

create table if not exists public.vendors (
  key         text primary key,                    -- slug, e.g. 'opal-works'
  label       text not null,                       -- display name
  buildings   text[] not null default '{}',        -- canonical building labels they cover
  billing     text,                                -- free text: 'per clean', 'monthly invoice', …
  contact     text,
  notes       text,
  active      boolean not null default true,
  sort        integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.vendors enable row level security;
