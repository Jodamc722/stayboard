-- 000 — BASELINE: THREE LEGACY TABLES THAT ARE ALREADY IN PRODUCTION. DO NOT RE-RUN.
--
-- These tables were made by hand in the Supabase SQL editor from three files that sat outside this
-- folder: schedule_blocks.sql and schedule_manual_cleans.sql at the repo root, and
-- sql/labor_settings_schema.sql. They live here now (2026-09-29, audit 01-F16) so every table the
-- app reads has its DDL in the repo. Each section below is the original file, byte for byte.
--
-- Already applied; kept for the record, not to be run. Every statement is idempotent anyway
-- (if-not-exists guards, an on-conflict-do-nothing seed, RLS switched on), so an accidental run
-- changes nothing. labor_settings gets its RLS from 130_security_rls.sql.

-- ── was schedule_blocks.sql (repo root) ─────────────────────────────────────────────────────────
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

-- ── was schedule_manual_cleans.sql (repo root) ──────────────────────────────────────────────────
-- Manual cleans added from the StayBoard schedule (create-clean route logs them here so
-- board-added tasks show on the calendar). Run once in the Supabase SQL editor.
create table if not exists schedule_manual_cleans (
  listing_id text not null,
  date date not null,
  breezeway_task_id text,
  created_by text,
  created_at timestamptz default now(),
  primary key (listing_id, date)
);
alter table schedule_manual_cleans enable row level security;

-- ── was sql/labor_settings_schema.sql ───────────────────────────────────────────────────────────
-- Labor settings, editable from the Lighthouse settings page.
-- One row per market plus a 'default' row that everything falls back to.
create table if not exists labor_settings (
  market            text primary key,          -- 'default' | 'miami' | 'broward'
  pct_good          numeric not null default 30,   -- labor % of revenue: <= good -> on target
  pct_bad           numeric not null default 40,   -- > bad -> over target (between = watch)
  grace_min         integer not null default 7,    -- clock-in grace before "late"
  over_sched_min    integer not null default 30,   -- minutes past schedule before flagged
  ot_weekly_hours   numeric not null default 40,   -- workweek OT threshold
  attribution_min   numeric not null default 0.85, -- per-cleaner board reliability gate
  updated_at        timestamptz not null default now(),
  updated_by        text
);

insert into labor_settings (market) values ('default'), ('miami'), ('broward')
on conflict (market) do nothing;
