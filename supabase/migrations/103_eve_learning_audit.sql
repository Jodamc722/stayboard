-- IS SHE REALLY LEARNING? (2026-09-21). Jon: "How do we audit and ensure Eve is really learning?"
-- A memory count proves things were written down. This is the bookkeeping for the instrument that
-- proves they took (lib/eve/learning-audit.ts): probes, runs, and two telemetry columns.

-- 1. PROBES. Every fact a person teaches her becomes a question with an expected answer, asked
--    back through the real loop with every tool removed — tomorrow, then in a week, then a month.
--    kind: taught (Teach her) | answered (a question she asked, answered) | declined (a thought
--    dismissed with a reason) | rule (seeded from existing weight-8 memories; the honesty probes).
create table if not exists eve_probes (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null default 'taught',
  question         text not null,
  expected         text not null,                  -- 'no signal' = an honesty probe: pass only by saying she does not know
  source_memory_id uuid references eve_memory(id) on delete set null,
  created_at       timestamptz not null default now(),
  due_at           timestamptz not null default now(),
  last_asked_at    timestamptz,
  last_answer      text,
  last_pass        boolean,
  last_why         text,                           -- the judge's one line
  pass_count       integer not null default 0,
  fail_count       integer not null default 0,
  active           boolean not null default true
);
create index if not exists eve_probes_due_idx on eve_probes (due_at) where active;
create index if not exists eve_probes_memory_idx on eve_probes (source_memory_id) where source_memory_id is not null;
alter table eve_probes enable row level security;

-- 2. RUNS. One row per self-test (nightly after the learning pass, weekly with the Monday review,
--    or "Run now"): the four learning numbers, the score, and the full detail (every probe asked,
--    every failure, the dead memories, the shapes still recurring) plus what it cost.
create table if not exists eve_learning_runs (
  id                uuid primary key default gen_random_uuid(),
  at                timestamptz not null default now(),
  kind              text not null default 'nightly',   -- weekly | nightly | manual
  probes            integer not null default 0,
  passed            integer not null default 0,
  failed            integer not null default 0,
  memory_hit_rate   numeric,                           -- used ÷ injected memories, 7 days, percent
  recurrence_rate   numeric,                           -- thoughts of a shape Jon declined earlier ÷ all thoughts, 7 days, percent
  grading_hit_rate  numeric,                           -- worked ÷ graded recommendations, percent
  score             integer,                           -- 0–100: 40% retention, 20% hit rate, 20% (1 − recurrence), 20% grading
  detail            jsonb,
  usage             jsonb                              -- the probes' tokens and dollars
);
create index if not exists eve_learning_runs_at_idx on eve_learning_runs (at desc);
alter table eve_learning_runs enable row level security;

-- 3. APPLICATION TELEMETRY. Per chat: how many memories were injected and which ids the answer
--    actually drew on (word overlap, lib/eve/memory.ts memoryHitsFor). Per memory: how many
--    answers it has shaped and when it last did — use_count says loaded, hit_count says used.
alter table public.eve_chats  add column if not exists memory_hits jsonb;
alter table public.eve_memory add column if not exists hit_count   integer not null default 0;
alter table public.eve_memory add column if not exists last_hit_at timestamptz;
create index if not exists eve_memory_dead_idx on eve_memory (use_count desc) where hit_count = 0 and superseded_by is null;

notify pgrst, 'reload schema';
