-- THE STAY HOSPITALITY DAILY CHECKLIST (Jon, 2026-09-15).
--
--   "I also want to create a project which is called Operational or Full Team Checklist... This
--    will be a time-sensitive checklist that we build based on things that have to happen every
--    single day."
--
-- TWO TABLES, AND THE SPLIT IS THE WHOLE DESIGN.
--
--   daily_checklist_items  — the STANDING list. What has to happen every day, and by when. Edited
--                            rarely, by a manager. There is exactly one of these lists.
--   daily_checklist_ticks  — what actually happened on ONE day. One row per item per day, written
--                            the moment somebody ticks it.
--
-- Keeping them apart is why the list is "fresh every morning" without anybody resetting anything:
-- the items never change, and a new day simply has no tick rows yet. The alternative — one table
-- with a done flag that a nightly job clears — fails the first morning the job does not run, and
-- fails silently, with the team looking at yesterday's ticks believing them to be today's.
--
-- Jon chose "fresh list, nothing kept": no carry-over, no history screen. Ticks are still stored
-- per day because a tick has to survive the rest of the shift, but only today is ever read and
-- rows older than a week are deleted. If that decision is ever revisited, the history simply
-- starts accumulating again — nothing else has to change.

create table if not exists daily_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  detail      text,                                    -- how it is done, or what "done" means
  -- The four parts of an operating day. The band groups the list; by_time is what makes an item
  -- late. Both, because "Morning" alone cannot tell you at 11:15 that the 10:00 walk is overdue.
  band        text not null default 'morning',         -- morning | midday | afternoon | evening
  by_time     time,                                    -- local wall clock, America/New_York
  owner_role  text,                                    -- 'Front desk', 'Housekeeping' — a label, not a gate
  -- WHERE THE WORK ACTUALLY IS (Jon, 2026-09-16: "you could click on it, and it'll push you to the
  -- tab with the glitches and claims to be managed"). An in-app path; the row title becomes a link.
  link        text,
  -- A COUNT THE APP CAN ALREADY ANSWER (lib/checklist-signals). Stored as free text on purpose: a
  -- key this build has never heard of shows no number rather than breaking the page, so the list
  -- can be edited in the browser without a deploy.
  signal      text,
  sort        double precision,
  active      boolean not null default true,           -- retired items keep their history, unlike deleted ones
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists daily_checklist_items_live_idx on daily_checklist_items (band, by_time) where active;

-- Added after the first draft of this file. Spelled out separately so that running 091 twice, or
-- running it over a database where an earlier copy already landed, is safe either way.
alter table daily_checklist_items add column if not exists link   text;
alter table daily_checklist_items add column if not exists signal text;

create table if not exists daily_checklist_ticks (
  id       uuid primary key default gen_random_uuid(),
  item_id  uuid not null references daily_checklist_items(id) on delete cascade,
  -- The OPERATING day in America/New_York, not a timestamp. A tick at 11pm belongs to that day,
  -- and storing the date directly is what stops a UTC rollover moving it into tomorrow.
  day      date not null,
  done_at  timestamptz not null default now(),
  done_by  text,                                       -- whoever actually did it
  note     text,
  unique (item_id, day)                                -- one answer per item per day
);
create index if not exists daily_checklist_ticks_day_idx on daily_checklist_ticks (day);

create or replace function daily_checklist_items_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists daily_checklist_items_touch_trg on daily_checklist_items;
create trigger daily_checklist_items_touch before update on daily_checklist_items
  for each row execute function daily_checklist_items_touch();

-- Service role only, like every other operational table. The browser goes through the API, which
-- checks the feature level first.
alter table daily_checklist_items enable row level security;
alter table daily_checklist_ticks enable row level security;

-- ── A STARTING LIST ─────────────────────────────────────────────────────────────────────────────
-- Seeded only when the table is empty, so running this twice cannot duplicate anything and an
-- edited list is never overwritten. These are a scaffold to edit, not a prescription: the real
-- list is whatever the team decides has to happen every day.
insert into daily_checklist_items (title, detail, band, by_time, owner_role, link, signal, sort)
select * from (values
  ('Check arrivals for today',        'Every arrival has a unit ready, a code, and no unanswered message.', 'morning',   time '08:00', 'Front desk',   '/command',   null,            10.0),
  ('Confirm cleaners are on site',    'Everyone scheduled has started. Anybody missing gets a call now, not at noon.', 'morning', time '09:00', 'Housekeeping', '/plan',   null,            20.0),
  ('Review overnight guest messages', 'Nothing from the night is still unanswered.',                        'morning',   time '09:30', 'Front desk',   null,         null,            30.0),
  ('Walk the open glitches',          'Anything still open from yesterday has a next step and an owner.',   'morning',   time '10:00', 'Management',   '/glitches',  'open_glitches', 40.0),
  ('Vendors coming today',            'Anybody arriving is expected and the building knows.',               'morning',   time '10:00', 'Management',   '/command',   null,            50.0),
  ('Mid-day clean status',            'Every departure clean is done or has a time it will be.',            'midday',    time '13:00', 'Housekeeping', '/plan',      null,            60.0),
  ('Same-day turns confirmed ready',  'Every same-day turn is inspected and released.',                     'midday',    time '14:00', 'Housekeeping', '/plan',      null,            70.0),
  ('Check-in readiness sweep',        'Codes, access and instructions are out for every arrival left today.','afternoon', time '15:00', 'Front desk',  '/command',   null,            80.0),
  ('Late arrivals have a plan',       'Anyone arriving after hours knows how to get in.',                   'afternoon', time '17:00', 'Front desk',   null,         null,            90.0),
  -- TEACHING EVE IS DAILY WORK, and until now it was not on anybody's list — which is why she had
  -- forty-five questions saved up and no way for anyone to know that. One a day clears the backlog
  -- inside two months; the chip says how many are left, so nobody has to go and look.
  ('Answer one of Eve''s questions',  'She only asks things no record can tell her. One answer, and it is a rule with your name on it.', 'evening', time '17:30', 'Management', '/command', 'eve_questions', 95.0),
  ('Tomorrow is staffed',             'Tomorrow has the people it needs. Gaps are filled tonight, not in the morning.', 'evening', time '18:00', 'Management', '/labor',  null,           100.0),
  ('Close the day',                   'Open issues handed over, nothing left needing an answer overnight.', 'evening',   time '19:00', 'Management',   null,         null,           110.0)
) as seed(title, detail, band, by_time, owner_role, link, signal, sort)
where not exists (select 1 from daily_checklist_items);
