-- ONE VENDOR, EVERY BOARD (Jon, 2026-09-24).
--
--   "if you select vendor maybe then opens up vendor info, add or select if a recurring vendor we
--    use regularly, etc. think through how this all interacts with all our process and boards"
--
-- The directory already exists (`vendors`, 062 + 087) and the project board already picks from it
-- (088). What was missing:
--   1. "a recurring vendor we use regularly" — a fact about the VENDOR, not about one job. `regular`
--      pins them to the top of every picker and badges them; `cadence` is the rhythm we expect
--      them on ("monthly", "quarterly") so the card can say "last visit 41 days ago — overdue".
--   2. Glitches and requests named vendors as free text or not at all, so a vendor's history
--      stopped at the project board. Both now carry vendor_key next to the name they already had
--      (the name stays as a snapshot — a rename must not rewrite a closed glitch).
alter table vendors add column if not exists regular boolean not null default false;
alter table vendors add column if not exists cadence text;   -- 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | null

alter table glitches add column if not exists vendor_key  text references vendors(key) on delete set null;
alter table glitches add column if not exists vendor_name text;
create index if not exists glitches_vendor_idx on glitches (vendor_key) where vendor_key is not null;

alter table field_requests add column if not exists vendor_key text references vendors(key) on delete set null;
create index if not exists field_requests_vendor_idx on field_requests (vendor_key) where vendor_key is not null;
