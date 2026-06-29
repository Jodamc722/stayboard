-- Per-review "dismiss / no reply needed". Lets the team clear a review off the Needs-a-reply list
-- without posting a public reply. Reversible (undo restores it). Does NOT affect average/health scores.
alter table guesty_reviews add column if not exists dismissed boolean not null default false;
alter table guesty_reviews add column if not exists dismissed_by text;
alter table guesty_reviews add column if not exists dismissed_at timestamptz;
create index if not exists idx_guesty_reviews_dismissed on guesty_reviews (dismissed) where dismissed = true;
