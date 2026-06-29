-- Auto-Sensitive tracking: when the sentiment scan auto-flagged this conversation's guest as Sensitive.
alter table guesty_conversation_sentiment add column if not exists marked_sensitive_at timestamptz;

-- Backfill conversation guest/reservation/listing from the embedded raw.meta
-- (the sync had been reading the wrong path, so all 3 were null).
update guesty_conversations c set
  guest_name     = coalesce(nullif(c.guest_name, ''), c.raw->'meta'->'guest'->>'fullName'),
  reservation_id = coalesce(c.reservation_id, c.raw->'meta'->'reservations'->0->>'_id'),
  listing_id     = coalesce(c.listing_id, c.raw->'meta'->'reservations'->0->'listing'->>'_id')
where c.raw->'meta' is not null;
