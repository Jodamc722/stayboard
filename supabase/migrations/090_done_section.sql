-- COMPLETED WORK MOVES OUT OF THE WAY (Jon, 2026-09-15: "have a default: when a task is completed,
-- it moves to a completed section in the project").
--
-- The move itself needs no schema — a section is just a text column on the task. What needs storing
-- is WHERE IT CAME FROM, so that reopening a task puts it back rather than stranding it in whatever
-- section happened to be first.
--
-- Without this, the obvious implementation is quietly lossy: tick a task by accident, untick it,
-- and it has forgotten it belonged to "Scheduled". On a vendor board, where the section IS the
-- lifecycle stage, that is not cosmetic — the job silently changes state.
alter table project_steps add column if not exists section_before_done text;

comment on column project_steps.section_before_done is
  'The section a task sat in before it was completed, so reopening it returns it there. Null once restored.';
