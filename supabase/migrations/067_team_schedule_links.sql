-- TEAM SCHEDULER LINKS (Jon, 2026-09-03).
--
-- "Create a scheduler shareable link for our Miami and Broward teams, where they can just go into
--  the scheduler and schedule directly from that link. Once their schedule is submitted, they'll
--  click submit, and that will get an email sent directly to me, where I can review it and send
--  any notes or feedback."
--
-- One link per market. The link is the capability (no login); an optional passcode adds a second
-- factor. Picks made through the link land in schedule_staged exactly like a pick on /schedule
-- (the board already shows staged rows as "proposed"), so Jon reviews in the tool he already uses
-- and pushes to Breezeway the same way. A submission is a snapshot of the market's week at the
-- moment the team pressed Submit, plus Jon's feedback back to them.
create table if not exists public.schedule_links (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  market      text not null,                       -- Miami | Broward | North
  label       text,
  passcode    text,                                -- optional
  created_by  text,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create table if not exists public.schedule_submissions (
  id            uuid primary key default gen_random_uuid(),
  link_code     text not null,
  market        text not null,
  week_start    date not null,
  week_end      date not null,
  submitted_by  text,                              -- the name typed on the phone
  note          text,                              -- what the team wants Jon to know
  snapshot      jsonb not null default '[]'::jsonb, -- [{date, unit, listingId, cleaner, cleanerId, sameDayTurn, checkOutTime}]
  status        text not null default 'submitted', -- submitted | reviewed
  feedback      text,                              -- Jon's notes back to the team
  reviewed_by   text,
  reviewed_at   timestamptz,
  emailed_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists schedule_submissions_link_idx on public.schedule_submissions (link_code, created_at desc);

alter table public.schedule_links enable row level security;
alter table public.schedule_submissions enable row level security;
notify pgrst, 'reload schema';
