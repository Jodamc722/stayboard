-- GUEST ORDERS — the "vending machine" (Jon, 2026-08-24):
--
--   "a reservation form assigned to the individual reservation, where guest can pick items they
--    want like water. This will be auto generated and once form is filled out, it will go to a
--    approval page, we will then generate a charge, once paid push the details to breezeway
--    automatically on their arrival day … orders will live in a live link and be assigned
--    automatically to supervisor and cleaner that's cleaning the unit or working in the building."
--
--   "Needs to be completed within 24 to 48 hours minimum in order to receive a day of arrival.
--    Once payment is approved, it takes at least 24 hours to receive. Could be same day depending
--    on the time."
--
-- Three tables:
--   guest_order_catalog  what can be ordered (edited at /users → App settings → Guest orders)
--   guest_order_links    ONE unguessable link per reservation — the thing we send the guest
--   guest_orders         each submitted basket: approval → Guesty charge → Breezeway push → delivered
--
-- Everything is read/written through the service role (RLS ON, no policies) — the public guest
-- page goes through /api/public/guest-order which scopes every read to the link code it was given.

create table if not exists guest_order_catalog (
  id            uuid primary key default gen_random_uuid(),
  sku           text not null unique,
  name          text not null,
  description   text,
  price_usd     numeric(10,2) not null default 0,
  unit_label    text,                          -- "case of 12", "each", "set"
  category      text,                          -- Drinks | Snacks | Comfort | Baby | Services
  fee_code      text not null default 'GUEST_SERVICE',  -- Guesty invoice-item secondIdentifier (BEVERAGE, FOOD, …)
  max_qty       integer not null default 10,
  sort          integer not null default 100,
  active        boolean not null default true,
  buildings     text[],                        -- null = every building; else canonical labels only
  markets       text[],                        -- null = every market; else Miami | Broward | North
  image_url     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists guest_order_links (
  code            text primary key,            -- unguessable, in the URL: /order/<code>
  reservation_id  text not null unique,
  listing_id      text,
  unit            text,
  building        text,
  market          text,
  guest_name      text,
  guest_email     text,
  guest_id        text,
  conversation_id text,
  source          text,
  check_in        date,
  check_out       date,
  check_in_time   text,                        -- "16:00" from the listing, for the order-by clock
  sent_at         timestamptz,                 -- when the link went to the guest
  sent_via        text,                        -- guesty:<module> | email | manual
  send_error      text,
  opened_at       timestamptz,
  created_by      text,                        -- email, or 'cron'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_guest_order_links_checkin on guest_order_links(check_in);

create table if not exists guest_orders (
  id                      uuid primary key default gen_random_uuid(),
  link_code               text not null references guest_order_links(code) on delete cascade,
  reservation_id          text not null,
  listing_id              text,
  unit                    text,
  building                text,
  market                  text,
  guest_name              text,
  guest_email             text,
  check_in                date,
  check_out               date,
  -- submitted | approved | paid | awaiting_payment | payment_failed | pushed | delivered | declined | cancelled
  status                  text not null default 'submitted',
  items                   jsonb not null default '[]',   -- [{sku,name,qty,unit_price_usd,line_total_usd,fee_code}]
  subtotal_usd            numeric(10,2) not null default 0,
  tax_usd                 numeric(10,2) not null default 0,
  total_usd               numeric(10,2) not null default 0,
  currency                text not null default 'USD',
  guest_note              text,
  submitted_at            timestamptz not null default now(),
  approve_token           text unique,                   -- one-time secret for the approve-from-Slack link
  approved_at             timestamptz,
  approved_by             text,
  declined_at             timestamptz,
  declined_by             text,
  decline_reason          text,
  paid_at                 timestamptz,
  paid_via                text,                          -- guesty:<pm id> | manual
  payment_note            text,
  guesty_payment_id       text,
  guesty_invoice_item_ids text[] not null default '{}',
  folio_lines_done        integer not null default 0,   -- how many folio lines Guesty accepted (resume point on retry)
  folio_note              text,                          -- e.g. lines left on the folio after a decline
  charge_error            text,
  charge_raw              jsonb,
  delivery_date           date,                          -- computed from paid_at + lead time, never before check_in
  delivery_note           text,                          -- "arrival day" | "next day" | "same day" | "after checkout — schedule by hand"
  pushed_at               timestamptz,
  breezeway_task_id       text,
  assignee_names          text[] not null default '{}',
  assignee_ids            integer[] not null default '{}',
  assign_note             text,                          -- how the assignee was picked
  slack_outbox_id         uuid,
  push_error              text,
  email_sent_at           timestamptz,
  delivered_at            timestamptz,
  delivered_by            text,
  cancelled_at            timestamptz,
  cancelled_by            text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists idx_guest_orders_status on guest_orders(status);
create index if not exists idx_guest_orders_delivery on guest_orders(delivery_date);
create index if not exists idx_guest_orders_reservation on guest_orders(reservation_id);
create index if not exists idx_guest_orders_link on guest_orders(link_code);

alter table guest_order_catalog enable row level security;
alter table guest_order_links   enable row level security;
alter table guest_orders        enable row level security;

-- Starter catalog — Jon edits this in the app; prices are placeholders to be confirmed.
insert into guest_order_catalog (sku, name, description, price_usd, unit_label, category, fee_code, sort) values
  ('water-12',      'Bottled water',         'Case of 12 × 500ml still water, chilled in the fridge', 15, 'case of 12', 'Drinks', 'BEVERAGE', 10),
  ('sparkling-6',   'Sparkling water',       '6 × 330ml sparkling water',                              12, 'pack of 6',  'Drinks', 'BEVERAGE', 20),
  ('coffee-pods',   'Coffee pods',           'Box of 12 pods for the in-suite machine',                12, 'box of 12',  'Drinks', 'BEVERAGE', 30),
  ('snack-box',     'Snack box',             'Chips, nuts, granola bars and chocolate for the stay',   25, 'box',        'Snacks', 'FOOD', 40),
  ('breakfast-kit', 'Breakfast basics',      'Milk, eggs, bread, butter, juice and fruit',             45, 'kit',        'Snacks', 'FOOD', 50),
  ('towels-extra',  'Extra towel set',       '2 bath towels, 2 hand towels, 2 washcloths',             15, 'set',        'Comfort', 'TOWELS', 60),
  ('beach-towels',  'Beach towels',          '2 oversized beach towels',                               12, 'pair',       'Comfort', 'TOWELS', 70),
  ('crib',          'Crib / pack-n-play',    'Set up in the suite with fresh linens',                  35, 'per stay',   'Baby', 'BABY_BED', 80),
  ('high-chair',    'High chair',            'Ready in the dining area',                               20, 'per stay',   'Baby', 'GUEST_SERVICE', 90)
on conflict (sku) do nothing;
