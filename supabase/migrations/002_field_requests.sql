-- Field Requests / Work Orders
-- The core ops table: maintenance issues, vendor orders, owner approvals.

create table if not exists field_requests (
  id                  uuid primary key default gen_random_uuid(),
  -- What
  type                text not null default 'issue',  -- issue | order | pte
  title               text not null,
  description         text,
  -- Where
  listing_id          text,                            -- FK to guesty_listings (text)
  building            text,                            -- denormalized for fast filter
  unit                text,
  reservation_id      text,                            -- FK to guesty_reservations
  -- Triage
  priority            text not null default 'medium', -- low | medium | high | urgent
  status              text not null default 'open',   -- open | acknowledged | in_progress | blocked | done | cancelled
  -- People
  created_by_email    text,
  assignee_email      text,
  -- Time
  due_at              date,
  -- Money
  vendor              text,
  amount_usd          numeric,
  approval_required   boolean default false,
  approval_status     text,                            -- pending | approved | rejected | null
  approver_email      text,
  approved_at         timestamptz,
  -- Media
  photos              text[],
  -- Bookkeeping
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_field_requests_status     on field_requests(status);
create index if not exists idx_field_requests_listing    on field_requests(listing_id);
create index if not exists idx_field_requests_building   on field_requests(building);
create index if not exists idx_field_requests_due        on field_requests(due_at);
create index if not exists idx_field_requests_assignee   on field_requests(assignee_email);
create index if not exists idx_field_requests_created    on field_requests(created_at desc);

-- Comments thread
create table if not exists field_request_comments (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references field_requests(id) on delete cascade,
  author_email    text,
  body            text not null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_frc_request on field_request_comments(request_id, created_at);

-- For now, no RLS — matches the rest of the app (gated by user auth at route level).
alter table field_requests disable row level security;
alter table field_request_comments disable row level security;
