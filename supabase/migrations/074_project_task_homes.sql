-- A TASK IN MORE THAN ONE PROJECT (Jon, 2026-09-09: "assign to multiple projects that I am in").
--
-- Asana calls this multi-homing: one task, several projects, its own section in each. The task
-- keeps living in the project that made it (project_steps.project_id); every other project it
-- appears in is a row here, carrying the section and position it has THERE. Status, assignees,
-- comments and files are the task's own and therefore identical everywhere — that is the point.
create table if not exists project_task_homes (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references project_steps(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  section     text,
  sort        double precision,
  added_by    text,
  created_at  timestamptz not null default now(),
  unique (task_id, project_id)
);
create index if not exists project_task_homes_project_idx on project_task_homes (project_id);
alter table project_task_homes enable row level security;
