-- HOT-PATH INDEXES (2026-09-18). breezeway_tasks_sync is read by every board (Today in Ops, Command
-- Center, Scheduler, Labor, PM ledger) filtered on scheduled_date / property / finished_at and had
-- no index at all; the others are the filters the busiest pages use every request.
create index if not exists idx_bts_scheduled_date on breezeway_tasks_sync (scheduled_date);
create index if not exists idx_bts_property_date on breezeway_tasks_sync (reference_property_id, scheduled_date);
create index if not exists idx_bts_finished_at on breezeway_tasks_sync (finished_at);
create index if not exists idx_bts_status on breezeway_tasks_sync (status);
create index if not exists idx_guesty_reservations_check_out on guesty_reservations (check_out);
create index if not exists idx_guesty_reviews_created_at on guesty_reviews (created_at desc);
create index if not exists idx_guesty_reviews_listing on guesty_reviews (listing_id);
create index if not exists idx_app_notifications_user_unread on app_notifications (user_email, read);
