-- Manual cleans added from the StayBoard schedule (create-clean route logs them here so
-- board-added tasks show on the calendar). Run once in the Supabase SQL editor.
create table if not exists schedule_manual_cleans (
  listing_id text not null,
  date date not null,
  breezeway_task_id text,
  created_by text,
  created_at timestamptz default now(),
  primary key (listing_id, date)
);
alter table schedule_manual_cleans enable row level security;
