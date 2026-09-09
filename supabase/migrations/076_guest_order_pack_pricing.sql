-- PACK COST + VOLUME PRICING (Jon, 2026-09-09): "We need to be able to get the cost for the pack
-- and sell them as individual items, or sell multiple items at a discounted rate. We need that
-- functionality in the form builder."
--
-- Two separate ideas that were both missing, and they are NOT the same thing:
--
--   BUYING  — we buy a CASE. Cost is per case; the shelf, the guest and the margin are all per
--             UNIT. `pack_size` + `pack_cost_usd` let the builder hold the number we actually pay
--             (a 24-case of water for $11.88) and derive the per-unit cost (49.5c) rather than
--             asking anyone to do that division by hand and get it wrong.
--             `cost_usd` stays as the per-unit override for anything not bought by the case.
--
--   SELLING — "or sell multiple items at a discounted rate". `tiers` is a price break by quantity
--             on the SAME item: [{"min_qty":3,"unit_price_usd":2.50}] means 1–2 at the headline
--             price, 3 or more at $2.50 each. Highest qualifying tier wins. Empty/absent = flat
--             price, which is exactly today's behaviour, so nothing changes until someone sets one.
--
-- Deliberately NOT modelled: a mixed bundle (pick any 5 snacks for $12). That needs a basket-level
-- rule and a different UI; per-item breaks cover "buy the case, sell singles or a discounted
-- multi-pack", which is what was asked for.
alter table public.guest_order_catalog add column if not exists pack_size      integer;
alter table public.guest_order_catalog add column if not exists pack_cost_usd  numeric(10,2);
alter table public.guest_order_catalog add column if not exists tiers          jsonb;

comment on column public.guest_order_catalog.pack_size     is 'Units in one purchased pack/case. With pack_cost_usd this derives the per-unit cost.';
comment on column public.guest_order_catalog.pack_cost_usd is 'What WE pay for one pack. Never guest-facing.';
comment on column public.guest_order_catalog.tiers         is 'Volume price breaks on this item: [{"min_qty":3,"unit_price_usd":2.50}]. Highest qualifying min_qty wins.';

notify pgrst, 'reload schema';
