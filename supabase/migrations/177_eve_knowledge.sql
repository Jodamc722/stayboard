-- 177 · EVE'S KNOWLEDGE, TYPED (2026-11-10). NOT RUN YET — for the owner to run by hand.
--
-- Everything shipped with the 2026-11-10 memory pass works WITHOUT this file: provenance, the
-- unconfirmed mark, verified-by and conflicts all live in eve_memory.evidence (jsonb, since 045), and
-- no code reads a column or table created below. This migration is the next step: it gives those
-- facts real columns so they can be filtered, indexed and joined, adds the alias table and the
-- full-text indexes recall will move onto, and adds the columns the eval set needs.
--
-- IDEMPOTENT. Every statement is `if not exists` / guarded; running it twice changes nothing.
-- NO vector extension here — that waits on the owner choosing an embedding provider.
--
--   1. eve_memory: entity_type / entity_id / attribute, valid_from / valid_to, verified_at /
--      verified_by, status, source_ref — and the backfill from `scope` and `evidence`.
--   2. eve_entity_alias: the spellings people actually use for a building (seeded from lib/segments.ts).
--   3. Full-text: generated tsvector columns + GIN indexes on eve_memory and eve_doc_chunks.
--   4. eve_probes / eve_learning_runs: the columns for an eval set built from real questions.
--   5. One-off: legacy building scopes rewritten to the canonical spelling (static alias list).

-- ---------------------------------------------------------------------------------------------
-- 1. Typed facts on eve_memory
-- ---------------------------------------------------------------------------------------------
alter table public.eve_memory add column if not exists entity_type text;        -- portfolio | building | unit | person | channel | owner | vendor | policy
alter table public.eve_memory add column if not exists entity_id   text;        -- the part of `scope` after the colon; null for portfolio
alter table public.eve_memory add column if not exists attribute   text;        -- optional: what about the entity ('cleaning_vendor', 'pet_policy', …)
alter table public.eve_memory add column if not exists valid_from  date;        -- when the fact started being true, if known
alter table public.eve_memory add column if not exists valid_to    date;        -- when it stopped (distinct from expires_on, which is "stop loading it")
alter table public.eve_memory add column if not exists verified_at timestamptz; -- last time a person confirmed it
alter table public.eve_memory add column if not exists verified_by text;
alter table public.eve_memory add column if not exists status      text;        -- active | pending | rejected (null = active, as today)
alter table public.eve_memory add column if not exists source_ref  jsonb;       -- {channel, ts, speaker, permalink} | {doc_id, title, section} | {question_id} | {audit_id}

-- Backfill, only where the column is still empty (safe to re-run).
update public.eve_memory
   set entity_type = case when scope like '%:%' then lower(split_part(scope, ':', 1)) else 'portfolio' end,
       entity_id   = case when scope like '%:%' then nullif(btrim(substr(scope, strpos(scope, ':') + 1)), '') else null end
 where entity_type is null;

-- What the 2026-11-10 code already writes into `evidence` becomes the typed columns.
update public.eve_memory
   set verified_at = (evidence->>'verified_at')::timestamptz,
       verified_by = evidence->>'verified_by'
 where verified_at is null
   and jsonb_typeof(evidence) = 'object'
   and evidence ? 'verified_at'
   and (evidence->>'verified_at') ~ '^\d{4}-\d{2}-\d{2}T';

-- A person's own words were verified by that person on the day they were written.
update public.eve_memory
   set verified_at = created_at, verified_by = coalesce(created_by, source)
 where verified_at is null and source in ('jon', 'staff');

update public.eve_memory
   set status = case
         when jsonb_typeof(evidence) = 'object' and evidence->>'status' in ('pending', 'rejected') then evidence->>'status'
         when jsonb_typeof(evidence) = 'object' and evidence->>'status' = 'confirmed' then 'active'
         -- Overheard in Slack, or her own nightly reflection, and never confirmed: pending (the same
         -- rule as lib/eve/memory.ts isPendingMemory).
         when source = 'slack' then 'pending'
         when source = 'eve' and jsonb_typeof(evidence) = 'object' and evidence->>'from' = 'sleep' then 'pending'
         else 'active'
       end
 where status is null;

update public.eve_memory
   set source_ref = case
         when evidence ? 'channel'     then jsonb_strip_nulls(jsonb_build_object('channel', evidence->'channel', 'channel_name', evidence->'channel_name', 'ts', evidence->'ts', 'speaker', evidence->'speaker', 'permalink', evidence->'permalink', 'said_at', evidence->'said_at'))
         when evidence ? 'doc_id'      then jsonb_strip_nulls(jsonb_build_object('doc_id', evidence->'doc_id', 'title', evidence->'title', 'section', evidence->'section'))
         when evidence ? 'question_id' then jsonb_build_object('question_id', evidence->'question_id')
         when evidence ? 'audit_id'    then jsonb_build_object('audit_id', evidence->'audit_id')
         when evidence ? 'chatId'      then jsonb_strip_nulls(jsonb_build_object('chat_id', evidence->'chatId', 'conversation_id', evidence->'conversationId'))
         else null
       end
 where source_ref is null and jsonb_typeof(evidence) = 'object';

create index if not exists eve_memory_entity_idx on public.eve_memory (entity_type, entity_id) where superseded_by is null;
create index if not exists eve_memory_attr_idx   on public.eve_memory (entity_type, entity_id, attribute) where superseded_by is null and attribute is not null;
create index if not exists eve_memory_status_idx on public.eve_memory (status, created_at desc) where superseded_by is null and status = 'pending';

