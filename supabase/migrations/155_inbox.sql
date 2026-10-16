-- THE INBOX (Jon, 2026-10-16: "we should have an inbox system / process for managing all this").
--
-- app_notifications was a bell: a row is read or unread, and that is all. An inbox needs a row to
-- be OPEN (needs me), DONE (handled), or SNOOZED (come back later), and to know WHICH THREAD it came
-- from so a reply can go straight back without opening the page. Nothing destructive: five nullable
-- or defaulted columns on the existing table. The code reads and writes without them until this
-- runs (status falls back to read/unread, reply falls back to Open).

alter table app_notifications
  add column if not exists status        text not null default 'open',   -- open | done | snoozed
  add column if not exists snoozed_until timestamptz,
  add column if not exists done_at       timestamptz,
  add column if not exists entity_type   text,                           -- the thread it came from (app_comments entity_type)
  add column if not exists entity_id     text;

create index if not exists app_notifications_inbox_idx on app_notifications (user_email, status, created_at desc);

-- Anything already read is handled.
update app_notifications set status = 'done', done_at = coalesce(done_at, now()) where read = true and status = 'open';
