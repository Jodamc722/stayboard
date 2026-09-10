-- OFFERS (Jon, 2026-09-10): "pricing, bulk pricing add on, if they spend xx amount can get 5% total,
-- all customizable. New offers, limited inventory things like that to promote or entice. If we
-- discount item should show discounted."
--
-- Three separate ideas, and they are kept separate on purpose:
--
--   · sale_price_usd — THIS ITEM is on offer. The list price stays in price_usd so the guest can see
--     what it was; a discount nobody can see is not a discount, it is just a lower price.
--   · badge — a short word on the card: New, Limited, Last few. Promotion, not pricing.
--   · the ORDER-level threshold ("spend $75, save 5%") lives in app_settings.guest_orders, because it
--     is a rule about a basket rather than a fact about an item.
--
-- discount_usd is stored on the order so the folio, the email and the board all agree on one number
-- rather than each re-deriving it from a rule that may have changed since.
alter table guest_order_catalog add column if not exists sale_price_usd numeric(10,2);
alter table guest_order_catalog add column if not exists badge text;

alter table guest_orders add column if not exists discount_usd  numeric(10,2) not null default 0;
alter table guest_orders add column if not exists discount_note text;

comment on column guest_order_catalog.sale_price_usd is 'On-offer price. price_usd stays as the "was" price the guest sees struck through.';
comment on column guest_order_catalog.badge is 'Short promo word on the card: New | Limited | Last few | Popular.';
comment on column guest_orders.discount_usd is 'Order-level spend-threshold discount actually applied, in dollars.';
notify pgrst, 'reload schema';
