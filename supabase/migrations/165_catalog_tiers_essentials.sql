-- 165 — TIERS, ESSENTIALS AND PRESET ORDERS (Jon, 2026-10-27): "multiple suppliers it can search…
-- a complete catalog for our owners, and tiers, and preset orders, with swap options for onboarding.
-- Must-have, recommended and suggested sections." Furniture stays a complete catalog to choose from;
-- the sections and the preset order are for onboarding essentials (iron, pack n play, games…).
--
--   ffe_catalog_items.need     must | recommended | suggested; null = catalog only (furniture)
--   ffe_catalog_items.qty      how many …
--   ffe_catalog_items.qty_per  … per unit | bedroom | bathroom | guest (rounded up)
--   ffe_catalog_options.tier   standard | midlux | luxury; null = any tier
--
-- A preset onboarding order = every must-have, the recommended ones (on by default) and any
-- suggested ones switched on, each at the option for the chosen tier, quantities from the unit's
-- bedrooms / bathrooms / guests. The team can swap any line to another option of the same item.

alter table public.ffe_catalog_items add column if not exists need text;
alter table public.ffe_catalog_items add column if not exists qty numeric not null default 1;
alter table public.ffe_catalog_items add column if not exists qty_per text not null default 'unit';
alter table public.ffe_catalog_options add column if not exists tier text;

-- One live option per (item, supplier key): approvals are keyed by src, so two options sharing one
-- would be indistinguishable. addOption numbers a second option from a supplier (amz-2).
create unique index if not exists ffe_catalog_options_item_src on public.ffe_catalog_options (item_id, src) where archived_at is null;
