-- EVE CONVERSATIONS (Jon, 2026-11-05: "EVE chat needs to be a learning chat, where we can teach Eve").
-- The chat on /eve keeps its threads on the server: one row per conversation (title = the first
-- question), and every eve_chats turn points at the conversation it belongs to. The floating bubble
-- writes to the same store, so a thread started on a phone can be resumed on /eve.
-- Safe to run twice. Until it runs, the app works as before and simply shows no past conversations.
create table if not exists eve_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_email  text,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists eve_conversations_user_idx on eve_conversations (user_email, updated_at desc);
alter table eve_conversations enable row level security;

alter table eve_chats add column if not exists conversation_id uuid references eve_conversations(id) on delete set null;
create index if not exists eve_chats_conversation_idx on eve_chats (conversation_id, created_at);
