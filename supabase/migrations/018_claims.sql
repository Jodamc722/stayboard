-- CLAIMS — damage/theft claims against AirCover, Vrbo/Booking cover, or the guest's card.
-- Rebuilds the Asana "Claims Form" + claims board in the app, attached to the reservation.
--
-- THE THING THAT ACTUALLY LOSES US MONEY is the clock. Airbnb's window closes 14 days after
-- checkout, so every claim carries a hard deadline (checkout + 13 days, one day of margin) that
-- the board counts down in the open. A claim that misses the window is not a claim.
--
-- One claim = one reservation. One claim has MANY ITEMS, because the channels want each damaged
-- item evidenced separately (description, condition before the guest, age, cost, receipt, photos).
-- The Asana form faked this with "Item 1 / Item 2 / Item 3" fields and an "additional items"
-- free-text box; here it is a real child table with no cap.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

create table if not exists claims (
  id            uuid primary key default gen_random_uuid(),

  -- PIPELINE. Seven lanes, tightened from the five Asana sections:
  --   draft        being built, not ready for eyes
  --   review       Jon's review (Asana "Step 1: New Claims")
  --   ready        approved, not yet filed (Asana "Step 2B: Pending Submission")
  --   submitted    filed with the channel (Asana "Step 3")
  --   decided      channel answered — see outcome
  --   settle       money + books: verify payment received (Asana "Step 2A") AND the owner/PMC
  --                adjustment (Asana "Need to adjust owner/pmc"), which are two checkboxes on
  --                one card rather than two lanes, because they are the same handoff
  --   closed       done
  stage         text not null default 'draft'
                check (stage in ('draft','review','ready','submitted','decided','settle','closed')),

  -- What the channel said. Null until they answer.
  outcome       text check (outcome in ('won','partial','denied','withdrawn','duplicate')),

  -- Sub-state while a claim sits in `submitted`, so the board can show what it is waiting on.
  waiting_on    text check (waiting_on in ('channel','guest','escalated')),

  -- ── the reservation this claim belongs to ────────────────────────────────
  reservation_id     text,
  listing_id         text,
  property           text,          -- building label, e.g. "EDEN (3020 Seville)"
  unit_no            text,
  guest_name         text,
  channel            text,          -- Airbnb | VRBO | Booking.com | Direct | Other
  confirmation_code  text,
  check_in           date,
  check_out          date,

  -- ── the clock ────────────────────────────────────────────────────────────
  discovered_on date,               -- when the damage/theft was found
  -- checkout + 13 days, stamped on save so the board can sort and filter on it.
  deadline_on   date,
  submitted_on  date,
  decided_on    date,
  paid_on       date,

  -- ── money ────────────────────────────────────────────────────────────────
  amount_sought numeric,            -- total asked for (defaults to the sum of items)
  amount_paid   numeric,            -- what actually landed

  -- ── the write-up ─────────────────────────────────────────────────────────
  summary       text,               -- the narrative sent to the channel
  notes         text,               -- internal comments

  -- ── gates. The form says the guest MUST be called before filing on Airbnb. ─
  guest_called      boolean not null default false,
  police_report     boolean not null default false,
  payment_verified  boolean not null default false,
  owner_adjusted    boolean not null default false,

  -- ── links out ────────────────────────────────────────────────────────────
  guesty_url    text,
  breezeway_url text,
  channel_case_id text,             -- the channel's own case/claim reference

  -- Did we write the note onto the reservation, and what did we last write?
  note_synced_at  timestamptz,
  note_sync_error text,

  assignee_email text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  -- Append-only trail: [{at, by, from, to, action, detail}]
  history       jsonb not null default '[]'::jsonb
);

-- One damaged/stolen thing. The channels reject a bundle, so this is the unit of evidence.
create table if not exists claim_items (
  id              uuid primary key default gen_random_uuid(),
  claim_id        uuid not null references claims(id) on delete cascade,
  position        integer not null default 0,

  description     text,
  -- 'new' | 'like new' | 'good' | 'fair' | 'worn' — free text so a new answer is not a migration.
  condition_prior text,
  age_text        text,             -- "2 years", "8 months" — as the form asks it
  cost            numeric,
  replacement_url text,             -- link to the like-kind replacement
  receipt_url     text,             -- receipt or screenshot of the replacement
  photo_urls      text[] not null default '{}',
  police_report   boolean not null default false,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_claims_stage    on claims(stage) where deleted_at is null;
create index if not exists idx_claims_deadline on claims(deadline_on) where deleted_at is null;
create index if not exists idx_claims_res      on claims(reservation_id) where deleted_at is null;
create index if not exists idx_claims_listing  on claims(listing_id) where deleted_at is null;
create index if not exists idx_claim_items     on claim_items(claim_id, position);

-- RLS on with NO permissive policy: every read and write goes through the service role inside our
-- own API routes, which is where the auth check lives. A leaked publishable key cannot read claims
-- (they contain guest names, dollar figures and case references).
alter table claims      enable row level security;
alter table claim_items enable row level security;

notify pgrst, 'reload schema';
