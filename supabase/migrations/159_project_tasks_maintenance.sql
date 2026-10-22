-- 159 — THE MAINTENANCE & VENDORS BOARD (Jon, 2026-10-22: workflow columns New → Vendor Contact →
-- Scheduled → Waiting for Quote / Approval → Waiting for Parts → Follow-Up Needed → In Progress →
-- Completed; Miami / Broward; next action, last contact, follow-up date, quote, PDFs).
--
-- Four columns on the task. Everything else the brief asks for already had a home: the unit
-- (project_links kind=listing, task_id), the vendor (088), the follow-up date (due_on — the one
-- date that drives Late / Today / My tasks), notes (description + comments), PDFs (project_photos
-- kind=file in the private project-files bucket).
alter table project_steps
  add column if not exists location        text,     -- Miami | Broward; null = read it off the attached unit
  add column if not exists next_action     text,     -- the next move, in one line
  add column if not exists last_contact_on date,     -- when the vendor / owner was last reached
  add column if not exists quote_cents     bigint;   -- what the vendor quoted
notify pgrst, 'reload schema';
