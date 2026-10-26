-- 161 TRAINING (Jon, 2026-10-26): "a training tab — how-to videos for the team, a video + FAQ library
-- we can assign to team." The library (videos, FAQs, docs — each in English and Spanish), the people
-- it is assigned to (Lighthouse users AND field staff who have no login — they get a personal link),
-- and who finished what.
--
-- Video files live in the private storage bucket `training` (created by the app on first upload);
-- rows keep the storage key and the page hands out six-hour signed URLs. External links (YouTube,
-- Drive) are allowed too.

create table if not exists public.training_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'video' check (kind in ('video', 'faq', 'doc')),
  title_en text not null,
  title_es text,
  summary_en text,
  summary_es text,
  body_en text,
  body_es text,
  video_path_en text,
  video_path_es text,
  video_url_en text,
  video_url_es text,
  duration_sec int,
  tags text[] not null default '{}',
  audience text[] not null default '{}',
  required boolean not null default false,
  sort_order int not null default 100,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per person who has ever been assigned training. `key` is the lower-cased email for a
-- Lighthouse user, or crew:<slug> for a field person from the staff roster. `code` is the capability
-- behind /learn/<code> — their personal training page, no login.
create table if not exists public.training_people (
  key text primary key,
  name text not null,
  email text,
  lang text not null default 'en' check (lang in ('en', 'es')),
  code text not null unique,
  dept text,
  market text,
  created_at timestamptz not null default now()
);

create table if not exists public.training_assignments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.training_items(id) on delete cascade,
  person_key text not null references public.training_people(key) on delete cascade,
  assigned_by text,
  assigned_at timestamptz not null default now(),
  due_on date,
  completed_at timestamptz,
  completed_lang text,
  completed_via text,
  unique (item_id, person_key)
);

-- Every open of a video or FAQ from a personal link or the app — the progress trail.
create table if not exists public.training_views (
  id bigserial primary key,
  item_id uuid not null references public.training_items(id) on delete cascade,
  person_key text,
  lang text,
  at timestamptz not null default now()
);

create index if not exists training_assignments_person_idx on public.training_assignments (person_key);
create index if not exists training_assignments_item_idx on public.training_assignments (item_id);
create index if not exists training_views_item_idx on public.training_views (item_id, at desc);

-- Service-role only (the app reads and writes through lib/training with the admin client).
alter table public.training_items enable row level security;
alter table public.training_people enable row level security;
alter table public.training_assignments enable row level security;
alter table public.training_views enable row level security;

notify pgrst, 'reload schema';
