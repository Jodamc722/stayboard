-- NEW UNIT INTAKE (Jon, 2026-10-13: "create a place in properties to add new unit").
--
-- A unit becomes real in four moves: somebody answers the questions, the answers are checked,
-- Guesty gets a listing, and a human connects that listing to each channel. Only the third move
-- is an API call. The first two have been living in somebody's head and a WhatsApp thread, and
-- the fourth is invisible until a guest fails to book — so this table holds all four.
--
-- ONE JSONB, NOT FORTY COLUMNS. The intake asks about address, rates, wifi, door codes, linens
-- and photos, and that list will keep moving. Columns we query on are columns; the answers are
-- `data`, so adding a question is a code change and not a migration.
--
-- `channels` is a hand-kept record of the publish step the Guesty API cannot do (confirmed
-- 2026-10-13: no publish endpoint, POST /integrations deprecated). The read side — whether a
-- listing is actually connected — already comes from guesty_listings.raw.integrations[] on
-- /channels. This column is what someone INTENDED, so a half-finished go-live is visible.
create table if not exists unit_intake (
  id          uuid primary key default gen_random_uuid(),
  nickname    text not null,
  building    text,
  -- draft → answers being collected · ready → passes the gate · pushed → exists in Guesty · live → selling
  status      text not null default 'draft',
  data        jsonb not null default '{}'::jsonb,
  channels    jsonb not null default '{}'::jsonb,
  listing_id  text,
  push_error  text,
  pushed_at   timestamptz,
  live_at     timestamptz,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists unit_intake_status_idx  on unit_intake (status);
create index if not exists unit_intake_updated_idx on unit_intake (updated_at desc);
