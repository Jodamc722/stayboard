-- 147 — THE LEDGER MIRROR STOPS KEEPING GUESTY'S WITHDRAWN LINES (2026-10-05). Guesty re-issues a
-- journal line under a new id when it recomputes a statement; the sweep (lib/guesty-owner-sync
-- syncLedgerMonth) now deletes the rows a full pass did not see again, and records how many.
alter table public.guesty_ledger_months add column if not exists retired_rows integer not null default 0;
alter table public.guesty_ledger_months add column if not exists sweep_epoch timestamptz;
-- One-time clean-up of the stale generations already in the mirror (May–Oct 2026): keep, per
-- identical journal line, only the newest-synced row. The next full sweep makes this exact.
with ranked as (
  select id, row_number() over (
    partition by owner_id, listing_id, entry_date, charge_code, amount, recognized, coalesce(raw->>'name',''), coalesce(raw->>'reservationConfirmationCode','')
    order by synced_at desc, id desc
  ) as rn
  from public.guesty_owner_ledger where entry_month >= '2026-05'
)
delete from public.guesty_owner_ledger where id in (select id from ranked where rn > 1);
notify pgrst, 'reload schema';
