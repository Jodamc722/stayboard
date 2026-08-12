-- FF&E AUDIT — furniture, fixtures and equipment. Deliberately apart from maintenance.
--
-- Jon, 2026-08-10: "make this FFE order not Maintenance or anything else."
--
-- An earlier draft of this feature stored answers in audit_items, which is the table the Audit Desk
-- dispatches into BREEZEWAY as maintenance tasks. "Replace the nightstands" would have become work
-- orders and landed in maintenance cost and billing. This is a PURCHASING list — what furniture to
-- order — so it owns its storage and has no foreign key to anything in the task world.
--
-- ONE TABLE, NOT TWO. Jon, 2026-08-11: "it should not create a link, it should be created
-- automatically." Share codes are now derived from the listing id (lib/ffe-links, HMAC), so there
-- is no per-unit parent row to create and nothing to mint — a unit is linkable the moment it
-- exists. The only thing worth storing is the answers.

create table if not exists ffe_answers (
  id          uuid primary key default gen_random_uuid(),
  listing_id  text not null,
  room        text not null,                     -- checklist room key, e.g. 'living', 'master'
  item_key    text not null,                     -- checklist item key, e.g. 'nightstands'
  title       text,                              -- English label as shown, so exports read plainly
  answer      text not null,                     -- replace | add | keep | na
  qty         integer not null default 1,
  note        text,
  updated_at  timestamptz not null default now(),
  -- One answer per item per unit. Re-walking a unit overwrites rather than accumulating, which is
  -- what anyone reading the list expects: the current state of that piece, not its history.
  unique (listing_id, room, item_key)
);
create index if not exists ffe_answers_listing on ffe_answers (listing_id);
create index if not exists ffe_answers_answer  on ffe_answers (answer);

-- Marking a unit finished is a statement by a person, separate from "every row has a value" —
-- a walker may legitimately leave items blank and still be done.
create table if not exists ffe_unit_status (
  listing_id   text primary key,
  completed_at timestamptz,
  completed_by text,
  updated_at   timestamptz not null default now()
);

-- Clean-up: this feature briefly wrote into the shared audit tables. Remove anything it left there
-- so no FF&E row can ever be dispatched as a maintenance task. Harmless if it never ran.
delete from audit_items where kind = 'ffe';
delete from property_audits where audit_type = 'ffe';
