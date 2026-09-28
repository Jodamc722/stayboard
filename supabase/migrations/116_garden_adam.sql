-- ADAM — the Garden Hotel's own agent (Jon, 2026-09-28: "a different learning model, a different
-- section we can call him Adam" / "think new business, new model"). Nothing here is shared with
-- Eve: his memory and his chat log are hotel tables, so what he learns about the hotel never leaks
-- into the VR brain and vice versa.

create table if not exists garden_agent_memory (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'fact',      -- fact | rule | preference | person | correction
  subject     text,                              -- what it is about: a room, a guest, a vendor, 'hotel'
  content     text not null,
  source      text not null default 'chat',      -- chat | jon | sync | correction
  by_email    text,
  confidence  numeric not null default 0.8,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists garden_agent_memory_active on garden_agent_memory (active, kind);

create table if not exists garden_agent_chats (
  id          uuid primary key default gen_random_uuid(),
  email       text,
  question    text not null,
  reply       text,
  tools       jsonb,
  model       text,
  usage       jsonb,
  rating      int,                               -- 1 good, -1 wrong
  note        text,                              -- the correction when rated wrong
  created_at  timestamptz not null default now()
);
create index if not exists garden_agent_chats_at on garden_agent_chats (created_at desc);
