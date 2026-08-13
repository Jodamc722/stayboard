-- THE REPLACEMENT ITSELF, AND THE SHEET FOR WHOEVER UNPACKS IT (Jon, 2026-08-13).
--
--   "Can we add links and make sure it works. We should be able to attach photos of the replacement,
--    estimated cost to replace, etc. And create work orders report, as items come in per unit.
--    Here what goes in unit and here where it goes."
--
-- TWO HALVES OF THE SAME GAP.
--
-- 1. THE WALK ONLY DESCRIBED THE PROBLEM. It could say "replace the nightstands, here is a photo of
--    the old ones" but had nowhere to put the ANSWER: this is the one we are buying, here is the
--    link, here is what it looks like, here is roughly what it costs. That is the information the
--    owner needs to say yes and the buyer needs to place the order, and it was being carried in
--    somebody's texts. Three columns, captured in the unit where the decision is actually made.
--
--    photo_url stays what it always was — the piece being REPLACED. replacement_photo is the new
--    one. Keeping them apart matters: an owner looking at a quote should see what they are buying,
--    and a person arguing about whether it needed replacing should see what was there.
--
-- 2. THE INSTALL HAD NO PAPER. Boxes arrive at a building, and the person carrying them upstairs
--    needs one sheet per unit: what goes in this unit, and where each piece goes. That is generated
--    from the order lines rather than stored, so it cannot drift — see fmt=workorder in
--    app/api/audit/ffe/orders/export. What it needs from the database is only the received date,
--    so a sheet printed on Tuesday can show what actually turned up.

alter table ffe_answers add column if not exists replacement_url   text;
alter table ffe_answers add column if not exists replacement_photo text;
alter table ffe_answers add column if not exists est_cost          numeric(12,2);

-- Carried onto the line so a quote and a work order keep the walker's own research even when
-- nobody has picked a catalog product for it yet.
alter table ffe_order_lines add column if not exists received_at timestamptz;
alter table ffe_order_lines add column if not exists received_by text;
