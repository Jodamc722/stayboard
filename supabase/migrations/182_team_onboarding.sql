-- 182_team_onboarding.sql — TEAM ONBOARDING + EVERY PERSON'S OWN PAGE (Jon, 2026-11-25).
--
-- "Get them on apps, get them understanding how we use Breezeway, get them on Homebase, Breezeway,
-- Slack, Lighthouse. Understand red-button issues and how to change door locks." · "be able to quiz
-- or resend quiz after an issue to make sure they are retrained" · "track all they do, keep a
-- profile for them, where they can see their stats, hours worked, tasks assigned, training and
-- profile. And schedule when pushed." · "once approved they can also see their inspections" ·
-- "they get an email".
--
-- Builds on 161 (training_items / people / assignments): the person's /learn/<code> link becomes
-- their own page, emailed to them.
--
--   training_people      + role track, start date, onboarding steps, signed handbook, invite, onboarded
--   training_quizzes     the questions for one item (English + Spanish), 100% to pass, retakes allowed
--   training_quiz_attempts  every try, kept
--   training_assignments + why it was assigned (onboarding / retraining) and the issue behind it
--   team_issues          an issue logged against a person (red-button, inspection, guest, other) and
--                        the retraining it sent
--   team_activity        everything they do on their page, and everything done to their record
--   schedule_pushes      a market's week counts as pushed from this row on; their page shows it then
--
-- Service-role only: RLS on, no policies. Safe to run twice.

alter table public.training_people add column if not exists role_track text;
alter table public.training_people add column if not exists start_date date;
alter table public.training_people add column if not exists onboarding jsonb not null default '{}'::jsonb;
alter table public.training_people add column if not exists ack_name text;
alter table public.training_people add column if not exists ack_at timestamptz;
alter table public.training_people add column if not exists ack_version text;
alter table public.training_people add column if not exists invited_at timestamptz;
alter table public.training_people add column if not exists invite_error text;
alter table public.training_people add column if not exists onboarded_at timestamptz;
alter table public.training_people add column if not exists phone text;
alter table public.training_people add column if not exists active boolean not null default true;

create table if not exists public.training_quizzes (
  item_id uuid primary key references public.training_items(id) on delete cascade,
  questions jsonb not null default '[]'::jsonb,   -- [{ q: {en, es}, options: {en: [], es: []}, answer: 0 }]
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.training_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.training_items(id) on delete cascade,
  person_key text not null references public.training_people(key) on delete cascade,
  score int not null default 0,
  total int not null default 0,
  passed boolean not null default false,
  answers jsonb not null default '[]'::jsonb,
  lang text,
  at timestamptz not null default now()
);
create index if not exists training_quiz_attempts_person_idx on public.training_quiz_attempts (person_key, at desc);

alter table public.training_assignments add column if not exists reason text;        -- onboarding | retraining | assigned
alter table public.training_assignments add column if not exists issue_id uuid;
alter table public.training_assignments add column if not exists round int not null default 1;

create table if not exists public.team_issues (
  id uuid primary key default gen_random_uuid(),
  person_key text not null references public.training_people(key) on delete cascade,
  kind text not null default 'other',          -- red_button | inspection | guest | other
  note text,
  ref text,                                    -- a task id, reservation code, inspection task id
  item_ids text[] not null default '{}',       -- the retraining it sent
  status text not null default 'retraining',   -- retraining | retrained | logged
  created_by text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists team_issues_person_idx on public.team_issues (person_key, created_at desc);

create table if not exists public.team_activity (
  id bigserial primary key,
  person_key text not null,
  kind text not null,                          -- opened | watched | completed | quiz | signed | step | invited | assigned | retrain | issue | schedule
  detail jsonb not null default '{}'::jsonb,
  by text,                                     -- null = the person themself
  at timestamptz not null default now()
);
create index if not exists team_activity_person_idx on public.team_activity (person_key, at desc);

create table if not exists public.schedule_pushes (
  week_start date not null,
  market text not null,
  pushed_at timestamptz not null default now(),
  pushed_by text,
  emailed int not null default 0,
  primary key (week_start, market)
);

alter table public.training_quizzes enable row level security;
alter table public.training_quiz_attempts enable row level security;
alter table public.team_issues enable row level security;
alter table public.team_activity enable row level security;
alter table public.schedule_pushes enable row level security;

notify pgrst, 'reload schema';
