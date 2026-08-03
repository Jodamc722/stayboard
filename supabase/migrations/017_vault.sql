-- THE VAULT — the things that currently live in somebody's phone notes, a pinned Slack message,
-- or an email thread from 2023: gate codes, front-desk logins, insurance certificates, owner W-9s,
-- signed registration forms.
--
-- Two kinds of thing, one shelf:
--   SECRETS — short strings you type (a door code, a portal password). Stored ENCRYPTED, never
--             returned by the list endpoint, and revealed one at a time on an explicit request
--             that gets logged.
--   FILES   — uploads. The bytes live in a PRIVATE storage bucket; this table only holds the path,
--             and links are minted short-lived on demand.
--
-- ACCESS IS DENY-BY-DEFAULT. An item is visible to its owner and to whoever the owner has
-- explicitly granted. There is no "all staff" tier, because the whole point of a vault is that
-- membership of the company is not the same as need-to-know.
--
-- EVERY OPEN IS LOGGED. A vault nobody can audit is a filing cabinet with a lock painted on.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

create table if not exists vault_items (
  id            uuid primary key default gen_random_uuid(),

  -- What kind of thing this is, so the UI knows whether to render a reveal button or a download.
  kind          text not null check (kind in ('secret', 'file', 'note')),

  -- Free-form shelf: 'building', 'guest', 'company', 'owner'. Text rather than an enum so a new
  -- category is a dropdown change, not a migration.
  category      text not null default 'company',

  title         text not null,
  description   text,

  -- Optional anchors. A gate code belongs to a building; a signed form belongs to a reservation.
  property_id   text,
  unit_no       text,
  reservation_id text,
  listing_id    text,

  -- SECRETS. secret_cipher is base64 of iv || ciphertext || tag from AES-256-GCM, keyed by
  -- VAULT_KEY. Plaintext NEVER lands in this table, in a log, or in a list response.
  secret_cipher text,
  -- Enough to recognise an entry without revealing it: 'Gate code', '••••1234', a username.
  secret_hint   text,
  username      text,
  url           text,

  -- FILES. Path inside the private 'vault' bucket. Bytes are never served directly.
  doc_path      text,
  doc_name      text,
  doc_bytes     bigint,
  doc_mime      text,

  -- Things that expire are the ones that bite: certificates of insurance, licences, permits.
  expires_on    date,

  tags          text[] not null default '{}',

  owner_email   text not null,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- Per-item sharing. A row here is one person granted access to one item.
create table if not exists vault_grants (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references vault_items(id) on delete cascade,
  email       text not null,
  -- 'view' can open and reveal; 'manage' can also edit and re-share.
  level       text not null default 'view' check (level in ('view', 'manage')),
  granted_by  text,
  created_at  timestamptz not null default now()
);

create unique index if not exists idx_vault_grant_unique
  on vault_grants(item_id, lower(email));

-- The audit trail. Append-only by convention: nothing in the app ever updates or deletes a row.
create table if not exists vault_access_log (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid references vault_items(id) on delete set null,
  email      text,
  -- 'view' | 'reveal' | 'download' | 'create' | 'update' | 'delete' | 'grant' | 'revoke' | 'denied'
  action     text not null,
  detail     text,
  ip         text,
  created_at timestamptz not null default now()
);

create index if not exists idx_vault_items_owner on vault_items(owner_email) where deleted_at is null;
create index if not exists idx_vault_items_cat on vault_items(category, title) where deleted_at is null;
create index if not exists idx_vault_items_prop on vault_items(property_id) where deleted_at is null;
create index if not exists idx_vault_items_res on vault_items(reservation_id) where deleted_at is null;
-- Expiring documents are read as "what lapses soonest", so index that shape.
create index if not exists idx_vault_items_exp on vault_items(expires_on) where deleted_at is null and expires_on is not null;
create index if not exists idx_vault_grants_email on vault_grants(lower(email));
create index if not exists idx_vault_log_item on vault_access_log(item_id, created_at desc);

-- RLS on with NO permissive policy: every read and write goes through the service role in our own
-- API, which is where the grant check and the audit write live. Nothing reaches this table with an
-- anon key, so a leaked publishable key cannot enumerate the vault.
alter table vault_items      enable row level security;
alter table vault_grants     enable row level security;
alter table vault_access_log enable row level security;

notify pgrst, 'reload schema';
