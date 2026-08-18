-- RECOMMENDATION TIERS + AI BRIEF ON ORDERS (Jon, 2026-08-18).
--
--   "Add a recommendation meaning: we recommend this, nice to have, need to replace. Use AI to
--    make it easier to digest — organized better, worded better."
--
-- THREE TIERS, NOT FIVE. An owner reading a 200-line order needs exactly one question answered per
-- line: how strongly are we telling you to buy this? 'must' (needs replacing — broken, stained,
-- missing), 'recommended' (we recommend — worn, dated, below standard), 'nice' (nice to have —
-- upgrade, not a defect). The tier is a TEAM STATEMENT: AI proposes it from the walk evidence, a
-- human can overrule it with one tap, and whatever is on the line when the order is sent is what
-- the owner sees. priority_reason keeps the one-line "why" so the owner never has to ask.
--
-- ai_brief is the order's cover note — an owner-readable summary organised by tier, written by the
-- model from the actual lines (never invented numbers; the totals are computed and handed to it).
-- Kept on the order row, not derived at read time, so the wording the owner saw is the wording
-- that stays on record.

alter table ffe_order_lines add column if not exists priority text;
alter table ffe_order_lines add column if not exists priority_reason text;
alter table ffe_orders add column if not exists ai_brief text;
