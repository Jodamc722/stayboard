-- AI USAGE LEDGER (2026-09-18). One row per Messages API call, whatever route made it.
-- Jon: "ensure using as little token on the webapp without losing efficiency and saving on cost."
-- Nothing could say what a task cost before this table existed; only Eve logged her own usage.
create table if not exists ai_usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  task text not null,                 -- AI_TASKS key (lib/ai-models.ts)
  model text not null,                -- the model id that answered
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read int not null default 0,
  cache_write int not null default 0,
  cost_usd numeric(10,6) not null default 0,
  ms int,                             -- wall time of the call
  ok boolean not null default true,
  status int,                         -- HTTP status from Anthropic
  stop_reason text,
  route text                          -- which route/lib made the call, for the drill-down
);
create index if not exists ai_usage_at_idx on ai_usage (at desc);
create index if not exists ai_usage_task_at_idx on ai_usage (task, at desc);
alter table ai_usage enable row level security;
