-- ---------------------------------------------------------------------------------------------
-- eve_questions — what Eve does not know and needs a person to tell her.
--
-- Jon, 2026-08-24: "improve how she understands the business, ask questions etc."
--
-- Everything else Eve learns is INFERRED: she counts records and works out what is true. That
-- ceiling is real, because the most valuable things about this business are not in any table —
-- why Botanica is on a vendor crew, which owner takes a call badly, what "the North problem" means.
-- Those only ever arrive because somebody said them out loud.
--
-- So this is the other direction: a question, the reason it matters, and what she would do
-- differently if she knew. An answer becomes a memory written by a person, which outranks anything
-- she concluded herself, and memory_id links the two so "why does she believe that" always has an
-- answer with a name and a date on it.
--
-- Questions are DEDUPED and counted rather than re-asked. A question asked four times and never
-- answered is itself a finding — either it does not matter, or nobody wants to say.
-- ---------------------------------------------------------------------------------------------
create table if not exists eve_questions (
  id           uuid primary key default gen_random_uuid(),
  question     text not null,
  why          text,                                  -- what she would do differently if she knew
  scope        text not null default 'portfolio',
  kind         text not null default 'gap',           -- gap | verify | conflict
  evidence     jsonb,
  status       text not null default 'open',          -- open | answered | dismissed
  answer       text,
  answered_by  text,
  answered_at  timestamptz,
  memory_id    uuid references eve_memory(id) on delete set null,
  asked_count  integer not null default 1,
  source       text not null default 'system',        -- system (a miner found the gap) | eve (she hit it mid-conversation)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists eve_questions_status_idx on eve_questions (status, updated_at desc);
create index if not exists eve_questions_scope_idx  on eve_questions (scope, status);

alter table eve_questions enable row level security;
