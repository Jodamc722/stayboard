-- 083: WHAT ONE ITEM CONTAINS (Jon, 2026-09-10: "items should have customization of 1 = 5 pods").
-- pieces + piece_name describe one unit of the item in the guest's words: 1 = 5 pods, 1 = 12
-- bottles, 1 = 6 croissants. The guest orders items; the form shows what each one holds and how
-- many pieces a bundle adds up to. Not sold_in (a quantity rule) and not size (how big one is).
alter table guest_order_catalog
  add column if not exists pieces integer,
  add column if not exists piece_name text;
alter table guest_order_catalog drop constraint if exists guest_order_catalog_pieces_chk;
alter table guest_order_catalog add constraint guest_order_catalog_pieces_chk check (pieces is null or (pieces >= 1 and pieces <= 9999));
notify pgrst, 'reload schema';
