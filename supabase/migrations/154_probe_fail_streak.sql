-- 154 — a probe remembers how many nights in a row it has failed (lib/eve/learning-audit runProbes).
-- Three straight fails retire it as "forgotten" instead of asking again tomorrow forever.
alter table eve_probes add column if not exists fail_streak integer not null default 0;
