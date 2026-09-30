-- GUEST MOOD (Jon, 2026-09-30): every scored thread carries one of four labels — happy, neutral,
-- frustrated, sensitive — and the label is written to the reservation's notes in Guesty. A guest who
-- complains is 'sensitive' and the reservation's Sensitive box is ticked in Guesty.
alter table public.guesty_conversation_sentiment
  add column if not exists mood text,
  add column if not exists complaint boolean,
  add column if not exists mood_noted text,          -- the label last written to Guesty
  add column if not exists mood_noted_at timestamptz,
  add column if not exists guesty_error text,        -- why the last Guesty write failed
  add column if not exists guesty_error_at timestamptz;

-- The 2026-09-28 fix (a keyword is a tag, never a verdict) only applied to threads rescanned since.
-- Rows written before it still say dissatisfied because a word like 'review' or 'a/c' appeared —
-- "Great, thank you so much!" was sitting in the unhappy queue. Recompute from the model's reading.
update public.guesty_conversation_sentiment
   set dissatisfied = (coalesce('ai_dissatisfaction' = any(triggers), false) or coalesce(score, 3) <= 2)
 where dissatisfied is distinct from (coalesce('ai_dissatisfaction' = any(triggers), false) or coalesce(score, 3) <= 2);
