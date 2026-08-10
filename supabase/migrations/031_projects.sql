-- PROJECT BOARD — the work that is NOT a task.
--
-- Today in Ops and Breezeway own tasks: a clean, a repair, a job that starts and ends inside a
-- day. A PROJECT is the other thing an ops team carries: a bathroom remodel, a lock rollout across
-- 34 units, taking on a building, writing an SOP. It runs for weeks, has a lead, usually has money
-- attached and often needs an owner to say yes before anyone moves.
--
-- Design notes:
--  • CATEGORY is free text against a seeded list, not an enum. Jon: "could be anything" — a new
--    kind of project must never need a migration.
--  • Links to units/reservations/tasks are rows in project_links, not columns. A project can touch
--    one unit, thirty-four units, or none at all, and the shape must not change.
--  • The share token is on the project so a vendor can be given exactly one project and nothing
--    else — same pattern the audit and vendor pages already use.
--  • Money and approval are nullable throughout. A project with no budget is normal.

create table if not exists projects (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,                      -- short human handle, e.g. PRJ-104
  title         text not null,
  summary       text,
  category      text not null default 'other',    -- see project_categories
  stage         text not null default 'idea',     -- idea | planned | in_progress | blocked | review | done | cancelled
  priority      text not null default 'normal',   -- low | normal | high | urgent
  lead_email    text,                             -- app_users.email
  market        text,                             -- Miami | Broward | North | Vendor, else null
  building      text,                             -- when the whole project is one building
  starts_on     date,
  due_on        date,
  done_on       date,

  -- Money. Budget is what was agreed, spent is what has gone out.
  budget_cents  bigint,
  spent_cents   bigint not null default 0,
  billable      boolean not null default false,   -- rebilled to the owner?

  -- Owner approval. A renovation somebody approved is a different animal from one nobody did.
  owner_id      text,                             -- guesty_owners id when known
  owner_name    text,
  approval      text not null default 'not_needed', -- not_needed | needed | requested | approved | declined
  approval_note text,
  approved_at   timestamptz,
  approved_by   text,

  -- Vendor share. Null token = not shared. Rotating the token revokes the old link.
  share_token   text unique,
  share_expires timestamptz,
  vendor_name   text,

  archived      boolean not null default false,
  sort          double precision,                 -- position within its stage column
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists projects_stage_idx    on projects (stage) where archived = false;
create index if not exists projects_due_idx      on projects (due_on) where archived = false;
create index if not exists projects_category_idx on projects (category);
create index if not exists projects_share_idx    on projects (share_token) where share_token is not null;

-- WHAT THE PROJECT TOUCHES. One row per linked thing, so a 34-unit rollout and a single-unit
-- remodel are the same shape. `done` lets a rollout track progress unit by unit.
create table if not exists project_links (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  kind        text not null,                      -- listing | reservation | task | owner | building
  ref_id      text not null,                      -- guesty listing id / reservation id / breezeway task id
  label       text,                               -- cached display name, so the board reads without joins
  done        boolean not null default false,
  note        text,
  created_at  timestamptz not null default now(),
  unique (project_id, kind, ref_id)
);
create index if not exists project_links_project_idx on project_links (project_id);
create index if not exists project_links_ref_idx     on project_links (kind, ref_id);

-- Milestones / checklist. Deliberately NOT tasks — these never reach Breezeway.
create table if not exists project_steps (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  title       text not null,
  done        boolean not null default false,
  due_on      date,
  assignee    text,
  sort        double precision,
  done_at     timestamptz,
  done_by     text,
  created_at  timestamptz not null default now()
);
create index if not exists project_steps_project_idx on project_steps (project_id);

-- Photos. Vendors upload through the share link, so uploaded_by may be a vendor name, not a user.
create table if not exists project_photos (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  url         text not null,
  caption     text,
  phase       text not null default 'during',     -- before | during | after
  uploaded_by text,
  via_share   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists project_photos_project_idx on project_photos (project_id);

-- Activity + comments in one stream, so the history reads in order.
create table if not exists project_notes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  kind        text not null default 'comment',    -- comment | event
  body        text not null,
  author      text,
  via_share   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists project_notes_project_idx on project_notes (project_id, created_at desc);

-- Categories are DATA, not code, so the team can add one without a deploy.
create table if not exists project_categories (
  key    text primary key,
  label  text not null,
  color  text not null default 'slate',
  sort   int  not null default 100,
  active boolean not null default true
);

insert into project_categories (key, label, color, sort) values
  ('renovation',  'Renovation',        'amber',   10),
  ('repair',      'Major repair',      'rose',    20),
  ('furnishing',  'Furniture & decor', 'violet',  30),
  ('rollout',     'Portfolio rollout', 'indigo',  40),
  ('onboarding',  'Building onboarding','emerald',50),
  ('offboarding', 'Offboarding',       'slate',   60),
  ('vendor',      'Vendor change',     'cyan',    70),
  ('compliance',  'Compliance & legal','rose',    80),
  ('internal',    'Internal / admin',  'slate',   90),
  ('other',       'Other',             'slate',  100)
on conflict (key) do nothing;

-- Reference counter for PRJ-### handles.
create sequence if not exists projects_ref_seq start 100;

create or replace function projects_set_ref() returns trigger as $$
begin
  if new.ref is null then
    new.ref := 'PRJ-' || nextval('projects_ref_seq');
  end if;
  new.updated_at := now();
  return new;
end $$ language plpgsql;

drop trigger if exists projects_ref_trigger on projects;
create trigger projects_ref_trigger before insert or update on projects
  for each row execute function projects_set_ref();

-- Service role only, like the rest of the app's admin tables. The public share page reads through
-- the server with the service key after checking the token, never straight from the browser.
alter table projects           enable row level security;
alter table project_links      enable row level security;
alter table project_steps      enable row level security;
alter table project_photos     enable row level security;
alter table project_notes      enable row level security;
alter table project_categories enable row level security;
