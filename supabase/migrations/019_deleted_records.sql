-- THE GRAVEYARD — one shelf for everything deleted anywhere in the app.
--
-- WHY NOT A `deleted_at` COLUMN: glitches are read from eight places (KPIs, the day sheet, revenue,
-- open-work, listing intel, Command Center…). A soft-delete flag means every one of those has to
-- remember to filter, and the first one that forgets is a "deleted" glitch quietly still counting
-- toward a number somebody reports to an owner. So a delete really deletes the row — and the whole
-- row is photographed into here first, so nothing is actually lost and Restore puts it back.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

create table if not exists deleted_records (
  id          uuid primary key default gen_random_uuid(),

  -- 'glitch' | 'claim' — the table the row came from.
  kind        text not null,
  record_id   text not null,

  -- What it was, in words, so the trash list is readable without rehydrating anything.
  label       text,

  -- The full row, exactly as it was.
  payload     jsonb not null,
  -- Child rows that went with it (claim_items). Restored alongside the parent.
  children    jsonb not null default '[]'::jsonb,

  deleted_by  text,
  deleted_at  timestamptz not null default now(),

  -- Set when it is put back, so the trail shows a restore rather than losing the record of it.
  restored_at timestamptz,
  restored_by text
);

create index if not exists idx_deleted_records_kind on deleted_records(kind, deleted_at desc) where restored_at is null;
create index if not exists idx_deleted_records_rec  on deleted_records(record_id);

-- RLS on with NO permissive policy: reads and writes go through our own API on the service role,
-- which is where the admin check lives. Deleted rows carry guest names and dollar figures.
alter table deleted_records enable row level security;

notify pgrst, 'reload schema';
