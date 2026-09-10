-- 082: COUPON CODES for the guest store (Jon, 2026-09-10: "have coupon code enter area for guests
-- that we can send to them").
--
-- One row per code. Either percent_off OR amount_off_usd (percent wins if both are set). A code
-- can be limited to a minimum basket, to buildings, to a window of dates, and to a number of uses.
-- It applies AFTER the spend-and-save ladder, on what is left, and is stored on the order as its
-- own line so the folio, the email and the board agree.
create table if not exists guest_order_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                    -- stored upper-case, letters/digits/dashes
  label text,                                   -- what the guest reads: "Welcome back — 15% off"
  percent_off numeric(5,2),
  amount_off_usd numeric(10,2),
  min_subtotal_usd numeric(10,2) not null default 0,
  buildings text[],                             -- null = every building
  starts_at timestamptz,
  expires_at timestamptz,
  max_uses integer,                             -- null = unlimited
  used integer not null default 0,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_order_coupons_kind_chk check (
    (percent_off is not null and percent_off > 0 and percent_off <= 100) or (amount_off_usd is not null and amount_off_usd > 0)
  )
);
alter table guest_order_coupons enable row level security;
create index if not exists guest_order_coupons_active_idx on guest_order_coupons (active, expires_at);

alter table guest_orders
  add column if not exists coupon_code text,
  add column if not exists coupon_discount_usd numeric(10,2) not null default 0;
comment on column guest_orders.coupon_code is 'The coupon the guest entered and we honoured (upper-case). discount_usd already includes coupon_discount_usd.';
notify pgrst, 'reload schema';
