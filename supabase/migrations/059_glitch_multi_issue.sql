-- GLITCHES: more than one thing can be wrong at once, and the guest conversation belongs here.
--
-- Jon, 2026-08-27: "for the glitches we should be able to add multiple issue, could be cleanliness,
-- etc ... also track guest messages there ... glitches are always reported by guest, glitch is a
-- guest reported issue."
--
-- NOTE ON THIS TABLE. `glitches` has never had a migration — it was created directly in Supabase,
-- so this file deliberately only ADDs and never assumes a shape. Everything here is idempotent.

-- 1. MULTIPLE ISSUES ---------------------------------------------------------------------------
-- A stay that arrived dirty AND had a broken AC is one guest experience, not two reports. The
-- singular `category` stays and remains the PRIMARY — it is what routes the Breezeway task to a
-- department, and a dozen code paths read it — while `categories` carries the full set.
alter table public.glitches add column if not exists categories text[] default '{}';

-- Backfill: every existing glitch's single category becomes a one-item list, so nothing has to
-- special-case "old row with no array".
update public.glitches
   set categories = array[category]
 where category is not null
   and (categories is null or cardinality(categories) = 0);

comment on column public.glitches.categories is
  'Every issue on this report. category (singular) stays the primary and decides Breezeway routing.';

-- 2. THE GUEST CONVERSATION --------------------------------------------------------------------
-- Until now a glitch held a point-in-time COPY of the sentiment score and nothing else, so it aged
-- the moment it was written and nobody could read what the guest actually said. Holding the
-- conversation id instead means the thread stays live — which is also what lets anything reason
-- about tone or about how the guest reacted to the fix.
alter table public.glitches add column if not exists conversation_id text;

create index if not exists glitches_conversation_idx on public.glitches (conversation_id)
  where conversation_id is not null;

comment on column public.glitches.conversation_id is
  'guesty_conversations.id — the live thread, not a snapshot.';

-- 3. COST RECOVERY IS NOT A THING WE TRACK -----------------------------------------------------
-- Jon, 2026-08-27: "cost recovery is dumb get rid of that ... cost recovery is not something we
-- track, the refund amount is."
--
-- The column is left in place rather than dropped: it holds real historical numbers, and dropping
-- it is the one change here that cannot be undone. Nothing writes to it and nothing reads it any
-- more — every KPI, the revenue-leakage figure and the weekly email now count refunds only.
comment on column public.glitches.recovery_cost is
  'RETIRED 2026-08-27 — not tracked. Historical values only; nothing reads or writes this. Refunds are the measure.';
