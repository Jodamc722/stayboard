-- WHO MADE THE CALL (2026-09-21). Jon: "put who called too in lighthouse."
--
-- Talkroute names no user on a call record; it names the DEVICE or extension that took the call, in
-- the call's event list. `caller_device` keeps that raw text (so a mapping can be fixed later
-- without re-reading Talkroute) and `caller_name` the person it resolved to.
alter table public.talkroute_calls add column if not exists caller_device text;
alter table public.talkroute_calls add column if not exists caller_name   text;
create index if not exists talkroute_calls_caller_idx on public.talkroute_calls (caller_name, call_at desc);
notify pgrst, 'reload schema';
