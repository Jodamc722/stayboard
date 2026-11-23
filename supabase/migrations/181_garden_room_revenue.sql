-- ROOM REVENUE BEFORE TAXES AND FEES (Jon, 2026-11-23: "make sure this is super accurate").
--
-- garden_reservations.total is Cloudbeds' reservation total. Revenue, ADR and RevPAR for a revenue
-- team are read before taxes and fees, so the sync now also keeps Cloudbeds' own room subtotal
-- (getReservationsWithRateDetails: balanceDetailed.subTotal, else the nightly rates added up) and the
-- taxes and fees beside it. Both are nullable: until a reservation has been re-read the reports fall
-- back to the total and say how many stays are on which figure (lib/garden/segments `basis`).
-- Additive and re-runnable; nothing reads these columns before lib/garden/segments hasRoomRevenue() sees them.
alter table public.garden_reservations add column if not exists room_revenue numeric;
alter table public.garden_reservations add column if not exists taxes_fees numeric;
