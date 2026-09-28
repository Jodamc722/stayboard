-- OPEN LOOPS page (Jon, 2026-09-28): the page behind Eve's "Keeping tabs". Every role can see it and
-- close a loop; roles that already say something about it keep their answer.
update app_roles
   set perms = coalesce(perms, '{}'::jsonb) || '{"loops":"edit"}'::jsonb
 where not (coalesce(perms, '{}'::jsonb) ? 'loops');
