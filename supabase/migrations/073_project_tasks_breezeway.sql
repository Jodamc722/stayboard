-- PROJECTS ↔ BREEZEWAY (Jon, 2026-09-09: "a fully integrated project board with Breezeway").
--
-- A project task can be SENT to Breezeway: a real task is created on a unit, assigned to the same
-- people, and its id is kept here. From then on the read path checks breezeway_tasks_sync and
-- marks the project task done when the field task finishes — the board follows the field, never
-- the other way round. Claims and glitches attach as project_links (kind 'claim' / 'glitch');
-- kind is free text there, so no schema change for those.
alter table project_steps add column if not exists breezeway_task_id text;
create index if not exists project_steps_bz_idx on project_steps (breezeway_task_id) where breezeway_task_id is not null;
