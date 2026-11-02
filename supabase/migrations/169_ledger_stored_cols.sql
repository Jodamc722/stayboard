-- OWNER STATEMENT REVIEW — one audit, the same every time it loads (Jon, 2026-11-02: "make sure it
-- works cleanly").
--
-- The audit read pulled the booking code and the line name out of the raw JSON on every ledger row
-- (raw->reservationConfirmationCode->>title, raw->>name) — 24,000 rows a month, 1,000 at a time.
-- When that query timed out the code fell back to a read WITHOUT the booking code, so every line on
-- the page became "No booking behind it" and Prep said nothing was on a statement. Same month, two
-- different audits, depending on the second you loaded it.
--
-- Fix at the source: the two values become STORED GENERATED columns. Postgres fills them from raw
-- for every existing row and keeps them current on every insert/update — no sync change, no
-- backfill job — and the audit selects plain columns. Plus the two indexes the read and the
-- booking join were missing.
alter table guesty_owner_ledger
  add column if not exists res_code  text generated always as (nullif(trim(raw->'reservationConfirmationCode'->>'title'), '')) stored,
  add column if not exists line_name text generated always as (nullif(trim(raw->>'name'), '')) stored;

create index if not exists idx_gol_month_recognized_id on guesty_owner_ledger(entry_month, recognized, id);
create index if not exists idx_gol_res_code on guesty_owner_ledger(res_code) where res_code is not null;
create index if not exists idx_gres_confirmation_code on guesty_reservations(confirmation_code);
