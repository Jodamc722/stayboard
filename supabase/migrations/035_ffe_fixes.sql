-- FF&E FIXES — the things that need doing, not buying (Jon, 2026-08-12).
--
--   "...then add what needs to be done. This is only for furniture, so maybe something that needs
--    to be done, it can be communicated there, and send to team. This would not need to be shared
--    with owner unless it's 350 or more to fix. Think FF&E improvements, etc."
--
-- WHY THIS IS NOT A MAINTENANCE TICKET, AGAIN. A walker standing in 1101 sees two different things:
-- a sofa that has to be replaced (an order line) and a wobbly drawer runner that has to be fixed.
-- The second one used to have nowhere to go inside FF&E, so it either got lost or it got raised as
-- a Breezeway maintenance task — which is exactly the mixing Jon ruled out in migration 032. This
-- gives it a home in FF&E: furniture improvements, worked by the team, tracked to done.
--
-- THE $350 RULE IS THE POINT OF THE est_cost COLUMN. Under it, the owner never sees the item and
-- the team just does it. At or over it, the fix needs owner sign-off, and the way it reaches them
-- is the FF&E order they already get — order_id records which one it went out on. The threshold
-- lives in lib/ffe-catalog.ts (FIX_OWNER_THRESHOLD) so there is one number, not one per screen.
--
-- A fix with NO estimate is treated as under the line: not yet costed is not the same as expensive,
-- and holding work back waiting for a number nobody was asked for is how small things rot.

create table if not exists ffe_fixes (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null,
  unit_name text,
  building text,
  room text,                                -- checklist room key, or null for "the whole unit"
  item_key text,                            -- the checklist item it came off, when it came off one
  title text not null,
  note text,
  photo_url text,
  est_cost numeric(12,2),
  status text not null default 'open',      -- open | doing | done | dropped
  assigned_to text,
  order_id uuid,                            -- set when it went to the owner on an FF&E order
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz,
  done_by text
);
create index if not exists ffe_fixes_listing on ffe_fixes (listing_id);
create index if not exists ffe_fixes_status on ffe_fixes (status);
create index if not exists ffe_fixes_assigned on ffe_fixes (assigned_to);

alter table ffe_fixes enable row level security;
