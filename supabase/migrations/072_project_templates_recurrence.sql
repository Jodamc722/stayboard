-- PROJECTS, WAVE 4 — TEMPLATES, RECURRENCE, PERSONAL BOARDS AND CUSTOMISATION.
--
-- Jon, 2026-09-08: "templates", "the Monday 1:1 that creates itself", and "users can create their
-- own project boards that are private to them, just like Asana, and customise the board however
-- they want".
--
-- Three small additions, nothing destructive:
--   • project_templates — the team's own saved templates. Built-in ones live in code
--     (lib/project-templates.ts); a row here with the same key overrides the built-in.
--   • projects.settings — how THIS board looks: list or columns, accent, hide done, section order.
--     A jsonb so a new preference never needs a migration.
--   • projects.series_key — ties the instances of a recurring project together ("1:1 — Roberto"
--     every Monday is one series, many projects). `recurs` (from 069) holds the schedule and lives
--     on the LATEST instance only.

create table if not exists project_templates (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,           -- slug; same as a built-in's key to override it
  label       text not null,
  kind        text not null default 'project', -- project | one_on_one | personal
  category    text not null default 'other',
  summary     text,
  body        jsonb not null,                  -- { sections: [{ name, tasks: [{ title, description?, priority?, dueOffsetDays? }] }], settings?, recurs? }
  created_by  text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table project_templates enable row level security;

alter table projects add column if not exists settings   jsonb not null default '{}';
alter table projects add column if not exists series_key text;
create index if not exists projects_series_idx on projects (series_key) where series_key is not null;
create index if not exists projects_recurs_idx on projects ((recurs->>'next_on')) where recurs is not null;
