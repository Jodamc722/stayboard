-- A SCHEDULE LINK THAT ONLY SHOWS (Jon, 2026-09-14: "have a link by market area that just a view
-- of the schedule").
--
-- The per-market link already exists (067) and is a WORKING tool: the market team opens it, assigns
-- cleaners to the week and presses Submit. That is the right thing for the two or three people who
-- build the schedule, and the wrong thing to send to the twenty who only need to know where they
-- are going — every control on it is a chance for somebody to change the plan by accident on a
-- phone, and there is no undo on a schedule forty people have already read.
--
-- So: the same link, the same code, the same passcode and revoke, with the controls off. One flag
-- rather than a second kind of link, because a second table would mean two places to revoke access
-- and one of them would eventually be forgotten.
alter table public.schedule_links
  add column if not exists view_only boolean not null default false;

comment on column public.schedule_links.view_only is
  'Read-only link: the scheduler renders the week but hides assignment and Submit. Set at create.';

notify pgrst, 'reload schema';
