-- 081: SOLD IN MULTIPLES (Jon, 2026-09-10: "some need to be 5x of something, like coffee pods —
-- can't order one… customizable per item at the stock / inventory").
--
-- sold_in = the guest orders this item in multiples of N: a first Add puts N in the basket, +/−
-- step by N, and the server rounds any other quantity UP to the next multiple. NULL or 1 = any
-- quantity. Distinct from pack_size (what WE buy by, used only for cost) and from max_qty.
alter table guest_order_catalog add column if not exists sold_in integer;
alter table guest_order_catalog drop constraint if exists guest_order_catalog_sold_in_chk;
alter table guest_order_catalog add constraint guest_order_catalog_sold_in_chk check (sold_in is null or (sold_in >= 1 and sold_in <= 999));
notify pgrst, 'reload schema';
