-- Durable StayBoard annotations: dedicated columns the Guesty sync never overwrites, so the
-- "last optimized" date, photo score, and just-pushed amenities stop getting wiped on re-sync.
alter table guesty_listings
  add column if not exists last_optimized timestamptz,
  add column if not exists last_recreated timestamptz,
  add column if not exists photo_score jsonb,
  add column if not exists amenities_pushed_at timestamptz;

-- Backfill from the values that were being stored inside the raw blob.
update guesty_listings set last_optimized = (raw->>'_lastOptimized')::timestamptz where (raw ? '_lastOptimized') and last_optimized is null;
update guesty_listings set last_recreated = (raw->>'_lastRecreated')::timestamptz where (raw ? '_lastRecreated') and last_recreated is null;
update guesty_listings set photo_score = raw->'_photoScore' where (raw ? '_photoScore') and photo_score is null;
