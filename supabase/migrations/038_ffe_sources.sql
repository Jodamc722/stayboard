-- WHERE WE BUY IT — several answers per product, decided later (Jon, 2026-08-13).
--
--   "Not sure yet where we will purchase from but could be Amazon, a partner with HostGPO,
--    Wayfair, City Furniture, etc."
--
-- THE CATALOG ASSUMED ONE SOURCE PER PRODUCT, which quietly forces a decision at the wrong moment.
-- A nightstand is one product; Amazon, Wayfair, City Furniture and a HostGPO partner are four
-- prices for it, and which one you use depends on lead time, freight, whether the GPO rate applies
-- this quarter and whether they can deliver 26 of them. Storing one vendor on the product means
-- either deciding before you have quotes, or overwriting the comparison every time you get a new
-- one.
--
-- So sources hang off the product, many to one. One of them can be marked preferred — that is the
-- price a quote uses until somebody says otherwise — and the rest stay visible, which is the whole
-- point: next quarter when City Furniture raises freight, the Wayfair number is still sitting there.
--
-- The line still SNAPSHOTS vendor, sku, url and cost at order time (migration 034). This table is
-- what you choose FROM; the line records what you chose.

create table if not exists ffe_catalog_sources (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references ffe_catalog(id) on delete cascade,
  vendor text not null,
  vendor_sku text,
  url text,
  unit_cost numeric(12,2),
  lead_time_days integer,
  -- Group purchasing: a HostGPO member rate is not a public price, and a quote built on one should
  -- be legible as such when somebody asks why it is cheaper than the website.
  member_price boolean not null default false,
  in_stock boolean,
  note text,
  preferred boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (catalog_id, vendor, vendor_sku)
);
create index if not exists ffe_catalog_sources_catalog on ffe_catalog_sources (catalog_id);
create index if not exists ffe_catalog_sources_vendor on ffe_catalog_sources (vendor);

alter table ffe_catalog_sources enable row level security;
