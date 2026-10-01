-- 142 — THE SMART CHECKLIST + NOTES ON THE TODAY PAGE (Jon, 2026-10-01).
--
-- "It should be a smart checklist … if they're already completed, they should be auto-marked
-- complete … a reminder to: respond to reviews, check unpaid reservations, manage glitches or
-- claims that are due." The auto-marking is code (lib/checklist-signals smartRows); this seeds the
-- two standing items the list was missing, each tied to its live count.
insert into public.daily_checklist_items (title, detail, band, by_time, owner_role, link, signal, sort, active, created_by)
select 'Answer the reviews waiting on a reply',
       E'Open Reviews — low scores first\nReply publicly to every review without one; Eve''s draft is a starting point, not the answer\nA 3★ or under gets a recovery inspection on the unit (automatic) — check it exists',
       'morning', '10:30', 'Guest experience', '/reviews', 'reviews_to_reply', 28, true, 'lighthouse'
where not exists (select 1 from public.daily_checklist_items where signal = 'reviews_to_reply');

insert into public.daily_checklist_items (title, detail, band, by_time, owner_role, link, signal, sort, active, created_by)
select 'File or move the damage claims that are due',
       E'Open Claims — anything in review or within 5 days of its filing window\nGather the evidence PDF and file on the channel before the window closes\nMove the stage so the desk shows where it stands',
       'midday', '13:00', 'GM', '/claims', 'claims_due', 45, true, 'lighthouse'
where not exists (select 1 from public.daily_checklist_items where signal = 'claims_due');

-- NOTES ON ANY ROW OF THE TODAY PAGE ("everything on that page should be able to add notes …
-- Today's Ecosystem"). One table, keyed by the row's own key ('clean:<task>', 'guest:<thread>',
-- 'unpaid:<reservation>', 'ck:<item>', 'rv:<review>' …), so a note follows the thing it is about
-- from the Today page to its tab and back. Rows that already have a native note (a Breezeway
-- task's comments, an unpaid stay's follow-up) keep writing there; this is for everything else.
create table if not exists public.day_notes (
  id         uuid primary key default gen_random_uuid(),
  key        text not null,
  text       text not null,
  by         text,
  created_at timestamptz not null default now()
);
create index if not exists day_notes_key_idx on public.day_notes (key, created_at desc);
create index if not exists day_notes_created_idx on public.day_notes (created_at desc);
