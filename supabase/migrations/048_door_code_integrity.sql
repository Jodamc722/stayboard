-- ---------------------------------------------------------------------------------------------
-- Door-code integrity (Jon, 2026-08-24: "So how do we ensure codes are accurate").
--
-- Two tables and one idea: the code in Guesty is a CLAIM, and a claim needs evidence.
--
-- door_code_state carries what we believe about the CURRENT code for each unit — when it last
-- changed, and whether anybody has actually opened a door with it. When the code changes, the
-- verification history is CLEARED rather than carried forward: what we knew about the old code
-- says nothing about the new one, and quietly keeping the old confirmation would be a lie.
--
-- door_code_verifications is the log of real-world outcomes, one row per "it worked" / "it did not"
-- reported after a release. It is the only ground truth in the system.
--
-- NEITHER TABLE STORES A CODE. code_fp is a truncated sha256. That is not a security boundary —
-- the plaintext already lives in guesty_listings.raw — but it keeps codes out of a second table,
-- out of audit rows, and out of anything Eve can read.
-- ---------------------------------------------------------------------------------------------
create table if not exists door_code_state (
  listing_id       text primary key,
  code_fp          text not null,
  digits           integer,
  first_seen_at    timestamptz not null default now(),
  changed_at       timestamptz not null default now(),
  last_checked_at  timestamptz not null default now(),
  last_verified_at timestamptz,
  last_verified_by text,
  last_failed_at   timestamptz,
  last_failed_by   text,
  fail_count       integer not null default 0,
  note             text
);
create index if not exists door_code_state_fp_idx on door_code_state (code_fp);

create table if not exists door_code_verifications (
  id          uuid primary key default gen_random_uuid(),
  listing_id  text not null,
  action_id   uuid,
  code_fp     text not null,
  worked      boolean not null,
  reported_by text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists door_code_verifications_listing_idx on door_code_verifications (listing_id, created_at desc);

alter table door_code_state enable row level security;
alter table door_code_verifications enable row level security;
