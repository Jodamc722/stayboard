-- AREA FACTS (2026-10-05, Jon: "use photo and location address to share important local activities
-- and popular areas … setting expectation, painting a story and getting people to book").
--
-- One row per ~100 m grid cell (lat/lng to 3 decimals): the measured walk / drive times from that
-- spot to the curated South Florida places (lib/south-florida-places), computed by lib/local-area
-- on first use and refreshed after 60 days; plus the staff layer — places hidden for this spot,
-- places added by hand, per-place notes, a note about the spot. The listing copywriter is handed
-- this as a VERIFIED block it may quote by name and by minute.
create table if not exists area_facts (
  key          text primary key,            -- "26.122,-80.137"
  lat          double precision not null,
  lng          double precision not null,
  facts        jsonb not null default '{}'::jsonb,   -- { items: AreaItem[], routed: bool }
  edits        jsonb not null default '{}'::jsonb,   -- { hidden: [], added: [], notes: {}, spotNote, by, at }
  computed_at  timestamptz,
  created_at   timestamptz not null default now()
);
alter table area_facts disable row level security;
comment on table area_facts is 'Measured walk/drive times from a spot to the places guests book South Florida for, with staff edits. Read by the listing copywriter (lib/local-area).';
