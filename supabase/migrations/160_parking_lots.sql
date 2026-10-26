-- 160 — PARKING LOTS WE RUN OURSELVES (Jon, 2026-10-26).
--
-- "A Parking management tab for Eden and other properties. We have 10 spots, it's $30 per day, and
-- we need to track make and model and the parking spot they reserved, so we can enforce and tow.
-- Calendar view. 10 spots, 3 extra for space and for our staff — never sell. Add reservation
-- details, car make and model and plate number. A link we can share with our staff to check / scan
-- car plates and flag unregistered cars. Once each car is scanned, every car that is not ours gets
-- flagged, a message goes to all guests — they get 1 hour or the car is towed — and then an email
-- to our tow company is drafted."
--
-- This is NOT the 093 parking-permit flow. 093 is the garage at 17 West issuing QR codes that we
-- hand to guests. Here the lot is OURS: physical spots we sell by the night, enforce ourselves and
-- clear with a tow truck. Different thing, different tables; the two never read each other.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- A LOT belongs to one building and has its price, its tow company and the staff link's code.
-- A SPOT is a numbered space in that lot. `kind` says whether it is sold: 'sell' is on the calendar
--   for guests; 'hold' is staff and manoeuvring room and is never sold (Jon: "3 extra for space and
--   for our staff, never sell"). A hold spot still appears on the calendar — a staff car is still a
--   car the sweep has to recognise — it just cannot carry a guest booking.
-- A BOOKING is one car in one spot for a run of nights. Nights, like room nights: starts_on is the
--   first night, ends_on is the morning it leaves, so a car leaving on the 30th and one arriving on
--   the 30th share the spot the way two stays share a unit. Plate is the key the sweep matches on.
-- A SWEEP is one walk of the lot by a staff member: spot by spot, what was there. It is saved as it
--   happens, so a phone that dies halfway loses one spot, not the walk.
-- An INCIDENT is a car that should not be where it is — unregistered, in the wrong spot, blocking.
--   It carries the whole enforcement chain: when the 1-hour notice went to the guests, when the hour
--   is up, the tow draft, the tow. That is the record Jon needs when an owner disputes a tow.

create table if not exists parking_lots (
  id              uuid primary key default gen_random_uuid(),
  -- Canonical building label from lib/segments ('Eden'), never raw Guesty text.
  building        text not null,
  name            text not null,
  rate_cents      integer not null default 3000,   -- per night
  currency        text not null default 'USD',
  -- Where the tow truck goes and who to call. All optional until Jon fills them in Settings.
  address         text,
  tow_company     text,
  tow_email       text,
  tow_phone       text,
  -- The lot's own rules, shown on the staff page and quoted in the notice.
  rules           text,
  -- How long a guest gets after the notice before the tow email is drafted (Jon: one hour).
  notice_minutes  integer not null default 60,
  -- THE STAFF LINK. /lot/<share_code> — no login; the code is the capability (like /count and
  -- /board). Regenerating it kills the old link. The passcode is optional and checked server-side.
  share_code      text not null unique,
  share_passcode  text,
  active          boolean not null default true,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists parking_lots_building_idx on parking_lots (lower(building)) where active;

create table if not exists parking_spots (
  id       uuid primary key default gen_random_uuid(),
  lot_id   uuid not null references parking_lots(id) on delete cascade,
  label    text not null,                        -- "1" … "10", "S1"
  kind     text not null default 'sell' check (kind in ('sell', 'hold')),
  sort     integer not null default 0,
  active   boolean not null default true,
  note     text                                  -- "compact only", "by the gate"
);
create index if not exists parking_spots_lot_idx on parking_spots (lot_id, sort);

create table if not exists parking_bookings (
  id              uuid primary key default gen_random_uuid(),
  lot_id          uuid not null references parking_lots(id) on delete cascade,
  spot_id         uuid not null references parking_spots(id),
  -- guest = sold to a stay · staff / owner / vendor = ours, never charged · block = spot out of use
  kind            text not null default 'guest' check (kind in ('guest', 'staff', 'owner', 'vendor', 'block')),
  -- The stay it belongs to, when it does. Null for staff and blocks.
  reservation_id  text,
  listing_id      text,
  unit            text,
  guest_name      text,
  guest_phone     text,
  -- Nights: [starts_on, ends_on). ends_on is the morning the car leaves.
  starts_on       date not null,
  ends_on         date not null check (ends_on > starts_on),
  -- The car. plate_norm is upper-case alphanumerics only — the thing the sweep matches on.
  plate           text,
  plate_norm      text,
  plate_state     text,
  make            text,
  model           text,
  color           text,
  -- Money. rate is the lot's rate the night it was booked (a price change never rewrites history);
  -- amount is what was actually agreed, editable.
  rate_cents      integer not null default 0,
  amount_cents    integer not null default 0,
  paid            text not null default 'unpaid' check (paid in ('unpaid', 'paid', 'comped', 'na')),
  paid_via        text,                          -- guesty | cash | card | zelle | other
  paid_at         timestamptz,
  paid_by         text,
  status          text not null default 'reserved' check (status in ('reserved', 'parked', 'left', 'cancelled', 'no_show')),
  notes           text,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists parking_bookings_lot_dates_idx on parking_bookings (lot_id, starts_on, ends_on);
create index if not exists parking_bookings_plate_idx on parking_bookings (lot_id, plate_norm);
create index if not exists parking_bookings_res_idx on parking_bookings (reservation_id);

-- ONE CAR PER SPOT PER NIGHT, enforced by the database and not only by the form. The app checks
-- first and says which booking is in the way; this is the backstop for two people booking the same
-- spot at the same second. Wrapped so a project without btree_gist still gets the tables.
do $$
begin
  -- uuid = inside a GiST index needs btree_gist (Supabase ships it; it is just not on by default).
  execute 'create extension if not exists btree_gist with schema extensions';
  alter table parking_bookings
    add constraint parking_bookings_no_overlap
    exclude using gist (spot_id with =, daterange(starts_on, ends_on, '[)') with &&)
    where (status not in ('cancelled', 'no_show'));
exception when others then
  raise notice 'parking_bookings_no_overlap not added: %', sqlerrm;
end $$;

create table if not exists parking_sweeps (
  id           uuid primary key default gen_random_uuid(),
  lot_id       uuid not null references parking_lots(id) on delete cascade,
  sweep_date   date not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  by_name      text,
  -- One entry per spot checked: { spotId, label, result: match|empty|other|extra, plate, make,
  -- model, color, verdict: ok|wrong_spot|unregistered|staff_in_sell, bookingId, at }
  checks       jsonb not null default '[]'::jsonb,
  n_checked    integer not null default 0,
  n_matched    integer not null default 0,
  n_empty      integer not null default 0,
  n_flagged    integer not null default 0
);
create index if not exists parking_sweeps_lot_idx on parking_sweeps (lot_id, started_at desc);

create table if not exists parking_incidents (
  id               uuid primary key default gen_random_uuid(),
  lot_id           uuid not null references parking_lots(id) on delete cascade,
  spot_id          uuid references parking_spots(id),
  spot_label       text,                         -- snapshot, so the record survives a relabel
  sweep_id         uuid references parking_sweeps(id),
  -- unregistered = no booking knows this plate · wrong_spot = booked, parked elsewhere ·
  -- staff_in_sell = a staff car in a sellable spot · blocking · other
  kind             text not null default 'unregistered' check (kind in ('unregistered', 'wrong_spot', 'staff_in_sell', 'blocking', 'other')),
  booking_id       uuid references parking_bookings(id),
  plate            text,
  plate_norm       text,
  plate_state      text,
  make             text,
  model            text,
  color            text,
  photo_path       text,                         -- private bucket parking-photos, never a URL
  seen_at          timestamptz not null default now(),
  seen_by          text,
  -- open → notified (the hour is running) → tow_drafted (email waiting in Drafts) → towed;
  -- or resolved (moved / registered / left) or dismissed (it was ours after all).
  status           text not null default 'open' check (status in ('open', 'notified', 'tow_drafted', 'towed', 'resolved', 'dismissed')),
  notice_text      text,
  notice_sent_at   timestamptz,
  notice_sent_n    integer not null default 0,
  notice_sent_by   text,
  notice_log       jsonb not null default '[]'::jsonb,   -- [{ reservationId, guest, unit, ok, error }]
  tow_due_at       timestamptz,
  tow_draft_id     text,
  tow_drafted_at   timestamptz,
  tow_draft_error  text,
  tow_to           text,
  towed_at         timestamptz,
  towed_by         text,
  resolved_at      timestamptz,
  resolved_by      text,
  resolution       text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists parking_incidents_lot_open_idx on parking_incidents (lot_id, status, seen_at desc);
create index if not exists parking_incidents_due_idx on parking_incidents (tow_due_at) where status = 'notified';

-- Service role only, like every table carrying guest data (061_rls_lockdown).
alter table parking_lots      enable row level security;
alter table parking_spots     enable row level security;
alter table parking_bookings  enable row level security;
alter table parking_sweeps    enable row level security;
alter table parking_incidents enable row level security;

-- Photos of the cars the sweep flags — evidence for the tow company. PRIVATE: read through
-- short-lived signed URLs only (the same rule as parking-qr and project-files).
insert into storage.buckets (id, name, public)
  values ('parking-photos', 'parking-photos', false)
  on conflict (id) do nothing;

-- ── EDEN, DAY ONE ───────────────────────────────────────────────────────────────────────────────
-- 10 sellable spots at $30 a night, numbered 1–10, and 3 held spots (S1–S3) for staff and room to
-- manoeuvre that are never sold. Idempotent: a second run adds nothing.
do $$
declare
  lot uuid;
  i integer;
begin
  select id into lot from parking_lots where lower(building) = 'eden' and active limit 1;
  if lot is null then
    insert into parking_lots (building, name, rate_cents, notice_minutes, share_code, rules, created_by)
    values ('Eden', 'Eden parking', 3000, 60, substr(replace(gen_random_uuid()::text, '-', ''), 1, 14),
            'Parking is $30 per night, one space per reservation, in the spot you were given. Unregistered vehicles are towed at the owner''s expense.',
            'migration 160')
    returning id into lot;
    for i in 1..10 loop
      insert into parking_spots (lot_id, label, kind, sort) values (lot, i::text, 'sell', i);
    end loop;
    for i in 1..3 loop
      insert into parking_spots (lot_id, label, kind, sort, note) values (lot, 'S' || i::text, 'hold', 100 + i, 'Staff & buffer — never sold');
    end loop;
  end if;
end $$;

-- ── WHO SEES THE TAB ────────────────────────────────────────────────────────────────────────────
-- admin and manager inherit it through '*'. The people who actually run a lot — front desk and
-- field ops — get edit; full (settings, deleting, the staff link) stays with managers.
update app_roles set perms = jsonb_set(perms, '{parking}', '"edit"', true)
 where key in ('cs', 'cs_manager', 'ops') and not (perms ? 'parking');

notify pgrst, 'reload schema';
