-- 164 — OWNER SELECTION AND ORDERING (Jon, 2026-10-27): "build a catalog in general; once an owner
-- selects, it builds a custom catalog for the owner that we can order from in the future".
--
-- The share link gets a MODE. 'view' (the default so far) shows the approved list read-only.
-- 'select' lets the owner choose from the options on the link: each choice is saved as the
-- approval for that item, flagged owner_picked, so the team sees what the owner chose. Switch the
-- link back to 'view' when the selection is done and the link becomes their replacement list.
-- A catalog also remembers its owner, so an order can be raised from the approved list.

alter table public.ffe_catalog_shares add column if not exists mode text not null default 'view';   -- view | select
alter table public.ffe_approved_decisions add column if not exists owner_picked boolean not null default false;
alter table public.ffe_catalogs add column if not exists owner_id text;
alter table public.ffe_catalogs add column if not exists owner_name text;
