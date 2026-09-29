-- FILE UPLOADS FOR ADAM AND EVE (Jon, 2026-09-29: "Adam and Eve should have file upload feature,
-- where we can upload items for learning or reference for handbooks, SOPs, etc."). The original
-- is kept in the private agent-files storage bucket; the text is filed, chunked and searched.

-- Eve's library remembers which file a document came from.
alter table eve_docs add column if not exists file_path text;
-- A handbook entry can be filled from a file.
alter table garden_handbook add column if not exists file_path text;

-- Adam's own library — separate from Eve's by design.
create table if not exists garden_agent_docs (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text not null default 'sop',          -- handbook | sop | policy | reference | training
  source      text,                                 -- original filename
  file_path   text,                                 -- agent-files/<adam>/…
  body        text not null default '',
  words       int  not null default 0,
  learned     int  not null default 0,              -- memories Adam took from it
  active      boolean not null default true,
  added_by    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists garden_agent_doc_chunks (
  id       uuid primary key default gen_random_uuid(),
  doc_id   uuid not null references garden_agent_docs (id) on delete cascade,
  idx      int not null default 0,
  heading  text,
  text     text not null default ''
);
create index if not exists garden_agent_doc_chunks_doc on garden_agent_doc_chunks (doc_id, idx);
alter table garden_agent_docs enable row level security;
alter table garden_agent_doc_chunks enable row level security;
