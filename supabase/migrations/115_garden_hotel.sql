-- THE GARDEN HOTEL — its own tables, separate from the VR business (Jon, 2026-09-28: "We have
-- Lighthouse for Stay Hospitality VR, and then I want to build another database for the Garden
-- Hotel. We're going to connect to Cloudbeds… track and manage operations and cleans, build reports
-- from calls and verifications, basically mirroring what we built for the VR." / "I would call it
-- just the Garden Hotel, not Stay Hospitality.")
--
-- Every table is prefixed garden_ and NOTHING here joins to guesty_* or breezeway_*: the hotel is a
-- different property system (Cloudbeds), a different unit model (rooms, not listings) and a
-- different day (front desk, not turnovers). The mirror tables hold what Cloudbeds says, keyed by
-- Cloudbeds' own ids, with the raw payload kept so a later column can be back-filled without a
-- resync. The work tables (cleans, calls, verifications) are ours.

-- 1) Rooms — the physical inventory. One row per Cloudbeds roomID.
create table if not exists garden_rooms (
  id           text primary key,                 -- Cloudbeds roomID
  name         text not null,                    -- "101", "Garden Suite 2"
  room_type_id text,
  room_type    text,
  floor        text,
  max_guests   int,
  status       text not null default 'active',   -- active | blocked | out_of_order
  hk_status    text,                             -- clean | dirty | inspected (Cloudbeds roomCondition)
  occupied     boolean,
  hk_updated_at timestamptz,
  raw          jsonb,
  synced_at    timestamptz not null default now()
);

-- 2) Reservations — the hotel's bookings. One row per Cloudbeds reservationID.
create table if not exists garden_reservations (
  id            text primary key,                -- Cloudbeds reservationID
  status        text,                            -- confirmed | not_confirmed | checked_in | checked_out | canceled | no_show
  guest_name    text,
  guest_email   text,
  guest_phone   text,
  check_in      date,
  check_out     date,
  nights        int,
  adults        int,
  children      int,
  room_ids      text[] not null default '{}',
  room_names    text[] not null default '{}',
  source        text,                            -- booking channel
  total         numeric,
  balance       numeric,
  booked_at     timestamptz,
  modified_at   timestamptz,
  raw           jsonb,
  synced_at     timestamptz not null default now()
);
create index if not exists garden_res_check_in  on garden_reservations (check_in);
create index if not exists garden_res_check_out on garden_reservations (check_out);
create index if not exists garden_res_status    on garden_reservations (status);

-- 3) Housekeeping / ops work — cleans, inspections, deep cleans, maintenance. Ours, per room per day.
create table if not exists garden_tasks (
  id            uuid primary key default gen_random_uuid(),
  room_id       text references garden_rooms (id) on delete set null,
  room_name     text,
  date          date not null,
  kind          text not null default 'clean',   -- clean | stayover | inspection | deep_clean | maintenance
  status        text not null default 'open',    -- open | in_progress | done | cancelled
  assigned_to   text,
  reservation_id text,
  source        text not null default 'lighthouse', -- lighthouse | cloudbeds | auto
  priority      text,                            -- arrival | vip | none
  note          text,
  started_at    timestamptz,
  finished_at   timestamptz,
  finished_by   text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists garden_tasks_date on garden_tasks (date, status);

-- 4) Calls — the front-desk phone log, mirroring the VR Calls desk (welcome / pre-arrival /
--    verification / post-stay). One row per attempt.
create table if not exists garden_calls (
  id             uuid primary key default gen_random_uuid(),
  reservation_id text references garden_reservations (id) on delete set null,
  guest_name     text,
  kind           text not null default 'pre_arrival',  -- pre_arrival | welcome | verification | post_stay | other
  outcome        text,                                 -- reached | voicemail | no_answer | wrong_number | declined
  called_at      timestamptz not null default now(),
  called_by      text,
  duration_min   int,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists garden_calls_res on garden_calls (reservation_id);

-- 5) Verifications — ID / card / deposit / signature checks per reservation.
create table if not exists garden_verifications (
  id             uuid primary key default gen_random_uuid(),
  reservation_id text references garden_reservations (id) on delete cascade,
  kind           text not null default 'id',    -- id | card | deposit | agreement | age
  status         text not null default 'pending', -- pending | passed | failed | waived
  checked_at     timestamptz,
  checked_by     text,
  note           text,
  created_at     timestamptz not null default now(),
  unique (reservation_id, kind)
);

-- 6) Sync ledger — one row per entity, like guesty_sync_status but for the hotel.
create table if not exists garden_sync_status (
  entity       text primary key,                 -- rooms | reservations | housekeeping
  last_sync_at timestamptz,
  last_error   text,
  count        int
);

-- 7) Permissions: one page key ('garden') gates every /garden tab. Admin sees all; give GM full so
--    Jon's leads can open it, everyone else stays off until switched on in /users → Roles.
update app_roles
   set perms = coalesce(perms, '{}'::jsonb) || '{"garden":"full"}'::jsonb
 where key in ('gm', 'admin', 'owner') and not (coalesce(perms, '{}'::jsonb) ? 'garden');
