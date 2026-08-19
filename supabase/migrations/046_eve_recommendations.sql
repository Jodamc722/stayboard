-- 046_eve_recommendations.sql — the recommendation ledger.
--
-- WHY THIS TABLE EXISTS. An assistant that gives advice and never finds out whether the advice
-- worked is not learning, it is just talking. Most "AI recommendations" evaporate: somebody reads
-- them, maybe acts, and nothing is ever measured. This is the ledger that closes that loop.
--
-- THE DISCIPLINE IT ENFORCES. Eve cannot log a vague recommendation. To write a row she must commit
-- to FOUR things up front:
--   1. which metric she expects to move   (metric, and it must exist in the METRICS catalogue)
--   2. for which scope                    (scope)
--   3. in which direction, and roughly how much (expect_direction, expect_pct)
--   4. by when it should be visible       (measure_on)
-- That turns "I'd look at pricing on Botanica" into a falsifiable claim. Vague advice is cheap;
-- falsifiable advice is worth something, and it is the only kind you can grade.
--
-- HOW IT IS GRADED. A nightly job compares the metric over the window AFTER the decision against the
-- baseline captured at the time. Outcome is one of worked / didn't / inconclusive — and
-- "inconclusive" is a first-class answer, used whenever the sample is too thin or the recommendation
-- was never actually accepted. Marking a guess as a win is worse than admitting we cannot tell.
--
-- Verdicts feed back into eve_memory as insights, so next quarter she can say "raising rates for
-- event weeks moved RevPAR 3 times out of 4" instead of re-deriving the same idea from scratch.

create table if not exists eve_recommendations (
  id             uuid primary key default gen_random_uuid(),

  -- provenance
  created_by     text,                      -- whose conversation produced it (or 'system' for the brief)
  source         text not null default 'chat',   -- chat | brief | watch | anomaly
  chat_id        uuid,                      -- eve_chats row it came from, when there is one

  -- the recommendation itself
  title          text not null,             -- one line, imperative: "Drop Botanica garden rates 8% for the next 21 days"
  detail         text,                      -- the reasoning, in her own words
  scope          text not null default 'portfolio',  -- portfolio | building:<Rollup> | unit:<listingId>

  -- THE FALSIFIABLE PART — no row without these
  metric            text not null,          -- must be a key from lib/eve/metrics METRICS
  expect_direction  text not null default 'up',   -- up | down
  expect_pct        numeric,                -- rough size of the move she expects, in percent
  measure_on        date not null,          -- when it should be visible
  measure_window    integer not null default 14,  -- days to average over when grading

  -- what the world looked like when she said it, captured so grading cannot be moved later
  baseline_value    numeric,
  baseline_days     integer,
  baseline_sd       numeric,

  -- decision
  status         text not null default 'open',   -- open | accepted | rejected | superseded | expired
  decided_by     text,
  decided_at     timestamptz,
  decision_note  text,

  -- grading
  measured_at    timestamptz,
  actual_value   numeric,
  delta_pct      numeric,
  outcome        text,                      -- worked | didnt | inconclusive
  outcome_note   text,
  memory_id      uuid,                      -- the eve_memory row this verdict produced

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists eve_rec_status_idx  on eve_recommendations (status, created_at desc);
create index if not exists eve_rec_due_idx     on eve_recommendations (measure_on) where outcome is null and status = 'accepted';
create index if not exists eve_rec_scope_idx   on eve_recommendations (scope, metric, created_at desc);
alter table eve_recommendations enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Playbooks: Jon-editable "when X, do Y" rules that Eve instantiates with live data.
--
-- The point is CONSISTENCY. Without these, the same situation gets a slightly different answer
-- every time depending on how the question was phrased. A playbook is Jon's judgement written down
-- once; Eve supplies the current numbers and the specific units. He owns the rule, she owns the data.
-- ---------------------------------------------------------------------------------------------
create table if not exists eve_playbooks (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  when_text    text not null,      -- "a building's review average drops below 4.5"
  then_text    text not null,      -- "deep clean the worst 3 units, book an inspection, reply to every open review"
  metric       text,               -- optional: the metric that triggers it
  scope        text default 'portfolio',
  comparator   text default 'below',   -- below | above
  threshold    numeric,
  active       boolean not null default true,
  sort         integer not null default 100,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists eve_playbooks_active_idx on eve_playbooks (active, sort);
alter table eve_playbooks enable row level security;

notify pgrst, 'reload schema';
