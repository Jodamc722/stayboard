-- TALKROUTE (2026-09-21). Jon: "add talkroute api into the webapp. This is how we call guests,
-- manage guest calls, and I think we can find a way to unify the inboxes/conversations" and
-- "instead of marking a call completed for welcome calls it should be able to know if a call was
-- completed to guest before checkin, track, see if someone picked up".
--
-- Talkroute cannot PLACE calls through its API — the team still dials from the Talkroute app — but
-- it reports every finished call (direction, number, duration, answered/missed/hangup) by webhook
-- and by a call-history endpoint, and it exposes SMS threads and voicemails. So the app WATCHES the
-- phone: three mirror tables here, and the welcome-call log gains the columns that say a call was
-- proven by the phone system rather than declared by a person.

-- Every call record Talkroute has told us about. `external_number` is the guest side, digits only
-- (E.164 without the plus) so it joins cleanly against a normalised reservation phone.
create table if not exists public.talkroute_calls (
  id                text primary key,
  direction         text not null,                 -- inbound | outbound
  call_at           timestamptz not null,
  external_number   text,                          -- the guest's number, digits only
  external_name     text,
  talkroute_number  text,                          -- our virtual number, digits only
  duration          integer not null default 0,    -- seconds
  result            text,                          -- answered | missed | hangup
  recorded          boolean not null default false,
  voicemail         boolean not null default false, -- a voicemail event appeared on the call
  events            jsonb,
  reservation_id    text,                          -- matched booking, if any
  match_kind        text,                          -- welcome | post_checkout | stay | null
  matched_at        timestamptz,
  raw               jsonb,
  synced_at         timestamptz not null default now()
);
create index if not exists talkroute_calls_at_idx  on public.talkroute_calls (call_at desc);
create index if not exists talkroute_calls_num_idx on public.talkroute_calls (external_number, call_at desc);
create index if not exists talkroute_calls_res_idx on public.talkroute_calls (reservation_id);
alter table public.talkroute_calls enable row level security;

-- SMS threads. One row per Talkroute conversation (our number <-> their number).
create table if not exists public.talkroute_conversations (
  id                   text primary key,           -- Talkroute conversationId: <ourNumber>-<theirNumber>
  talkroute_number     text,
  contact_number       text,                       -- digits only
  last_message_at      timestamptz,
  last_message_preview text,
  last_direction       text,                       -- incoming | outgoing
  messages_count       integer not null default 0,
  unread               boolean not null default false,
  reservation_id       text,
  guest_name           text,
  listing_id           text,
  raw                  jsonb,
  synced_at            timestamptz not null default now()
);
create index if not exists talkroute_convos_last_idx on public.talkroute_conversations (last_message_at desc);
create index if not exists talkroute_convos_num_idx  on public.talkroute_conversations (contact_number);
alter table public.talkroute_conversations enable row level security;

create table if not exists public.talkroute_texts (
  id               text primary key,
  conversation_id  text not null,
  direction        text,                           -- incoming | outgoing
  body             text,
  user_email       text,                           -- the teammate who sent an outgoing text
  read             boolean not null default false,
  sent_at          timestamptz,
  attachments      jsonb,
  raw              jsonb,
  synced_at        timestamptz not null default now()
);
create index if not exists talkroute_texts_convo_idx on public.talkroute_texts (conversation_id, sent_at);
alter table public.talkroute_texts enable row level security;

create table if not exists public.talkroute_voicemails (
  id               text primary key,
  mailbox_id       text,
  talkroute_number text,
  caller_number    text,                           -- digits only
  caller_name      text,
  duration         integer not null default 0,
  transcript       text,
  transcribing     boolean not null default false,
  audio_link       text,
  call_result      text,
  read             boolean not null default false,
  created_at       timestamptz,
  reservation_id   text,
  raw              jsonb,
  synced_at        timestamptz not null default now()
);
create index if not exists talkroute_vm_at_idx  on public.talkroute_voicemails (created_at desc);
create index if not exists talkroute_vm_num_idx on public.talkroute_voicemails (caller_number);
alter table public.talkroute_voicemails enable row level security;

-- The call log learns where an outcome came from. `source` = 'talkroute' means the phone system
-- proved it; 'manual' (or null, for older rows) means a person clicked it.
alter table public.guest_calls add column if not exists source            text;
alter table public.guest_calls add column if not exists talkroute_call_id text;
alter table public.guest_calls add column if not exists last_attempt_at   timestamptz;
alter table public.guest_calls add column if not exists last_result       text;   -- answered | missed | hangup
alter table public.guest_calls add column if not exists talk_seconds      integer;

notify pgrst, 'reload schema';