-- ---------------------------------------------------------------------------------------------
-- 2. Aliases: how a building (later: a unit, an owner, a vendor) is actually written
-- ---------------------------------------------------------------------------------------------
create table if not exists public.eve_entity_alias (
  alias       text not null,                 -- lowercase, letters and digits only ("17west", "parktowers")
  entity_type text not null,                 -- building | unit | owner | vendor | person | channel
  entity_id   text not null,                 -- the canonical id / label
  note        text,
  created_at  timestamptz not null default now(),
  primary key (alias, entity_type)
);
alter table public.eve_entity_alias enable row level security;   -- service role only, like every eve_* table

-- Seeded from the building patterns in lib/segments.ts (the canonical label is the one that file
-- uses). Whole-name spellings only; nothing here is a guess about a partial match.
insert into public.eve_entity_alias (alias, entity_type, entity_id) values
  ('17west', 'building', '17WEST'),
  ('arya', 'building', 'Arya'),
  ('elser', 'building', 'Elser'),
  ('nomad', 'building', 'Nomad'),
  ('district225', 'building', 'District 225'), ('dist225', 'building', 'District 225'),
  ('parktowers', 'building', 'Park Towers'), ('parktower', 'building', 'Park Towers'),
  ('miamihouse', 'building', 'Miami House'),
  ('botanica', 'building', 'Botanica'),
  ('eden', 'building', 'Eden'),
  ('rustic', 'building', 'Rustic'),
  ('hendricks', 'building', 'Hendricks'), ('hendrick', 'building', 'Hendricks'),
  ('oasis', 'building', 'Oasis'),
  ('waves', 'building', 'Waves'),
  ('pelican', 'building', 'Pelican'),
  ('salato', 'building', 'Salato'),
  ('336arthur', 'building', '336 Arthur'), ('arthur', 'building', '336 Arthur'),
  ('7071sw', 'building', '7071 SW'), ('7071', 'building', '7071 SW'),
  ('906', 'building', '906'),
  ('3316', 'building', '3316'),
  ('1587', 'building', '1587'),
  ('capri', 'building', 'Capri'),
  ('lucerne', 'building', 'Lucerne'), ('lucenre', 'building', 'Lucerne'),
  ('amrit', 'building', 'Amrit')
on conflict (alias, entity_type) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 3. Full-text columns + GIN indexes (recall and the document search move onto these next)
-- ---------------------------------------------------------------------------------------------
alter table public.eve_memory
  add column if not exists fts tsvector
  generated always as (to_tsvector('english', coalesce(text, '') || ' ' || coalesce(why, ''))) stored;
create index if not exists eve_memory_fts_idx on public.eve_memory using gin (fts) where superseded_by is null;

alter table public.eve_doc_chunks
  add column if not exists fts tsvector
  generated always as (to_tsvector('english', coalesce(heading, '') || ' ' || coalesce(text, ''))) stored;
create index if not exists eve_doc_chunks_fts_idx on public.eve_doc_chunks using gin (fts);

-- ---------------------------------------------------------------------------------------------
-- 4. The eval set: probes built from real questions, asked WITH tools, scored apart from retention
-- ---------------------------------------------------------------------------------------------
alter table public.eve_probes add column if not exists with_tools     boolean not null default false;  -- true = an eval question (tools on); false = a memory probe (tools off), as today
alter table public.eve_probes add column if not exists domain         text;                            -- ops | guests | owners | money | upkeep | policy …
alter table public.eve_probes add column if not exists source_chat_id uuid;                            -- the real exchange it was cut from (eve_chats.id)
alter table public.eve_probes add column if not exists approved_by    text;                            -- who signed off the expected answer
alter table public.eve_learning_runs add column if not exists eval_accuracy numeric;                   -- passed ÷ asked over with_tools probes, percent
create index if not exists eve_probes_eval_idx on public.eve_probes (due_at) where active and with_tools;

-- ---------------------------------------------------------------------------------------------
-- 5. One-off: legacy building scopes → the canonical spelling
--
-- Before 2026-11-09 a building scope was stored however the Slack room spelled it ("building:17
-- West", "building:17west"), and recall asks for the canonical label only. This rewrites a scope
-- ONLY when everything after "building:" is, letters-and-digits for letters-and-digits, one of the
-- whole-name aliases seeded above — never on a partial match — and only when the spelling differs.
-- Anything else is left exactly as it is. The typed columns follow in the same statement.
-- ---------------------------------------------------------------------------------------------
update public.eve_memory m
   set scope = 'building:' || a.entity_id,
       entity_type = 'building',
       entity_id = a.entity_id,
       updated_at = m.updated_at            -- unchanged on purpose: a respelling is not a re-confirmation
  from public.eve_entity_alias a
 where a.entity_type = 'building'
   and m.scope ilike 'building:%'
   and regexp_replace(lower(substr(m.scope, strpos(m.scope, ':') + 1)), '[^a-z0-9]', '', 'g') = a.alias
   and m.scope <> 'building:' || a.entity_id;

-- Open questions carry a scope too; keep them in step so an answer lands on the right building.
update public.eve_questions q
   set scope = 'building:' || a.entity_id
  from public.eve_entity_alias a
 where a.entity_type = 'building'
   and q.scope ilike 'building:%'
   and regexp_replace(lower(substr(q.scope, strpos(q.scope, ':') + 1)), '[^a-z0-9]', '', 'g') = a.alias
   and q.scope <> 'building:' || a.entity_id;

notify pgrst, 'reload schema';
