-- FF&E: photos on the pieces being replaced, and an editable checklist (Jon, 2026-08-11:
-- "if replacing add a photo, can we also have a tab where we can update it or add item").
--
-- PHOTOS. A line that says "replace the sofa" starts an argument with whoever is paying; a photo of
-- the sofa ends it. Stored in the same public audit-photos bucket the property audit already uses,
-- so there is one place photos live and one bucket to manage.
alter table ffe_answers add column if not exists photo_url text;

-- THE CHECKLIST BECOMES DATA. It shipped as a hardcoded list, which meant adding "coffee maker"
-- was a code change and a deploy. This table is an OVERLAY on the built-in list rather than a
-- replacement for it:
--   • a row with hidden = true and a built-in's (room, item_key) switches that built-in off
--   • a row with a new item_key adds an item to that room
--   • sort lets an added item sit where it belongs instead of always at the end
-- The built-in list stays in lib/ffe-checklist.ts as the floor, so an empty table means the
-- checklist still works exactly as designed and nothing has to be seeded.
create table if not exists ffe_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  room        text not null,                      -- room key: living, dining, office, master, ...
  item_key    text not null,                      -- slug; matches a built-in to hide it
  en          text,                               -- label; null on a hide-only row
  es          text,
  ask         text not null default 'replace',    -- replace | add | check
  hidden      boolean not null default false,
  sort        integer not null default 100,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (room, item_key)
);
create index if not exists ffe_checklist_room on ffe_checklist_items (room);
