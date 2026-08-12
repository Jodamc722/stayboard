-- FF&E AUDIT — furniture, fixtures and equipment, kept deliberately apart from maintenance.
--
-- Jon, 2026-08-10: "make this FFE order not Maintenance or anything else."
--
-- The first cut of this reused property_audits + audit_items because they already had a share-code
-- link and needed no migration. That was wrong: audit_items is what the Audit Desk dispatches into
-- BREEZEWAY as maintenance tasks. An FF&E walk saying "replace the nightstands" would have turned
-- into maintenance tickets and landed in the maintenance cost and billing numbers. This is a
-- PURCHASING list — what furniture to order — and it must never touch the work-order pipeline.
--
-- So: its own two tables, no foreign key to anything in the audit or task world, and nothing in the
-- app reads them except the FF&E pages.

create table if not exists ffe_audits (
  id          uuid primary key default gen_random_uuid(),
  listing_id  text not null,
  -- The link IS the key, same pattern as the audit and vendor share pages. One per unit and stable
  -- forever, so a link handed to a walker last month still opens the same unit today.
  share_code  text not null unique,
  status      text not null default 'open',      -- open | submitted
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists ffe_audits_listing_uniq on ffe_audits (listing_id);

create table if not exists ffe_answers (
  id          uuid primary key default gen_random_uuid(),
  audit_id    uuid not null references ffe_audits (id) on delete cascade,
  listing_id  text not null,
  room        text not null,                     -- checklist room key, e.g. 'living', 'master'
  item_key    text not null,                     -- checklist item key, e.g. 'nightstands'
  title       text,                              -- the English label as shown, for readable exports
  answer      text not null,                     -- replace | add | keep | na
  qty         integer not null default 1,
  note        text,
  updated_at  timestamptz not null default now(),
  -- One answer per item per unit. Re-walking a unit overwrites rather than accumulating, which is
  -- what anyone reading the list expects: the current state of that piece, not its history.
  unique (audit_id, room, item_key)
);
create index if not exists ffe_answers_listing on ffe_answers (listing_id);
create index if not exists ffe_answers_order on ffe_answers (answer);
