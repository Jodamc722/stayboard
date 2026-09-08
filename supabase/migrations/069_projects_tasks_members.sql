-- PROJECTS, WAVE 1 — THE TASK BECOMES THE ATOM.
--
-- Jon, 2026-09-08: an Asana-style board for operations projects and one-on-ones — multiple people
-- on a project, multiple on a task, due dates, and everything attachable to real Guesty data.
--
-- Migration 031 built the board with the PROJECT as the atom: a card, and inside it a thin checklist
-- (project_steps: title, done, one assignee). Everything Jon asked for — My Tasks, notifications on
-- a task, reminders, subtasks, templates — needs the TASK to be the thing that has identity. So this
-- migration promotes project_steps to real tasks IN PLACE: same table, same rows, new columns. No
-- existing project changes shape, and no step is renamed or moved.
--
-- Two new tables carry the two things a checklist row never had: who is ON the project (which is
-- also the privacy boundary), and several people on one task.

-- ── 1. project_steps grows into tasks ───────────────────────────────────────────────────────────
alter table project_steps add column if not exists description  text;
alter table project_steps add column if not exists status       text not null default 'todo';   -- todo | doing | blocked | done
alter table project_steps add column if not exists section      text;                            -- "Wins", "Blockers", "Scope" — free text against the template
alter table project_steps add column if not exists parent_id    uuid references project_steps(id) on delete cascade;
alter table project_steps add column if not exists updated_at   timestamptz not null default now();
alter table project_steps add column if not exists created_by   text;
alter table project_steps add column if not exists priority     text not null default 'normal'; -- low | normal | high | urgent

-- `done` predates `status`. Keep both honest: done is derived from status so old readers keep
-- working and new ones see the four states. A trigger, not application code — there are three
-- writers already and there will be more.
create or replace function project_steps_sync_done() returns trigger language plpgsql as $$
begin
  if new.status = 'done' then
    new.done := true;
    if new.done_at is null then new.done_at := now(); end if;
  else
    new.done := false;
    new.done_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists project_steps_sync_done_trg on project_steps;
create trigger project_steps_sync_done_trg before insert or update on project_steps
  for each row execute function project_steps_sync_done();

-- Old rows: done=true means status='done'. Run once; the trigger keeps it true from here.
update project_steps set status = 'done' where done = true and status <> 'done';

create index if not exists project_steps_parent_idx  on project_steps (parent_id) where parent_id is not null;
create index if not exists project_steps_due_idx     on project_steps (due_on) where status <> 'done';
create index if not exists project_steps_section_idx on project_steps (project_id, section);

-- ── 2. who is on a project — and therefore who can see it ───────────────────────────────────────
-- Jon chose "members only, plus owner": a project is visible to the people added to it and to the
-- superadmin. There is no other visibility rule, so this table IS the access control list. A
-- person is an email when they have a login (notifiable) or a roster name when they do not
-- (nameable, not notifiable); person_key is the shared-matcher normal form so the same human is
-- never two rows.
create table if not exists project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  person_key  text not null,                 -- lib/person-name personKey()
  display     text not null,                 -- the spelling to show
  email       text,                          -- app_users.email when they have a login
  role        text not null default 'editor', -- owner | editor | viewer
  notify      jsonb not null default '{"mentions":true,"assigned":true,"digest":true,"comments":true}',
  added_by    text,
  created_at  timestamptz not null default now(),
  unique (project_id, person_key)
);
create index if not exists project_members_person_idx on project_members (person_key);
create index if not exists project_members_email_idx  on project_members (email) where email is not null;

-- ── 3. several people on one task ───────────────────────────────────────────────────────────────
-- The old single `assignee` text column stays for old readers and is kept in sync (first assignee)
-- by the API, never by hand.
create table if not exists project_task_assignees (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references project_steps(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,  -- denormalised: My Tasks reads by person without a join
  person_key  text not null,
  display     text not null,
  email       text,
  created_at  timestamptz not null default now(),
  unique (task_id, person_key)
);
create index if not exists project_task_assignees_person_idx on project_task_assignees (person_key);
create index if not exists project_task_assignees_email_idx  on project_task_assignees (email) where email is not null;

-- ── 4. the project learns three things ──────────────────────────────────────────────────────────
alter table projects add column if not exists private       boolean not null default false;  -- a 1:1; true means the members list is the whole audience
alter table projects add column if not exists template_key  text;                            -- which template made it, if any
alter table projects add column if not exists recurs        jsonb;                           -- {"every":"week","weekday":1} — Wave 4 reads this; nothing writes it yet
alter table projects add column if not exists kind          text not null default 'project'; -- project | one_on_one — the two shapes the board draws differently

-- ── 5. backfill: every existing project's lead and creator are members ──────────────────────────
-- Otherwise switching on privacy would lock everyone out of everything they already own. The
-- person_key here is a plain lower-case of the email — the API rewrites it with the real matcher on
-- first touch, and an email is already unique enough to never collide with a name.
insert into project_members (project_id, person_key, display, email, role, added_by)
select p.id, lower(p.lead_email), p.lead_email, p.lead_email, 'owner', 'migration-069'
from projects p
where p.lead_email is not null and p.lead_email <> ''
on conflict (project_id, person_key) do nothing;

insert into project_members (project_id, person_key, display, email, role, added_by)
select p.id, lower(p.created_by), p.created_by, p.created_by, 'owner', 'migration-069'
from projects p
where p.created_by is not null and p.created_by like '%@%'
on conflict (project_id, person_key) do nothing;

-- Existing single assignees become assignee rows, so nothing already on a step is lost.
insert into project_task_assignees (task_id, project_id, person_key, display, email)
select s.id, s.project_id, lower(trim(s.assignee)), trim(s.assignee),
       case when s.assignee like '%@%' then lower(trim(s.assignee)) else null end
from project_steps s
where s.assignee is not null and trim(s.assignee) <> ''
on conflict (task_id, person_key) do nothing;
