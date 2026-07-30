-- RESERVATION NOTICES — the arrival notification a building requires before a guest checks in.
--
-- Several buildings we operate in (Elser, Salato, Amrit, Nomad, District 225) will not admit a
-- guest unless their front desk has been told, in writing, who is arriving and when. One row here
-- = one booking we owe one building an email about. Recipients, wording, lead time and whether a
-- registration form is attached all live in app_settings key 'reservation_emails' (see
-- lib/reservation-emails.ts), NOT in this table — a building's address changing is not a schema
-- change.
--
-- NAMING: this is deliberately NOT called `reservation_reports`. That table already exists in this
-- same Supabase project, owned by the separate onboarding app, holding its ~165 historical Elser
-- rows. Sharing it would let two apps file the same booking twice and email a building twice.
-- StayBoard keeps its own table and its own history.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

create table if not exists reservation_notices (
  id                uuid primary key default gen_random_uuid(),

  -- Which building, and which of its units. property_id is the slug from the admin card
  -- ('elser', 'salato', …) so a row keeps pointing at the right config even if the display
  -- name is edited later.
  property_id       text not null,
  listing_id        text,
  unit_no           text not null,

  -- The guest, as the front desk needs to see them.
  guest_name        text not null,
  guest_phone       text,
  guest_email       text,

  arrival_date      date not null,
  departure_date    date,
  booking_date      date,
  eta               text,

  -- Guesty reports a guest TOTAL far more often than a split, so both stay nullable and the
  -- email drops the line rather than inventing a number.
  adults            integer,
  children          integer,
  pets              text,
  pet_breed         text,

  confirmation_code text,
  channel           text,

  -- Set when the row came from a Guesty reservation rather than being typed by hand. This is the
  -- dedupe anchor for the auto-pull, so a re-pull can never file the same booking twice.
  reservation_id    text,
  -- propertyId|unit|arrival|departure, lowercased. Covers the hand-typed path, where there is no
  -- reservation id to key on.
  dupe_key          text,

  -- Sending. sent_at is what moves a row off the desk; the PDF (Elser only) is recorded by path so
  -- a document living in StayBoard's own store is never confused with one in the onboarding Vault.
  sent_at           timestamptz,
  sent_by           text,
  doc_path          text,
  doc_name          text,

  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

-- One booking, one notice. Partial so soft-deleted rows free their key and a booking that was
-- deleted by mistake can be re-filed.
create unique index if not exists idx_rn_reservation
  on reservation_notices(reservation_id)
  where reservation_id is not null and deleted_at is null;

create unique index if not exists idx_rn_dupe
  on reservation_notices(dupe_key)
  where dupe_key is not null and deleted_at is null;

-- The desk reads "unsent, soonest arrival first" on every load; the lead-time warning reads the
-- same slice. Index the shape that query actually takes.
create index if not exists idx_rn_open
  on reservation_notices(arrival_date)
  where sent_at is null and deleted_at is null;

create index if not exists idx_rn_property on reservation_notices(property_id, arrival_date);
create index if not exists idx_rn_listing  on reservation_notices(listing_id);
create index if not exists idx_rn_created  on reservation_notices(created_at desc);

-- RLS: authenticated users read; writes are service-role only (the API routes), which bypasses
-- RLS. Same posture as the rest of the app's own tables.
alter table reservation_notices enable row level security;
drop policy if exists "authenticated read" on reservation_notices;
create policy "authenticated read" on reservation_notices for select to authenticated using (true);
