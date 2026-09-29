-- PERF INDEXES (2026-09-28 audit, 02-cache-perf §E). Idempotent: safe to run again, one script in
-- the SQL editor. No CONCURRENTLY (the editor runs this as one transaction), so each index briefly
-- blocks writes to its table while it builds — run it outside the morning rush.

-- 1. /messages KPI header: ORDER BY sent_at DESC, conversation_id with OFFSET paging. Only
--    (conversation_id, sent_at) existed (001, 058), which cannot serve that sort.
create index if not exists idx_guesty_messages_sent_at on guesty_messages (sent_at desc, conversation_id);

-- 2. Leading-wildcard ILIKE on task names — the glitch board ('%glitch%', '%guest reported%'), the
--    Command Center's inspection lookup ('%inspect%', '%quality%'). A btree cannot serve '%x%'; a
--    trigram GIN index can. pg_trgm goes in Supabase's `extensions` schema when it has one, and the
--    operator class is named through whichever schema the extension actually lives in.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    if exists (select 1 from pg_namespace where nspname = 'extensions') then
      execute 'create extension pg_trgm with schema extensions';
    else
      execute 'create extension pg_trgm';
    end if;
  end if;
end $$;

do $$
declare trgm_schema text;
begin
  select n.nspname into trgm_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if trgm_schema is not null and to_regclass('public.breezeway_tasks_sync') is not null then
    execute format('create index if not exists idx_bts_name_trgm on public.breezeway_tasks_sync using gin (name %I.gin_trgm_ops)', trgm_schema);
  end if;
end $$;

-- 3. Open work by date: the Command Center's open-task scan and overdue count, the KPI open tasks
--    (finished_at IS NULL + a scheduled_date range).
create index if not exists idx_bts_open_by_date on breezeway_tasks_sync (scheduled_date) where finished_at is null;

-- 4. Unread conversations with count:'exact' (Command Center guest desk, Eve's counts).
create index if not exists idx_gc_unread on guesty_conversations (last_message_at desc) where unread_count > 0;

-- 5. Sentiment desk: status = 'open' ORDER BY last_message_at DESC. This table was created outside
--    the migrations folder, so the index is made only where the table exists.
do $$
begin
  if to_regclass('public.guesty_conversation_sentiment') is not null then
    execute 'create index if not exists idx_gcs_status_last on public.guesty_conversation_sentiment (status, last_message_at desc)';
  end if;
end $$;
