-- THE LEADERSHIP BOARD, STANDALONE (Jon, 2026-11-06: "I don't want it to be in projects, just its
-- own standalone board. I want to get rid of projects completely and just use this board. Simple,
-- clean, everyone's tasks can live here, can filter by due date, owner, property etc.").
--
-- One flat table. A row is one thing someone owes: a lane, a title, who, when, where. Comments
-- live in app_comments (entity_type 'board') so they show in Messages like every other comment;
-- photos get their own small table. Nothing here touches the project_* tables — those stay in
-- place, dormant, and their open tasks can be imported once from the board itself.

create table if not exists board_items (
  id           uuid primary key default gen_random_uuid(),
  lane         text not null default 'Tasks',          -- Projects | Tasks | Vendor follow-ups | Misc
  title        text not null,
  details      text,
  status       text not null default 'open',           -- open | done
  priority     text not null default 'normal',         -- low | normal | high | urgent
  due_on       date,
  property     text,                                   -- building label (lib/segments KNOWN_BUILDINGS) or free text
  vendor       text,                                   -- who we are waiting on (vendor follow-ups)
  assignees    text[] not null default '{}',           -- Lighthouse emails
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  done_at      timestamptz,
  done_by      text,
  source       text,                                   -- manual | notes | project
  source_ref   text,                                   -- 'project_step:<id>' on an import, so it never imports twice
  reminded_on  date                                    -- the last morning the assignees were reminded
);
create unique index if not exists board_items_source_ref_idx on board_items (source_ref) where source_ref is not null;
create index if not exists board_items_open_idx on board_items (status, due_on);

create table if not exists board_photos (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references board_items(id) on delete cascade,
  url          text not null,
  caption      text,
  uploaded_by  text,
  created_at   timestamptz not null default now()
);
create index if not exists board_photos_item_idx on board_photos (item_id);
