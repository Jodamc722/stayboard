-- ONBOARDING: expected counts + the buy list becomes an order (Jon, 2026-09-02).
--
-- "It should account for: if we count 10 but need 12 it should create an order and push."
--
-- `expected` is the count the inventory standard says a unit of this occupancy holds (forks at
-- 2× occupancy, water glasses at occupancy + 4…). `qty` stays the walker's count. The gap — plus
-- anything marked worn or missing — is the buy list, and the buy list is written to ffe_orders /
-- ffe_order_lines (migration 034) so it lands on the FF&E Orders board (/ffe → Orders, detail at /ffe/order/<id>) with every other order.
-- `order_id` remembers which order this unit's buy list went to, so re-running adds lines to the
-- same draft instead of minting a second order.

alter table public.onboarding_items add column if not exists expected int;
alter table public.onboarding_units add column if not exists order_id uuid;

-- Items generated before this migration: what they were pre-filled with IS the expected count.
update public.onboarding_items set expected = qty where expected is null and suggested = true;

notify pgrst, 'reload schema';
