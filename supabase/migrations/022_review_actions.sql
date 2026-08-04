-- REVIEW ACTIONS — turn guest feedback into a job someone can finish.
--
-- The reviews board could always tell you "7 guests mentioned cleanliness". Nobody could tell you
-- what was DONE about it. This table is the missing half: one row per (unit, complaint theme), with
-- a status somebody ticks off, so a complaint stops being a statistic and becomes a task.
--
-- WHY (listing_id, theme_key) IS UNIQUE. Actions are REGENERATED from reviews on a schedule. Without
-- a natural key, every regeneration would deal a fresh pile of duplicates onto the board and the
-- team would stop trusting it. The generator upserts on this key: new mentions raise the count and
-- extend the evidence on the SAME row.
--
-- THE REOPEN RULE is the point of the whole thing. If an action was completed on the 4th and a guest
-- complains about the same theme on the 11th, the fix did not hold — the row flips back to open and
-- records that it has been round this loop before (reopened_count). "We fixed it twice already" is
-- the sentence that gets a mattress replaced instead of flipped.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

create table if not exists review_actions (
  id              uuid primary key default gen_random_uuid(),

  listing_id      text not null,
  unit            text,
  building        text,

  -- Matches lib/review-themes.ts THEMES[].key — cleanliness, ac, bathroom, supplies, ...
  theme_key       text not null,
  -- Who this belongs to: the cleaner, the inspector, or maintenance.
  kind            text not null default 'clean' check (kind in ('clean','inspection','maintenance')),

  title           text not null,          -- "Cleanliness at 1201 Brickell"
  action          text not null,          -- what to actually DO, written for the field

  severity        text not null default 'normal' check (severity in ('urgent','normal')),
  mentions        int  not null default 1,
  worst_rating    numeric,

  -- [{ quote, at, rating, channel, reviewId }] — the guest's own words, so the field can see why.
  evidence        jsonb not null default '[]'::jsonb,

  first_seen      date,
  last_seen       date,

  status          text not null default 'open' check (status in ('open','doing','done','dismissed')),
  completed_at    timestamptz,
  completed_by    text,
  reopened_count  int not null default 0,
  note            text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists review_actions_unit_theme on review_actions (listing_id, theme_key);
create index if not exists review_actions_status  on review_actions (status);
create index if not exists review_actions_listing on review_actions (listing_id);
create index if not exists review_actions_kind    on review_actions (kind);
