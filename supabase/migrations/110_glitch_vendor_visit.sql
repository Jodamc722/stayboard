-- A VENDOR ON A GLITCH IS A VISIT (2026-09-25). Picking a vendor on a glitch (109) told nobody
-- anything. The project board already has the shape — who is coming, when, has the team been
-- told (088) — so the glitch gets the same three facts, and "Tell the team" posts to the
-- building's maintenance room the way the board's notice reaches the board.
alter table glitches add column if not exists vendor_visit_on      date;
alter table glitches add column if not exists vendor_visit_window  text;
alter table glitches add column if not exists vendor_team_told_at  timestamptz;
alter table glitches add column if not exists vendor_team_told_for date;
