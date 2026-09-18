-- THE OPERATOR'S REVIEW (Jon, 2026-09-18: "We need Eve to get smarter so she can help us improve
-- app, operations, create plans, improve checklists, improve our webapp, understanding of KPIs").
--
-- One row per review run: the weekly Monday pass and any on-demand run from chat or the Review tab.
-- `body` is the model's JSON (headline, movements, plans, critiques, questions, no_signal); the
-- plans are ALSO written to eve_recommendations (kind 'plan') so the existing grader measures them,
-- and the questions to eve_questions (kind 'plan') so the existing answer path files the reply as a
-- memory. `pack_stats` records how big each evidence block was and what got truncated, so a thin
-- review can be traced to a thin pack rather than blamed on the model.
create table if not exists eve_reviews (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  trigger     text not null default 'manual',      -- weekly | manual
  focus       text,                                -- optional steer, e.g. "labor per clean in Broward"
  model       text,
  headline    text,
  body        jsonb not null default '{}'::jsonb,
  pack_stats  jsonb not null default '{}'::jsonb,
  usage       jsonb not null default '{}'::jsonb,
  created_by  text
);
create index if not exists eve_reviews_at_idx on eve_reviews (at desc);
alter table eve_reviews enable row level security;

-- A plan from the review is a recommendation with a shape of its own: it names an area and points
-- back at the review it came from. Existing rows default to 'rec' so nothing already logged changes.
alter table eve_recommendations add column if not exists kind text not null default 'rec';   -- rec | plan
alter table eve_recommendations add column if not exists review_id uuid references eve_reviews(id) on delete set null;
alter table eve_recommendations add column if not exists area text;                           -- operations | checklist | app | guest | money | people
create index if not exists eve_rec_review_idx on eve_recommendations (review_id) where review_id is not null;

notify pgrst, 'reload schema';
