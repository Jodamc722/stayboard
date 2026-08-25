-- GUEST ORDERS — HOW THE MONEY GETS COLLECTED (Jon, 2026-08-25).
--
-- Charge mode is manual for the Salato pilot: Lighthouse never touches the card. On approval we
-- look up what Guesty holds for the booking and post the charge to the folio, then record WHICH
-- of the two collection paths this booking needs, so the board can show one unambiguous action
-- instead of making whoever opens it go and find out:
--
--   card_on_file       a chargeable card is on the reservation → charge it in Guesty
--   payment_link       no card → send the guest a Guesty payment link (folio already carries it)
--   airbnb_resolution  Airbnb collects payment, there is never a card → Resolution Center
--
-- Nullable and unconstrained on purpose: an order approved before this migration simply has no
-- collection hint, and the board falls back to the payment note it already had.
alter table if exists public.guest_orders
  add column if not exists collect_method text,
  add column if not exists collect_card   text;

comment on column public.guest_orders.collect_method is
  'card_on_file | payment_link | airbnb_resolution — set on approval, drives the board''s collect panel';
comment on column public.guest_orders.collect_card is
  'Human label of the card Guesty holds, e.g. "Visa •••• 4242". Never a PAN, never a token.';

notify pgrst, 'reload schema';
