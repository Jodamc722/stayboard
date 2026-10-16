-- GUEST UNDERSTANDING — migration 156, renumbered off 155 which upstream took for the inbox (Jon, 2026-10-14: "for phone call, want it to populate a guest understanding
-- log for the reservation. Why they are coming down, guests, kids, pets, are the parking, how many
-- cars, what brings them down… this should be part of guest profile… Repeat guest should also be
-- flagged on the reservation and breezeway tasks.")
--
-- TWO TABLES BECAUSE THERE ARE TWO FACTS. What we learned on THIS stay is a record of a
-- conversation on a date — it stays true forever and belongs to the reservation. What we know about
-- the PERSON is the accumulation, and it changes: the couple who came alone in March arrive with a
-- toddler in October. Collapsing the two loses the first one the moment the second updates, and
-- then nobody can answer "what did they actually tell us in March".
--
-- guest_understanding : one row per reservation. Immutable-ish. Where it came from (a call, a
--                       person typing) is recorded, because a guess from a transcript and a
--                       sentence the guest said are not the same evidence.
-- guest_understanding_profiles : one row per human. The roll-up, plus the stay count that drives
--                       the repeat flag and the tags the rest of the app reads.
--
-- WHY NOT `guest_profiles`. That name was taken, by migration 043 — the VIP / tags / notes layer
-- that feeds the auto-inspection engine, keyed by normalised email and carrying `tags` as a
-- text[]. Two tables with one name is how a VIP flag gets overwritten by a stay count. This one
-- keys by the same ladder lib/same-guest uses and stays beside the understanding it is built from;
-- merging the two is a deliberate piece of work, not something to do by colliding on a name.
--
-- IDENTITY. `guest_key` is the Guesty guest id when we have one, else the last nine digits of the
-- phone, else the lowercased name — the same ladder lib/same-guest.ts uses to decide whether a
-- checkout and a check-in are one person. One rule, not two, because the one that drifts is the one
-- that tells a cleaner the wrong thing.

create table if not exists guest_understanding (
  reservation_id text primary key,
  guest_key      text not null,
  listing_id     text,
  check_in       date,
  data           jsonb not null default '{}'::jsonb,
  source         text not null default 'manual',   -- call | manual | mixed
  call_id        text,
  by_email       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists guest_understanding_key_idx     on guest_understanding (guest_key);
create index if not exists guest_understanding_checkin_idx on guest_understanding (check_in desc);

create table if not exists guest_understanding_profiles (
  guest_key   text primary key,
  guesty_id   text,
  name        text,
  phone       text,
  data        jsonb not null default '{}'::jsonb,   -- the merged understanding, latest answer wins
  tags        jsonb not null default '[]'::jsonb,   -- derived: Kids · Pets · Repeat guest · Needs parking…
  stays       integer not null default 0,
  first_seen  date,
  last_seen   date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists gup_guesty_idx on guest_understanding_profiles (guesty_id);
create index if not exists gup_name_idx   on guest_understanding_profiles (lower(name));

-- Which Breezeway tasks already carry this stay's brief, so a re-push replaces its own block
-- instead of stacking a fourth copy under the checklist.
create table if not exists guest_brief_pushes (
  reservation_id text not null,
  bz_task_id     text not null,
  pushed_at      timestamptz not null default now(),
  digest         text,
  primary key (reservation_id, bz_task_id)
);
