-- 077 — HOW BIG IS ONE (Jon, 2026-09-10: "we need to put the oz, mL size options").
--
-- `unit_label` already says how it is packaged ("case of 12"); this says how much is IN one, which
-- is a different fact and the one a guest actually compares on: 500 mL vs 330 mL. Kept as a number
-- plus a unit rather than free text so the board can divide by it — cost per 100 mL is how you
-- tell two suppliers apart, and you cannot divide by "500ml-ish".
alter table guest_order_catalog add column if not exists size_value numeric(10,2);
alter table guest_order_catalog add column if not exists size_unit  text;

comment on column guest_order_catalog.size_value is 'How much is in ONE unit (500 for a 500 mL bottle). Not the pack size.';
comment on column guest_order_catalog.size_unit  is 'mL | L | fl oz | oz | g | kg | ct';
