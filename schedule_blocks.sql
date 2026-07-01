-- Turnover schedule "Block": cleans a user has moved to the next day.
-- Written by /api/schedule/block; read by /api/schedule (block-aware remap).
-- Run this once in the Supabase SQL editor.
create table if not exists public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null,
  orig_date date not null,
  blocked_until date not null,
  created_by text,
  created_at timestamptz not null default now(),
  unique (listing_id, orig_date)
);

create index if not exists schedule_blocks_dates_idx on public.schedule_blocks (orig_date, blocked_until);

-- Server writes use the service-role key (bypasses RLS); enable RLS with no public policy.
alter table public.schedule_blocks enable row level security;
