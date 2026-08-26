-- ---------------------------------------------------------------------------------------------
-- EVE LEARNS THE MACHINE — automations, outbound email, message origin, response times.
--
-- Jon, 2026-08-26: "she needs to understand all automations, understand everything about guesty,
-- messages, sentiment, response time, reservation details, all the custom fields, Slack, what
-- channels are for what ... expert in all things ops and customer service."
--
-- The audit that preceded this found the same shape of hole four times over: the app DOES the
-- thing, and keeps no record that it did. Eve could read every guest message but not know whether
-- a human or a Guesty automation sent the reply. She could read the ops brief's recipients list in
-- app_settings — except nothing exposed it — and even then could not say whether this morning's
-- brief actually went. So this migration is mostly about RECEIPTS: making the app's own behaviour
-- into rows, because a number nobody wrote down is a number she has to guess at, and guessing is
-- the one thing her prompt forbids.
-- ---------------------------------------------------------------------------------------------

-- ---- 1. Did the automation run? ---------------------------------------------------------------
-- One row per RUN of anything scheduled. Deliberately not one row per job with a "last_run"
-- column: the interesting question is never just "when did it last run" but "has it been failing
-- quietly since Tuesday", and a column cannot answer that.
create table if not exists automation_runs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                       -- registry key from lib/eve/automations.ts
  ok          boolean not null default true,
  item_count  integer,                             -- what it actually did: 4 emails, 0 alerts, 37 tasks
  detail      jsonb,                               -- the run's own summary, whatever shape it has
  error       text,
  ms          integer,
  ran_at      timestamptz not null default now()
);
create index if not exists automation_runs_name_idx on automation_runs (name, ran_at desc);
create index if not exists automation_runs_at_idx   on automation_runs (ran_at desc);

-- ---- 2. Did the email go, and to whom? --------------------------------------------------------
-- Written by ONE choke point (lib/gmail-send.ts sendGmail), the way requireLevel became the one
-- place every permission check is logged. Six different briefs, one receipt table, no per-route
-- wiring to forget. Bodies are NOT stored — recipients, subject and outcome are what anyone ever
-- asks about, and the body is regenerable.
create table if not exists email_log (
  id          uuid primary key default gen_random_uuid(),
  source      text,                                -- 'ops-brief', 'labor-trueup', … best effort
  from_email  text,
  to_emails   text[] not null default '{}',
  cc_emails   text[] not null default '{}',
  subject     text,
  ok          boolean not null default true,
  error       text,
  attachments integer not null default 0,
  sent_at     timestamptz not null default now()
);
create index if not exists email_log_sent_idx   on email_log (sent_at desc);
create index if not exists email_log_source_idx on email_log (source, sent_at desc);

-- ---- 3. Was that reply a person, or Guesty firing a template? ---------------------------------
-- `sender` has only ever been guest | host | system, so a Guesty auto-message sent AS the host is
-- indistinguishable from Karla typing — which silently flatters every response-time number and
-- mislabels the sentiment transcript. The signal is already in the payload we store; nothing ever
-- read it back out.
alter table guesty_messages add column if not exists module       text;
alter table guesty_messages add column if not exists is_automated boolean;
create index if not exists guesty_messages_auto_idx on guesty_messages (conversation_id, sent_at desc);

-- Backfill from the raw payload we already hold. Kept deliberately narrow: only rows where the
-- evidence is explicit. Anything ambiguous stays NULL — "we do not know" is a real answer and a
-- false "human replied" is worse than an honest gap.
update guesty_messages
   set module = coalesce(module, nullif(raw->>'module',''))
 where raw ? 'module' and module is null;

update guesty_messages
   set is_automated = true
 where is_automated is null
   and sender = 'host'
   and (
     (raw->>'module') ilike '%auto%'
     or raw ? 'automationId' or raw ? 'autoMessageId' or raw ? 'ruleId' or raw ? 'templateId'
     or (raw->'sentBy'->>'type') ilike '%auto%'
     or (raw->'from'->>'type')   ilike '%auto%'
   );

-- ---- 4. How fast did we answer? ----------------------------------------------------------------
-- The math existed — inside one page component, recomputed on every load over the last 4,000
-- messages, reachable by nobody. Materialised here per conversation so it can be sliced by
-- building/channel/day without re-scanning the message table on every question.
--
-- TWO NUMBERS ON PURPOSE. `first_ms` counts any host reply; `human_first_ms` ignores replies we
-- know were automated. The gap between them is the honest measure of how much of our "fast
-- response" is a template. Where automation cannot be determined, human_first_ms is NULL rather
-- than optimistic.
create table if not exists conversation_response (
  conversation_id text primary key,
  reservation_id  text,
  listing_id      text,
  building        text,
  channel         text,
  first_ms        bigint,                          -- guest asks -> first host reply
  human_first_ms  bigint,                          -- same, ignoring known-automated replies
  replies         integer not null default 0,
  guest_msgs      integer not null default 0,
  awaiting        boolean not null default false,  -- last message is the guest's
  last_guest_at   timestamptz,
  last_host_at    timestamptz,
  last_responder  text,
  computed_at     timestamptz not null default now()
);
create index if not exists conversation_response_building_idx on conversation_response (building, last_guest_at desc);
create index if not exists conversation_response_awaiting_idx on conversation_response (awaiting, last_guest_at desc);

-- ---- 5. What the house knows in writing --------------------------------------------------------
-- Everything Eve knows today she INFERRED from records. The playbooks, the checklists, the owner
-- rules — the things a new GM would be handed on day one — live in documents she has never read.
-- Stored in the database rather than the repo on purpose: this repo is PUBLIC.
create table if not exists eve_docs (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text not null default 'sop',         -- sop | playbook | policy | reference | research
  source      text,                                -- filename or where it came from
  body        text not null default '',
  words       integer not null default 0,
  active      boolean not null default true,
  added_by    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists eve_docs_active_idx on eve_docs (active, updated_at desc);

-- Retrieval unit. A 6,000-word playbook answers questions one SECTION at a time; handing Eve the
-- whole file wastes the context she needs for the actual records.
create table if not exists eve_doc_chunks (
  id         uuid primary key default gen_random_uuid(),
  doc_id     uuid not null references eve_docs(id) on delete cascade,
  idx        integer not null default 0,
  heading    text,
  text       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists eve_doc_chunks_doc_idx on eve_doc_chunks (doc_id, idx);

alter table automation_runs      enable row level security;
alter table email_log            enable row level security;
alter table conversation_response enable row level security;
alter table eve_docs             enable row level security;
alter table eve_doc_chunks       enable row level security;
-- No policies: service role only. email_log holds staff addresses, eve_docs holds internal
-- playbooks, and conversation_response is a performance record — none of it belongs to the anon key.
