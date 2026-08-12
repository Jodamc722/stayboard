-- FF&E CATALOG + ORDERS (Jon, 2026-08-12)
--
--   "Have an add feature to the FFE tab. If we wanted to add lamps, etc. Make the way it populates
--    super easy and robust. Should be easy for team to complete, should be easy to show owner an
--    order once we pick the furniture replacement links. We should make this world class ordering
--    form and then actually managing it. With furniture codes, where they go, etc."
--
-- THE SHAPE. The walk answers what a unit NEEDS ("replace the lamps"). This adds what we are
-- actually BUYING ("LMP-TBL-001, Brushed brass table lamp, $89, Wayfair") and WHERE IT GOES
-- ("Botanica 1101 · Master bedroom"). Three tables, in that order:
--
--   ffe_catalog       the products, each with a code. Written once, reused on every order, so the
--                     same lamp is the same lamp across 53 units instead of 53 spellings of "lamp".
--   ffe_orders        one order per owner. Draft -> sent -> approved, with the owner's own words.
--   ffe_order_lines   one line per piece: product + destination + qty + cost, and its own stage,
--                     because 3 of 40 items being backordered is the thing you actually need to see.
--
-- STILL NOT A WORK ORDER. Same rule as migration 032: nothing here touches audit_items,
-- property_audits, Breezeway or billing. A furniture order is a purchase, not a maintenance ticket.
--
-- RLS is on and no policies are added on purpose. Every read and write goes through the service
-- role server-side, which bypasses RLS; anon and authenticated keys get nothing.

-- ── PRODUCTS ────────────────────────────────────────────────────────────────────────────────────
create table if not exists ffe_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null,                       -- LMP-001. Auto-derived on add, editable to a vendor SKU.
  name_en text not null,
  name_es text,
  category text not null default 'misc',
  room_hint text,                           -- default destination room key, e.g. 'master'
  item_keys text[] not null default '{}',   -- checklist items this product can satisfy -> auto-suggest
  vendor text,
  vendor_sku text,
  unit_cost numeric(12,2),
  url text,
  image_url text,
  dimensions text,
  finish text,
  lead_time_days integer,
  notes text,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code)
);
create index if not exists ffe_catalog_category on ffe_catalog (category);
create index if not exists ffe_catalog_active on ffe_catalog (active);

-- ── ORDERS ──────────────────────────────────────────────────────────────────────────────────────
create sequence if not exists ffe_order_seq;

create table if not exists ffe_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null default ('FFE-' || lpad(nextval('ffe_order_seq')::text, 4, '0')),
  owner_id text not null,
  owner_name text,
  title text,
  status text not null default 'draft',     -- draft | sent | approved | changes | closed
  note text,                                -- our note to the owner, shown on the shared page
  owner_note text,                          -- the owner's reply, in their words
  decided_at timestamptz,
  decided_by text,
  sent_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_no)
);
create index if not exists ffe_orders_owner on ffe_orders (owner_id);
create index if not exists ffe_orders_status on ffe_orders (status);

-- ── LINES ───────────────────────────────────────────────────────────────────────────────────────
-- Product fields are SNAPSHOTTED onto the line (code, product, cost, vendor) rather than joined
-- live. An order the owner approved at $89 a lamp must still read $89 next quarter when the catalog
-- price has moved — a quote you can re-price after the fact is not a quote.
create table if not exists ffe_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references ffe_orders(id) on delete cascade,
  listing_id text not null,
  unit_name text,
  building text,
  room text not null,
  item_key text not null,
  title text,                               -- what the walker flagged, in their words
  catalog_id uuid,
  code text,
  product text,
  image_url text,
  url text,
  vendor text,
  vendor_sku text,
  qty integer not null default 1,
  unit_cost numeric(12,2),
  placement text,                           -- where it goes, e.g. "Master - left of bed"
  stage text not null default 'draft',      -- draft|sent|approved|declined|ordered|delivered|installed
  po_number text,
  vendor_ref text,
  ordered_at timestamptz,
  delivered_at timestamptz,
  installed_at timestamptz,
  owner_choice text,                        -- yes | no, as the owner left it
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, listing_id, room, item_key)
);
create index if not exists ffe_order_lines_order on ffe_order_lines (order_id);
create index if not exists ffe_order_lines_listing on ffe_order_lines (listing_id);
create index if not exists ffe_order_lines_stage on ffe_order_lines (stage);

alter table ffe_catalog enable row level security;
alter table ffe_orders enable row level security;
alter table ffe_order_lines enable row level security;
