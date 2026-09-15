-- GLITCHES — the columns the board has been missing (Jon, 2026-09-15).
--
-- THREE THINGS COULD NOT BE ANSWERED BEFORE THIS FILE.
--
--   1. "How long does a guest issue take to close?" There was no closure timestamp at all. A card
--      closing only set status='closed' and bumped updated_at, so the moment of closure was
--      indistinguishable from the last time anybody edited the row. closed_at fixes that, and the
--      backfill below seeds it from updated_at for cards already closed — approximate for history,
--      exact from here on. The seeded rows are marked so nobody mistakes an estimate for a fact.
--
--   2. "What did we recommend, versus what did we actually pay?" refund_approved held the decision;
--      the recommendation lived only in an HTTP response that no screen ever called. Storing both
--      is what makes the two comparable — whether the team pays over the model, and by how much.
--
--   3. "Did anyone senior agree to this?" There was no approval anywhere. refund_approved is a
--      column name, not a workflow: one person with glitches:edit typed a number and it was final.
--
-- NOTE ON THIS TABLE. `glitches` has never had a CREATE TABLE — it was made by hand in Supabase —
-- so, like 059 and 060 before it, this file only ever ADDs and is safe to run twice.

alter table public.glitches add column if not exists closed_at timestamptz;
comment on column public.glitches.closed_at is
  'When the card reached status=closed. Set by the move action; null while open. Rows closed before 2026-09-15 were backfilled from updated_at and are flagged in closed_at_estimated.';

alter table public.glitches add column if not exists closed_at_estimated boolean not null default false;
comment on column public.glitches.closed_at_estimated is
  'true = closed_at was inferred from updated_at during the 085 backfill, not observed. Time-to-close reporting should be able to exclude these.';

-- What the advisor said, kept beside what a person decided.
alter table public.glitches add column if not exists refund_recommended numeric;
comment on column public.glitches.refund_recommended is
  'The amount lib/refund-policy.ts recommended at the time it was asked. Advice, never a decision — refund_approved is the decision.';

alter table public.glitches add column if not exists refund_reasoning jsonb;
comment on column public.glitches.refund_reasoning is
  'The advisor breakdown behind refund_recommended: severity, base %, speed/mitigation/OTA adjustments, the unit signals that were on screen, and confidence. Kept so a refund can be explained months later.';

-- The note was only ever inside the history blob, which nothing can query.
alter table public.glitches add column if not exists refund_note text;
comment on column public.glitches.refund_note is
  'How the refund was given (OTA credit, card refund, declined and why). Previously written only into history jsonb.';

alter table public.glitches add column if not exists refund_needs_approval boolean not null default false;
alter table public.glitches add column if not exists refund_approved_by text;
alter table public.glitches add column if not exists refund_approved_at timestamptz;
comment on column public.glitches.refund_needs_approval is
  'true when the logged amount crossed the approval line and nobody senior has signed it yet.';

-- BACKFILL. Only rows that are closed and have no closure time. Marked as estimated so the KPI can
-- tell the difference between "we measured this" and "we guessed it from the last edit".
update public.glitches
   set closed_at = updated_at,
       closed_at_estimated = true
 where status = 'closed'
   and closed_at is null
   and updated_at is not null;

create index if not exists glitches_closed_at_idx on public.glitches (closed_at) where closed_at is not null;
create index if not exists glitches_status_idx on public.glitches (status);
