-- GUEST ORDER INVENTORY — WHAT A THING COSTS US AND WHERE WE BUY IT AGAIN (Jon, 2026-08-25:
-- "need to be edit by hub, adjust cost, have the order links for easy ordering… be able to add
-- photos of the items for reference").
--
-- The catalog already knows the GUEST price. Restocking needs three more facts that were living in
-- someone's head: what we pay, who we buy it from, and the link that puts it in a basket. Without
-- the link, "bottled water is out at Salato" is a task; with it, it is a click.
--
-- Nullable throughout: an item with no cost simply shows no margin, and one with no link shows no
-- Order button. Nothing here is guest-facing — none of it is ever sent to Guesty or shown on the
-- order form.
alter table if exists public.guest_order_catalog
  add column if not exists cost_usd    numeric(10,2),
  add column if not exists reorder_url text,
  add column if not exists supplier    text,
  add column if not exists pack_note   text;

comment on column public.guest_order_catalog.cost_usd is
  'What WE pay per unit. Guest price is price_usd; the gap is the margin shown in Inventory.';
comment on column public.guest_order_catalog.reorder_url is
  'Where to buy this again — the Order button in Inventory. http(s) only, opened in a new tab.';
comment on column public.guest_order_catalog.supplier is 'Free text: who we buy it from.';
comment on column public.guest_order_catalog.pack_note is
  'How it arrives when reordered, e.g. "case of 24" — the unit we count is unit_label, not this.';

notify pgrst, 'reload schema';
