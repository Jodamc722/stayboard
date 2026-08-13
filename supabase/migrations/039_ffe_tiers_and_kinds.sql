-- TIERS AND KINDS ON THE CATALOG (Jon, 2026-08-13).
--
--   "be cool if you can help build a catalog on the settings, where we can do it, think through
--    different tiers 1, tier 2, tier 3 and custom. Also have in each of these tabs, Amenities, etc
--    that we kind of already have."
--
-- TWO AXES, NOT ONE. A catalog for a portfolio like this is not a flat list:
--
--   KIND is what sort of thing it is — furniture, an amenity, linen, a supply. These are bought by
--   different people on different cycles from different suppliers. A coffee maker and a sofa do not
--   belong in the same buying decision, and the walk already treats them differently.
--
--   TIER is how good a version of it we are buying. Tier 1 / 2 / 3 is the same product role at three
--   price points — the studio in a B building and the penthouse both need a nightstand, and the
--   whole argument with an owner is which one. Holding all three in the catalog means the answer to
--   "what would Tier 2 cost instead" is a filter rather than a week of re-quoting. CUSTOM is the
--   fourth on purpose: the one-off a designer specified for one building, which must not silently
--   become the default for everyone else.
--
-- Existing products default to furniture / tier 2 — the middle is the honest guess for a product
-- somebody added before tiers existed, and it is visible and changeable rather than null.

alter table ffe_catalog add column if not exists tier text not null default 'tier2';
alter table ffe_catalog add column if not exists kind text not null default 'furniture';

create index if not exists ffe_catalog_tier on ffe_catalog (tier);
create index if not exists ffe_catalog_kind on ffe_catalog (kind);
