-- ---------------------------------------------------------------------------------------------
-- What Eve has actually LOOKED AT (Jon, 2026-08-24: "what makes you better is you can see things
-- too").
--
-- One row per photograph she has opened, holding what is in it rather than a score for it. The id
-- is listing_id plus a hash of the URL, so looking at the same photo twice updates one row instead
-- of growing a duplicate, and a photo that gets replaced in Guesty simply becomes unseen again.
--
-- There is no big-bang backfill behind this table. A small nightly quota works through the
-- worst-covered units first, so the portfolio comes into focus over weeks — cheaper, self-healing
-- when new photos land, and a failed night costs a night rather than a whole run.
-- ---------------------------------------------------------------------------------------------
create table if not exists listing_photo_vision (
  id         text primary key,        -- listing_id + ':' + sha256(url)[0:16]
  listing_id text not null,
  url        text not null,
  room       text,                    -- kitchen | bedroom | bathroom | living | balcony | exterior | …
  label      text,                    -- what the photo shows, concretely
  appliance  text,                    -- named when a specific appliance or fixture is the subject
  quality    integer,                 -- 1-5, how usable the photograph is
  notes      text,                    -- damage, wear, clutter, dated fittings — what an operator would want
  model      text,
  seen_at    timestamptz not null default now()
);

create index if not exists listing_photo_vision_listing_idx on listing_photo_vision (listing_id);
create index if not exists listing_photo_vision_room_idx    on listing_photo_vision (room);
create index if not exists listing_photo_vision_appliance_idx on listing_photo_vision (appliance) where appliance is not null;

alter table listing_photo_vision enable row level security;
