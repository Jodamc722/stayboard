-- THE FIELD TASK'S OWN STORY, WRITTEN DOWN (Jon, 2026-10-09: "it should also have a note that a
-- task was created, that it's in progress, that it's scheduled, and that it's done. It should
-- auto-do it based on the Breezeway task").
--
-- The board already mirrors a Breezeway status, but only ever as a badge showing NOW. An owner
-- opening a job a week later could see "completed" and learn nothing about when it was scheduled,
-- when somebody started, or how long it sat. The status is a fact; the sequence is the story.
--
-- So the last status we saw is remembered, and every time it CHANGES the board writes one line
-- into that job's thread. This column is the memory that makes "changed" meaningful — without it
-- every read would either repeat itself or say nothing.
alter table project_steps add column if not exists bz_status text;
alter table project_steps add column if not exists bz_seen_at timestamptz;
