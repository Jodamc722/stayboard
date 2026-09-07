-- FIELD vs OFFICE (Jon, 2026-09-07: "Carla and Roberto, for example, I'm okay with their tasks
-- showing, but they are not in the field, technically").
--
-- One boolean on the roster. true (default) = works in the units and buildings; false = office /
-- coordination. What it changes, everywhere at once:
--   • the PREDOMINANT doer of a shared Breezeway task is the first FIELD assignee — an office
--     person on the same task is shown, never credited as the one who did it;
--   • field rosters in the ops briefs list field people; office people get their own strip;
--   • nothing about pay — cost, crew and market are untouched.
alter table if exists public.staff
  add column if not exists field boolean not null default true;

update public.staff set field = false
 where lower(name) in ('roberto chiriboga', 'karla valle', 'carla valle');
