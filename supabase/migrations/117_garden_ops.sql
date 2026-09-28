-- THE GARDEN HOTEL, PART 3 — the operating backend (Jon, 2026-09-28: "the garden will do: welcome
-- calls, triggers, better settings… scheduler, owner reports, review management. Create all the
-- backend for that… build all the backend connection tools" for the phone system).
--
-- Plus access: "only specific users will get access to the Garden drop-down… hand-selected. For
-- now it should only be me." Roles no longer grant 'garden' (lib/features HAND_PICKED); a person
-- gets it on /users → Edit access. Jon is the superadmin and always has it.
update app_roles set perms = perms - 'garden' where perms ? 'garden';

-- 1) Staff and shifts — the hotel's own people (some hybrid with the VR team, linked by email).
create table if not exists garden_staff (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  role        text not null default 'housekeeping',   -- frontdesk | housekeeping | maintenance | manager
  phone       text,
  email       text,                                   -- a Lighthouse login when hybrid
  active      boolean not null default true,
  note        text,
  created_at  timestamptz not null default now()
);
create table if not exists garden_shifts (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  staff_id    uuid references garden_staff (id) on delete cascade,
  role        text not null,
  start_time  text not null default '08:00',
  end_time    text not null default '16:00',
  rooms       text[] not null default '{}',
  note        text,
  source      text not null default 'manual',         -- manual | suggested
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists garden_shifts_date on garden_shifts (date);

-- 2) The call queue — what the desk owes each guest and when (welcome, pre-arrival, verification,
--    post-stay, review ask). garden_calls stays the log of attempts; this is the to-do.
create table if not exists garden_call_queue (
  id             uuid primary key default gen_random_uuid(),
  reservation_id text references garden_reservations (id) on delete cascade,
  kind           text not null default 'welcome',     -- welcome | pre_arrival | verification | post_stay | review_ask
  due_at         timestamptz not null,
  window_end     timestamptz,
  status         text not null default 'pending',     -- pending | done | skipped | expired
  attempts       int not null default 0,
  last_outcome   text,
  last_attempt_at timestamptz,
  assigned_to    text,
  script         jsonb,
  note           text,
  done_at        timestamptz,
  done_by        text,
  created_at     timestamptz not null default now(),
  unique (reservation_id, kind)
);
create index if not exists garden_call_queue_due on garden_call_queue (status, due_at);

-- 3) Triggers — "when X happens, do Y", editable, with a log. The event inbox feeds them.
create table if not exists garden_events (
  id          uuid primary key default gen_random_uuid(),
  event       text not null,                          -- reservation_created | reservation_changed | reservation_cancelled | checked_in | checked_out | arrival_tomorrow | departure_today | room_dirty | review_received | call_missed | task_done
  subject_id  text,
  payload     jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now(),
  processed   boolean not null default false
);
create index if not exists garden_events_todo on garden_events (processed, at);
create table if not exists garden_triggers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  event       text not null,
  conditions  jsonb not null default '{}'::jsonb,     -- { source_in: [], nights_min, nights_max, balance_gt, room_type_in: [], rating_max, kind_in: [] }
  action      text not null,                          -- queue_call | create_task | slack_post | adam_note | mark_verification | draft_review_reply
  params      jsonb not null default '{}'::jsonb,
  enabled     boolean not null default true,
  sort        int not null default 100,
  fired_count int not null default 0,
  last_fired_at timestamptz,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists garden_trigger_log (
  id          uuid primary key default gen_random_uuid(),
  trigger_id  uuid references garden_triggers (id) on delete set null,
  trigger_name text,
  event       text not null,
  subject_id  text,
  result      text not null,                          -- fired | skipped | failed
  detail      jsonb,
  at          timestamptz not null default now()
);
create index if not exists garden_trigger_log_at on garden_trigger_log (at desc);

-- 4) Reviews — every source in one table, with the reply workflow.
create table if not exists garden_reviews (
  id             text primary key,                    -- source:externalId
  source         text not null,                       -- google | booking | expedia | tripadvisor | airbnb | cloudbeds | manual
  external_id    text,
  reservation_id text references garden_reservations (id) on delete set null,
  guest_name     text,
  rating         numeric,
  max_rating     numeric not null default 5,
  title          text,
  body           text,
  language       text,
  received_at    timestamptz not null default now(),
  sentiment      text,                                -- positive | mixed | negative
  themes         text[] not null default '{}',
  reply_status   text not null default 'none',        -- none | drafted | approved | sent | skipped
  reply_draft    text,
  reply          text,
  replied_at     timestamptz,
  replied_by     text,
  raw            jsonb,
  synced_at      timestamptz not null default now()
);
create index if not exists garden_reviews_at on garden_reviews (received_at desc);

-- 5) Owner reports — one per period, built from the hotel tables, shareable.
create table if not exists garden_owner_reports (
  id          uuid primary key default gen_random_uuid(),
  period      text not null unique,                   -- YYYY-MM
  title       text,
  status      text not null default 'draft',          -- draft | final | sent
  data        jsonb not null default '{}'::jsonb,
  narrative   text,
  share_code  text unique,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  sent_at     timestamptz
);

-- 6) Phone calls — whatever system the hotel ends up on, mirrored here in one shape.
create table if not exists garden_phone_calls (
  id             text primary key,                    -- provider:id
  provider       text not null,
  direction      text,                                -- inbound | outbound
  from_number    text,
  to_number      text,
  started_at     timestamptz,
  duration_sec   int,
  result         text,                                -- answered | missed | voicemail
  recording_url  text,
  transcript     text,
  reservation_id text references garden_reservations (id) on delete set null,
  queue_id       uuid references garden_call_queue (id) on delete set null,
  raw            jsonb,
  synced_at      timestamptz not null default now()
);
create index if not exists garden_phone_calls_at on garden_phone_calls (started_at desc);
