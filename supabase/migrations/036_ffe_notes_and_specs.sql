-- NOTES, MEASUREMENTS AND SPECS on the FF&E walk (Jon, 2026-08-12).
--
-- Two gaps the shared checklist made obvious, both of which were sending unbuyable lines to a vendor.
--
-- 1. NOTES & MEASUREMENTS. The sheet ends with a "Notes & Measurements / Notas y Medidas" section,
--    and one of its required actions is "Measure each living room before ordering the area rug.
--    Record length x width." There was nowhere on the form to write that, so the measurement the rug
--    order depends on lived in somebody's phone or nowhere.
--
-- 2. SPEC — "for carpets, how big etc, TV size etc, TV stand / mount etc" (Jon, same day).
--    "Area rug x1" is not an order. 9x12 or 8x10 is a different rug, a different price and a
--    different room. 55-inch or 65-inch is a different TV. Stand or wall mount is a different
--    purchase entirely. The spec rides from the walk answer onto the order line, so the number the
--    walker recorded standing in the room is the number the vendor is sent.
--
-- Free text with suggested choices rather than an enum per item type: the sizes change, the rooms
-- do not all fit the sizes, and a schema that refuses "9x12, but measure again — the column eats a
-- foot" is a schema that gets bypassed with a note.

alter table ffe_unit_status add column if not exists notes text;
alter table ffe_answers     add column if not exists spec text;
alter table ffe_order_lines add column if not exists spec text;
