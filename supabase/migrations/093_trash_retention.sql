-- SIXTY DAYS BEFORE A DELETE IS FINAL.
--
-- Jon, 2026-09-16: "Deleted projects go to a trash section but take 60 days for permanent delete
-- unless deleted by admin."
--
-- The graveyard in migration 019 already photographs a row before deleting it, so Restore is a real
-- button. What it had no concept of was TIME: a photograph sat there until somebody purged it by
-- hand, which in practice meant forever. This adds the clock.
--
-- WHY THE DATE IS STORED RATHER THAN COMPUTED. `deleted_at + 60 days` would be one fewer column and
-- wrong the first time the policy changes: every existing row would silently move its own deadline.
-- A stamped date is a promise made at the moment of deletion and kept, and it lets one record be
-- given longer than the rest without special-casing anything.
alter table deleted_records
  add column if not exists purge_after timestamptz not null default (now() + interval '60 days');

-- Rows deleted before today have no deadline yet. Give them the full 60 days from now rather than
-- from when they were deleted: nobody was told about a clock that did not exist, so starting it
-- retroactively could purge something this afternoon that a person still expects to be able to
-- restore.
update deleted_records
   set purge_after = now() + interval '60 days'
 where purge_after is null;

-- What the nightly sweep reads: unrestored records whose time is up.
create index if not exists deleted_records_purge_idx
  on deleted_records (purge_after)
  where restored_at is null;

comment on column deleted_records.purge_after is
  'When this may be removed for good. Set at delete time, not derived, so changing the policy never moves an existing promise.';

notify pgrst, 'reload schema';
