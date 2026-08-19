-- 045_eve_v2.sql — Eve v2, "The Brain".
--
-- Six tables. Only the first two are used by the Phase 1 ship; the other four are created now so
-- there is ONE migration to run rather than four over the next fortnight. They sit empty until
-- their phase lands, which costs nothing.
--
-- 044 was taken by slack_outbox on the same day (parallel session), hence 045.
--
-- RLS is ON with NO permissive policy on every table here — same posture as `claims` and the FF&E
-- tables. Everything goes through a service-role read inside an app route that has already run
-- requireLevel. eve_memory in particular holds Jon's standing instructions and eve_chats holds
-- whole conversations; neither should ever be reachable with an anon key.

-- ---------------------------------------------------------------------------------------------
-- 1. eve_memory — what Eve knows and keeps. The difference between a search box and a colleague.
-- ---------------------------------------------------------------------------------------------
create table if not exists eve_memory (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null default 'insight',   -- rule|preference|insight|decision|person|issue|correction
  text           text not null,
  why            text,
  -- portfolio | building:<Rollup> | unit:<listingId> | person:<email>
  scope          text not null default 'portfolio',
  weight         integer not null default 5,        -- 1-10; 8+ means Jon said it directly
  source         text not null default 'eve',       -- jon | eve | system
  confidence     numeric,
  evidence       jsonb,
  created_by     text,
  use_count      integer not null default 0,
  last_used_at   timestamptz,
  expires_on     date,
  -- Corrections SUPERSEDE rather than delete, so the audit trail survives and /eve can show what
  -- changed and when. A superseded row is never loaded into the prompt.
  superseded_by  uuid references eve_memory(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists eve_memory_scope_idx  on eve_memory (scope, weight desc) where superseded_by is null;
create index if not exists eve_memory_kind_idx   on eve_memory (kind, weight desc);
create index if not exists eve_memory_live_idx   on eve_memory (updated_at desc) where superseded_by is null;
alter table eve_memory enable row level security;

-- Cheap usage bump so /eve can show which memories are actually earning their place in the prompt.
create or replace function eve_touch_memories(ids uuid[])
returns void language sql security definer as $$
  update eve_memory
     set use_count = use_count + 1, last_used_at = now()
   where id = any(ids);
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. eve_chats — every exchange. Without this a thumbs-down is just a feeling.
-- ---------------------------------------------------------------------------------------------
create table if not exists eve_chats (
  id              uuid primary key default gen_random_uuid(),
  user_email      text,
  question        text,
  answer          text,
  tools_used      jsonb not null default '[]',
  domains_opened  jsonb not null default '[]',
  turns           integer,
  ms              integer,
  rating          smallint,        -- 1 = thumbs up, -1 = thumbs down, null = no verdict
  correction      text,            -- "what I actually meant" — the gold for the learning loop
  reviewed        boolean not null default false,   -- has the nightly self-critique seen this row
  created_at      timestamptz not null default now()
);
create index if not exists eve_chats_created_idx on eve_chats (created_at desc);
create index if not exists eve_chats_rating_idx  on eve_chats (rating) where rating is not null;
create index if not exists eve_chats_review_idx  on eve_chats (created_at) where reviewed = false;
alter table eve_chats enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 3. eve_metrics — nightly baselines (PHASE 2). Trends only mean something against a baseline.
-- ---------------------------------------------------------------------------------------------
create table if not exists eve_metrics (
  day     date not null,
  scope   text not null,           -- portfolio | building:<Rollup> | unit:<listingId>
  metric  text not null,           -- occupancy | adr | revpar | cost_per_clean | review_avg | ...
  value   numeric,
  n       integer,                 -- sample size behind the value, so thin days can be discounted
  primary key (day, scope, metric)
);
create index if not exists eve_metrics_lookup_idx on eve_metrics (scope, metric, day desc);
alter table eve_metrics enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 4. eve_actions — the approval queue (PHASE 4). Shares the Command Center surface with
--    slack_outbox from migration 044; this is Eve's side of the same queue, not a second one.
-- ---------------------------------------------------------------------------------------------
create table if not exists eve_actions (
  id           uuid primary key default gen_random_uuid(),
  created_by   text,               -- whose conversation produced it
  kind         text not null,      -- breezeway_task|glitch|field_request|review_reply_draft|slack_message|comment
  payload      jsonb not null default '{}',
  why          text,
  evidence     jsonb,
  status       text not null default 'proposed',  -- proposed|approved|rejected|executed|failed|expired
  decided_by   text,
  decided_at   timestamptz,
  executed_at  timestamptz,
  result       jsonb,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists eve_actions_status_idx on eve_actions (status, created_at desc);
alter table eve_actions enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 5. eve_watches — standing questions checked nightly (PHASE 5).
-- ---------------------------------------------------------------------------------------------
create table if not exists eve_watches (
  id            uuid primary key default gen_random_uuid(),
  owner_email   text,
  label         text,
  metric        text not null,
  scope         text not null default 'portfolio',
  comparator    text not null default 'below',    -- below | above | drops_by | rises_by
  threshold     numeric,
  channel       text not null default 'app',      -- app | slack
  last_fired_at timestamptz,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table eve_watches enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 6. user_integrations — per-person OAuth tokens (PHASE 3, Slack).
--
-- Deliberately NOT app_settings. That table is fine for one workspace-level webhook; these are
-- per-user credentials that grant read access to private channels, and the repo is public. The
-- token column stores AES-256-GCM ciphertext keyed on INTEGRATION_ENC_KEY — never plaintext, and
-- it never leaves the server in any response body.
-- ---------------------------------------------------------------------------------------------
create table if not exists user_integrations (
  email             text not null,
  provider          text not null,          -- 'slack'
  access_token_enc  text not null,
  scope             text,
  team_id           text,
  team_name         text,
  external_user_id  text,                   -- Slack user id, so we can attribute what we read
  connected_at      timestamptz not null default now(),
  last_used_at      timestamptz,
  revoked_at        timestamptz,
  primary key (email, provider)
);
alter table user_integrations enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Seed the `eve` permission. Admin gets full; every other role starts OFF, exactly like the
-- Revenue and Owner Audit tabs did. Switching Roberto on later is a dropdown on /users, not a ship.
-- ---------------------------------------------------------------------------------------------
update app_roles
   set perms = coalesce(perms, '{}'::jsonb) || '{"eve":"full"}'::jsonb,
       updated_at = now()
 where key = 'admin';

update app_roles
   set perms = coalesce(perms, '{}'::jsonb) || '{"eve":"off"}'::jsonb,
       updated_at = now()
 where key <> 'admin'
   and not (coalesce(perms, '{}'::jsonb) ? 'eve');

notify pgrst, 'reload schema';
