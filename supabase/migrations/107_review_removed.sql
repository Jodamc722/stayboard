-- REVIEWS THAT THE CHANNEL TOOK DOWN (2026-09-22).
--
-- Jon: "we also got a few reviews removed, not sure if guesty catches that but should."
-- It does not. /api/cron/sync-reviews pages the Guesty feed and UPSERTS by id, incrementally.
-- There is no delete path and no flag, so when Airbnb pulls a review, Guesty simply stops
-- returning it and our row stays forever -- still counted in every average an owner sees.
--
-- removed_at is the one source of truth for "this review no longer exists on the channel".
-- It is set by hand from /reviews (a person confirms it), never by the sync, so a bad page of
-- API results can never wipe reviews out from under us.
alter table guesty_reviews add column if not exists removed_at     timestamptz;
alter table guesty_reviews add column if not exists removed_by     text;
alter table guesty_reviews add column if not exists removed_reason text;

-- Every live read filters on this, so it earns an index.
create index if not exists guesty_reviews_removed_at_idx on guesty_reviews (removed_at);
