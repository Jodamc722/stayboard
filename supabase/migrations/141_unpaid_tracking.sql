-- UNPAID BALANCES — the follow-up record (Jon, 2026-10-01: "an unpaid report in the checklist and
-- view … selectable date ranges but prioritise unpaid today and next 7 days … tracking it and being
-- able to add notes"). Guesty holds the balance; this holds what WE did about it: a status and a
-- dated, signed note trail per reservation. Paid is read live from Guesty, never set here.
create table if not exists public.unpaid_tracking (
  reservation_id text primary key,
  status         text not null default 'open',    -- open | contacted | promised | disputed | waived
  notes          jsonb not null default '[]'::jsonb,  -- [{at, by, text}]
  updated_at     timestamptz not null default now(),
  updated_by     text
);
alter table public.unpaid_tracking enable row level security;
-- The app reads and writes it with the service role; no anon/authenticated policy on purpose.

-- The standing checklist item that carries the live number (lib/checklist-signals 'unpaid_due')
-- and opens the Unpaid board. Inserted once; a manager can retitle or move it in Edit list.
insert into public.daily_checklist_items (title, detail, band, by_time, owner_role, link, signal, sort, active, created_by)
select 'Collect unpaid balances — in house, today and the next 7 days',
       E'Open the Unpaid board — guests in the unit and arriving today are on top\nCall or message each guest the channel does not collect for; send the payment link from Guesty\nMark the row Contacted / Promised and add a note with what was said\nNo door code goes out on an unpaid arrival',
       'morning', '09:30', 'Front desk', '/reservations/unpaid', 'unpaid_due', 25, true, 'lighthouse'
where not exists (select 1 from public.daily_checklist_items where signal = 'unpaid_due');
