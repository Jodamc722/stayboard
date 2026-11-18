-- REVIEW REPLY DRAFTS, WRITTEN AS THE REVIEW ARRIVES (Jon, 2026-11-18: "each review as they come in
-- should be drafted already"). Until now a draft lived only in the browser of whoever pressed
-- Draft, so every review opened blank for everyone else. One row per review; nothing here is ever
-- posted on its own — a person still approves each reply on the Reviews page.
create table if not exists public.review_drafts (
  review_id  text primary key,
  draft      text not null,
  source     text not null default 'auto',
  created_at timestamptz not null default now()
);
alter table public.review_drafts enable row level security;
