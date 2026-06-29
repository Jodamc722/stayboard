-- Eve's learned knowledge base: facts/FAQs/complaint patterns/insights she mines from the live data
-- (reviews, guest messages, sentiment) and recalls in every conversation. Auto-populated by /api/eve/learn.
create table if not exists eve_knowledge (
  id            text primary key,
  type          text not null default 'insight',   -- faq | complaint | insight | fact
  scope         text not null default 'portfolio', -- portfolio | building:<name> | unit:<name>
  title         text not null,
  content       text,
  evidence_count integer not null default 1,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_eve_knowledge_type on eve_knowledge(type, evidence_count desc);
alter table eve_knowledge enable row level security;
drop policy if exists "authenticated read eve_knowledge" on eve_knowledge;
create policy "authenticated read eve_knowledge" on eve_knowledge for select to authenticated using (true);
