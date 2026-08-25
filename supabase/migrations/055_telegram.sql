-- ---------------------------------------------------------------------------------------------
-- Eve on Telegram — the bridge, and the gate in front of it.
--
-- Jon, 2026-08-25: "add eve to telegram so i can ask questions directly there, it should have an
-- approve the contact feature, i want to be able to have a group chat with other rev bots."
--
-- THE WHOLE SECURITY MODEL IN ONE PARAGRAPH. A Telegram chat id is not a person. Anyone who finds
-- the bot's @handle can message it, and anyone can add it to any group. So nothing here is trusted
-- by default: an unknown sender gets ONE polite refusal and a row in `telegram_contacts` with
-- status='pending'. Eve answers nobody until a human opens Lighthouse and approves that row — and
-- approving means CHOOSING WHICH LIGHTHOUSE USER the contact acts as, so every answer inherits that
-- person's role levels and their money permission. There is no Telegram-only permission tier to get
-- out of sync with /users, and no way to become someone you are not by editing your Telegram name.
--
-- WHY APPROVAL IS NOT IN TELEGRAM. Same rule the guest-orders build landed on the hard way: the
-- approval lives in the app, the chat is only a notice. A tap in a messenger is too cheap, too easy
-- to forge with a forwarded link, and impossible to audit. Nothing that arrives over Telegram can
-- grant Telegram access.
--
-- ROOMS ARE APPROVED SEPARATELY FROM PEOPLE. In a group, BOTH must be approved: the room (so the
-- bot cannot be dragged into a chat nobody vetted) and the speaker (so permissions follow the human
-- who typed, not the room). That is also what makes the future rev-bot room safe — the room is
-- approved once, and each person in it still answers to their own Lighthouse role.
-- ---------------------------------------------------------------------------------------------

-- ---- People ---------------------------------------------------------------------------------
create table if not exists telegram_contacts (
  id            uuid primary key default gen_random_uuid(),
  tg_user_id    text not null unique,               -- Telegram's numeric user id, as text
  username      text,                               -- @handle, may be absent and may change
  first_name    text,
  last_name     text,
  status        text not null default 'pending',    -- pending | approved | blocked
  email         text,                               -- app_users.email this contact acts as
  dm_chat_id    text,                               -- their 1:1 chat with the bot
  first_message text,                               -- what they said when they turned up
  note          text,
  approved_by   text,
  approved_at   timestamptz,
  blocked_by    text,
  blocked_at    timestamptz,
  msg_count     integer not null default 0,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists telegram_contacts_status_idx on telegram_contacts (status, updated_at desc);
create index if not exists telegram_contacts_email_idx  on telegram_contacts (email);

-- ---- Rooms (groups, supergroups) -------------------------------------------------------------
create table if not exists telegram_rooms (
  id            uuid primary key default gen_random_uuid(),
  chat_id       text not null unique,               -- negative for groups
  title         text,
  kind          text not null default 'group',      -- group | supergroup | channel
  status        text not null default 'pending',    -- pending | approved | blocked
  added_by      text,                               -- tg user id of whoever added the bot
  added_by_name text,
  approved_by   text,
  approved_at   timestamptz,
  msg_count     integer not null default 0,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists telegram_rooms_status_idx on telegram_rooms (status, updated_at desc);

-- ---- Replay guard ----------------------------------------------------------------------------
-- Telegram redelivers an update if the webhook does not answer 200 quickly enough, and Eve can take
-- half a minute to think. Without this a slow answer becomes two answers and two API bills. The
-- primary key IS the lock: the insert either wins or the update was already claimed.
create table if not exists telegram_updates (
  update_id   bigint primary key,
  chat_id     text,
  received_at timestamptz not null default now()
);
create index if not exists telegram_updates_received_idx on telegram_updates (received_at desc);

-- ---- Conversation thread ----------------------------------------------------------------------
-- Eve's web chat keeps the thread in the browser. Telegram has no such thing, so the last few turns
-- per chat live here — that is what makes "and what about 3707?" work as a follow-up. Deliberately
-- short-lived: a thread is only continued when the previous message is recent (see lib/telegram-eve).
create table if not exists telegram_messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    text not null,
  tg_user_id text,
  role       text not null,                          -- user | assistant
  text       text not null default '',
  eve_chat_id uuid,                                  -- the eve_chats row, when this was an answer
  created_at timestamptz not null default now()
);
create index if not exists telegram_messages_chat_idx on telegram_messages (chat_id, created_at desc);

-- ---- Where an exchange happened ----------------------------------------------------------------
-- Every Eve conversation already lands in eve_chats; until now they were all the web workspace, so
-- nothing recorded the surface. The learning loop and the quality reviews read this table, and
-- "she was terse and got it wrong" means something different on a phone than at a desk.
alter table eve_chats add column if not exists source text not null default 'web';
create index if not exists eve_chats_source_idx on eve_chats (source, created_at desc);

alter table telegram_contacts enable row level security;
alter table telegram_rooms    enable row level security;
alter table telegram_updates  enable row level security;
alter table telegram_messages enable row level security;
-- No policies on purpose: every read and write goes through the service role in server code. RLS on
-- with zero policies means the anon key cannot read a single row — and these tables hold the map
-- from a Telegram handle to a Lighthouse identity, which is exactly what an attacker would want.
