-- Guest orders: LOCATION HUBS + INVENTORY (Jon, 2026-08-24: "customize by property or location
-- hubs… build an inventory module where we can track; if out of stock removes the item from the list").
--
-- Hubs are defined in app_settings (guest_orders.hubs = [{id,label,buildings[]}]) — a hub is where
-- the supplies physically sit. Stock is counted per item per scope: 'hub:<id>' or 'global'.
-- on_hand = what is on the shelf; reserved = paid orders not yet delivered. available = on_hand −
-- reserved, and a tracked item with nothing available disappears from the guest's form.
alter table guest_order_catalog add column if not exists hubs text[];                          -- null = every hub
alter table guest_order_catalog add column if not exists track_stock boolean not null default false;

create table if not exists guest_order_stock (
  item_id     uuid not null references guest_order_catalog(id) on delete cascade,
  scope       text not null default 'global',       -- 'global' | 'hub:<hub id>'
  on_hand     integer not null default 0,
  reserved    integer not null default 0,
  low_at      integer not null default 3,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (item_id, scope)
);

create table if not exists guest_order_stock_log (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null,
  scope            text not null,
  delta_on_hand    integer not null default 0,
  delta_reserved   integer not null default 0,
  reason           text not null,                  -- stock_take | reserve | release | consume
  order_id         uuid,
  actor            text,
  at               timestamptz not null default now()
);
create index if not exists idx_guest_order_stock_log_item on guest_order_stock_log(item_id, at desc);

alter table guest_orders add column if not exists stock_scope text;     -- scope the order reserved against
alter table guest_orders add column if not exists stock_note text;      -- e.g. "reserved 2× Bottled water"

alter table guest_order_stock     enable row level security;
alter table guest_order_stock_log enable row level security;
