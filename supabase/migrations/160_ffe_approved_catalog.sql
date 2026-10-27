-- 160 — APPROVED CATALOG DECISIONS (Jon, 2026-10-20): the 17 West furniture catalog review.
--
-- "Make this easy to review, approve, and build our 17 West furniture catalog, so when needing to
-- replace, we know what we are approved to replace it with… Once approved, this will be our 17 West
-- catalog."
--
-- The CATALOG itself (items, options, photos, prices) is a JSON file in the repo
-- (lib/ffe-approved-catalog-<property>.json) — it was built from the sourcing sheet and changes
-- only when the sheet does. What has to be REMEMBERED is the decision on each item: which options
-- are approved, whether the item is out, and the note ("order 2 per unit"). One row per item per
-- property; saving again overwrites. Everything that reads this fails open until it runs: the page
-- works, nothing is remembered.

create table if not exists public.ffe_approved_decisions (
  property    text not null,                 -- catalog key, e.g. '17-west'
  item_key    text not null,                 -- 'cmp-1' · 'solo-3' · 'am-9' (from the catalog JSON)
  approved    text[] not null default '{}',  -- option sources approved: host · amz · ch · wf
  rejected    boolean not null default false,
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (property, item_key)
);

alter table public.ffe_approved_decisions enable row level security;

-- SHARE LINK (Jon, 2026-10-27: "create this as sharable link from Lighthouse"). One unguessable
-- code per property; /catalog/<code> shows the approved list read-only, no sign-in. Regenerating
-- the code is how an old link is revoked.
create table if not exists public.ffe_catalog_shares (
  property    text primary key,
  code        text not null unique,
  created_by  text,
  created_at  timestamptz not null default now(),
  views       integer not null default 0,
  last_view   timestamptz
);
alter table public.ffe_catalog_shares enable row level security;
