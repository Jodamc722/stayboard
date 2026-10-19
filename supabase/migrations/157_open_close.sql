-- 157 — OPEN & CLOSE (Jon, 2026-10-19): the opening and closing roadmap on the Checklist tab.
--
-- "A roadmap for opening and closing operations each day… a morning checklist and then a closing
-- checklist that will live in one single tab… we also need to close out items for the day so we
-- can manage them next day if needed."
--
-- Three small tables. The GATES themselves (who's in, every clean has a person, extensions,
-- glitches…) are code — they are counted live from Breezeway, Guesty and Homebase and clear
-- themselves when there is nothing left. What has to be REMEMBERED is only: who signed a gate off,
-- what was carried into tomorrow, and the day's open/close record with the handover note.
--
-- Everything that reads these fails open until this runs: the tab works, nothing is remembered.

-- Who signed a gate off today. One row per gate per day; signing again overwrites.
create table if not exists public.oc_signoffs (
  day      date not null,
  gate     text not null,                 -- gate key, e.g. 'team', 'cleans', 'glitches', 'tomorrow_cleans'
  mode     text not null default 'open',  -- open | close
  done_by  text,
  done_at  timestamptz not null default now(),
  note     text,
  primary key (day, gate)
);

-- CARRIED INTO TOMORROW. A row somebody could not close today, with a note saying why. It sits on
-- the next morning's opening (and every morning after) until somebody marks it done or drops it.
create table if not exists public.oc_carry (
  id           uuid primary key default gen_random_uuid(),
  key          text not null,             -- the row it came from: 'clean:<task>', 'glitch:<id>', 'free'
  kind         text,                      -- clean · glitch · team · arrival · extension · money · note
  unit         text,
  title        text not null,
  note         text,
  from_day     date not null,
  by           text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  text,
  resolved_how text                       -- done | dropped
);
create index if not exists oc_carry_open_idx on public.oc_carry (from_day) where resolved_at is null;

-- THE DAY. Opened by / at, closed by / at, the handover note for the morning, and the counts at close.
create table if not exists public.oc_days (
  day        date primary key,
  opened_by  text,
  opened_at  timestamptz,
  closed_by  text,
  closed_at  timestamptz,
  note       text,
  snapshot   jsonb
);
