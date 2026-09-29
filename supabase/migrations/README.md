# supabase/migrations

Hand-run SQL. Nothing in this repo applies these files automatically — there is no Supabase CLI
config and CI runs no SQL — so each file was run in the Supabase SQL editor. Every file is written
to be safe to run twice.

## Numbering (as of 2026-09-29)

- **Fifteen numbers are used twice:** 032, 047, 048, 049, 050, 051, 059, 069, 073, 074, 075, 076,
  077, 084 and 093. Each pair is two different migrations that happen to share a number.
- **Never renumber an applied file.** Cite a migration by its full file name
  (`073_guest_calls.sql`, not "073").
- **Never used:** 089 and 119–129.
- **Highest in use:** 135. Check this folder before picking the next number.
- **`000_baseline_legacy_tables.sql` is not a migration to run.** It is the DDL of three tables
  that were created by hand before they had a file here (`schedule_blocks`,
  `schedule_manual_cleans`, `labor_settings`), kept so every table has its DDL in the repo.

The self-audit (`scripts/audit`) reads every `*.sql` file here for its RLS register and its
schema-drift note. It does not read this README.
