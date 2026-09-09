-- ATTACH THINGS TO A TASK, NOT ONLY TO THE PROJECT (Jon, 2026-09-09: "attach reservation, or
-- owners if it's assigned"). A task-level attachment is a project_links row with task_id set;
-- project-level rows keep task_id null. The old uniqueness (project, kind, ref) would have stopped
-- the same unit being attached to two tasks, so it becomes (project, kind, ref, task).
alter table project_links add column if not exists task_id uuid references project_steps(id) on delete cascade;
alter table project_links drop constraint if exists project_links_project_id_kind_ref_id_key;
create unique index if not exists project_links_unique_idx
  on project_links (project_id, kind, ref_id, coalesce(task_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists project_links_task_idx on project_links (task_id) where task_id is not null;
