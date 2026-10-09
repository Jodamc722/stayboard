-- A COMMENT THREAD THE OWNER IS PART OF (Jon, 2026-10-09: "we can comment on each item ... and tag").
--
-- Until now the share link showed only what was written THROUGH it (via_share). That is right for
-- a vendor — a contractor should not read the team talking — but it makes a two-way conversation
-- impossible on a board we hand to an owner: they write, and nothing we say ever comes back.
--
-- So a note can now be marked shared. The default is FALSE on purpose: every comment already in
-- the table stays internal, so turning this on cannot retroactively expose a single word anyone
-- wrote before today. Going forward, a task comment on a board that HAS a live share link is
-- posted shared unless the author ticks "internal", and that choice is shown on the box.
alter table project_notes add column if not exists shared boolean not null default false;

-- Who was tagged, by display name, so the link can show "Carlo" rather than a key nobody outside
-- the app would recognise. Names, not emails — the roster leaves the building with this link.
alter table project_notes add column if not exists mentions jsonb not null default '[]'::jsonb;

create index if not exists project_notes_task_idx on project_notes (task_id, created_at desc) where task_id is not null;
